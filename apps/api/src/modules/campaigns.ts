import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Injectable, ForbiddenException, BadRequestException, NotFoundException, ParseUUIDPipe, ServiceUnavailableException } from '@nestjs/common';
import { ApiProperty,ApiTags,PartialType } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsOptional, IsObject, IsString, IsUUID, Matches,MaxLength } from 'class-validator';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { afterTenantCommit,isPlatformSendingPaused,prisma,withTenant } from '@repus/database';
import type {Prisma} from '@repus/database';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { AuthService } from './auth';
import { normalizeTemplateEditorJson,sanitizeEmailHtml } from './templates';
import { renderEmailHtml,renderEmailTextAlternative,renderEmailSubject } from '@repus/email-renderer';
import { sendingDomainSendBlock,workspaceSendBlock,TEST_SEND_RATE_LIMIT } from './domain-readiness';
import {EMAIL_JOB_PRIORITIES,effectivePlatformSendLimits,platformQuotaDate} from '@repus/validation';
import {publishSendInterrupt} from './send-interrupts';
const redis=new IORedis(process.env.REDIS_URL??'redis://localhost:6379',{maxRetriesPerRequest:1,commandTimeout:3000,autoResendUnfulfilledCommands:false});
const rawSendingQueue=new Queue('repus-email-sending',{connection:redis});
function quotaDay(value:Date){return platformQuotaDate(value,process.env.PLATFORM_TIMEZONE??'Asia/Kolkata');}

export class CreateCampaignDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!:string;
  @IsOptional() @IsString() @MaxLength(255) subject?:string;
  @IsOptional() @IsString() @MaxLength(500) previewText?:string;
  @IsOptional() @IsString() @MaxLength(160) fromName?:string;
  @IsOptional() @IsEmail() fromEmail?:string;
  @IsOptional() @IsEmail() replyTo?:string;
  @IsOptional() @IsUUID() listId?:string;
  @IsOptional() @IsUUID() templateId?:string;
  @IsOptional() @IsString() htmlContent?:string;
  @IsOptional() @IsString() textContent?:string;
  @IsOptional() @IsObject() editorJson?:Record<string,unknown>;
}
export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}
export class ScheduleDto {
 @ApiProperty({type:String,format:'date-time',example:'2026-11-10T12:00:00Z',description:'Future ISO timestamp with Z or an explicit UTC offset.'})
 @IsDateString({strict:true,strictSeparator:true})
 @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/,{message:'scheduledAt must include an explicit timezone offset.'})
 scheduledAt!:string;
}
class TestSendDto { @IsEmail() email!:string; }

const campaignSummaryFields={id:true,name:true,subject:true,status:true,updatedAt:true,_count:{select:{recipients:true}}} as const;

@Injectable()
export class CampaignsService {
 constructor(private auth:AuthService){}
 private async actor(req:Request){return this.auth.authenticate(req.cookies?.repus_session as string|undefined);}
 private canWrite(role:string){if(role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');}
 async list(req:Request,view?:string){
  const user=await this.actor(req);
  const options={where:{tenantId:user.tenantId},orderBy:{createdAt:'desc' as const}};
  if(view==='summary')return prisma.campaign.findMany({...options,select:campaignSummaryFields});
  return prisma.campaign.findMany({...options,include:{_count:campaignSummaryFields._count}});
 }
 async summaryPage(req:Request,rawPage:string){
  const page=Number(rawPage);
  if(!/^\d+$/.test(rawPage)||!Number.isSafeInteger(page)||page<1||page>10_000)throw new BadRequestException('Choose a valid campaign page.');
  const user=await this.actor(req);
  const pageSize=25;
  const items=await prisma.campaign.findMany({
   where:{tenantId:user.tenantId},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize+1,
   select:campaignSummaryFields,
  });
  return {data:items.slice(0,pageSize),page,hasNext:page<10_000&&items.length>pageSize};
 }
 async create(req:Request,dto:CreateCampaignDto){const u=await this.actor(req);this.canWrite(u.role);if(dto.htmlContent)await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 98321))`;if(dto.listId&&!await prisma.contactList.findFirst({where:{id:dto.listId,tenantId:u.tenantId}}))throw new NotFoundException('Contact list not found.');if(dto.templateId&&!await prisma.template.findFirst({where:{id:dto.templateId,tenantId:u.tenantId}}))throw new NotFoundException('Template not found.');return prisma.campaign.create({data:{tenantId:u.tenantId,name:dto.name.trim(),subject:dto.subject?.trim(),previewText:dto.previewText?.trim(),fromName:dto.fromName?.trim(),fromEmail:dto.fromEmail?.trim().toLowerCase(),replyTo:dto.replyTo===null?null:dto.replyTo?.trim().toLowerCase(),listId:dto.listId,templateId:dto.templateId,htmlContent:dto.htmlContent?sanitizeEmailHtml(dto.htmlContent):undefined,textContent:dto.textContent,editorJson:normalizeTemplateEditorJson(dto.editorJson) as any}});}
 async get(req:Request,id:string){const u=await this.actor(req);const [c,workspace]=await Promise.all([prisma.campaign.findFirst({where:{id,tenantId:u.tenantId},include:{_count:{select:{recipients:true}}}}),prisma.tenant.findUnique({where:{id:u.tenantId},select:{timezone:true}})]);if(!c)throw new NotFoundException('Campaign not found.');return {...c,workspaceTimezone:workspace?.timezone??'UTC',canManage:u.role!=='VIEWER'};}
 async preview(req:Request,id:string){const c=await this.get(req,id);const fields={first_name:'Avery',last_name:'Morgan',email:'preview@example.com',unsubscribe_url:'#unsubscribe-preview',preview_text:c.previewText};const html=renderEmailHtml(c.htmlContent??'',fields);return {id:c.id,name:c.name,subject:renderEmailSubject(c.subject??'',fields),previewText:c.previewText,fromName:c.fromName,fromEmail:c.fromEmail,htmlContent:html,textContent:renderEmailTextAlternative(c.textContent,html,fields)}}
 async update(req:Request,id:string,dto:UpdateCampaignDto){
  const u=await this.actor(req);this.canWrite(u.role);
  if(dto.htmlContent)await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 98321))`;
  const campaign=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});
  if(!campaign)throw new NotFoundException('Campaign not found.');
  if(!['DRAFT','SCHEDULED'].includes(campaign.status))throw new BadRequestException('This campaign can no longer be edited.');
  if(campaign.status==='SCHEDULED'&&dto.listId!==undefined&&dto.listId!==campaign.listId)throw new BadRequestException('Cancel this scheduled campaign and create a new schedule to change its audience.');
  const changed=await prisma.campaign.updateMany({
   where:{id,tenantId:u.tenantId,status:campaign.status,...(campaign.status==='SCHEDULED'?{listId:campaign.listId}:{})},
   data:{name:dto.name?.trim(),subject:dto.subject?.trim(),previewText:dto.previewText?.trim(),fromName:dto.fromName?.trim(),fromEmail:dto.fromEmail?.trim().toLowerCase(),replyTo:dto.replyTo===null?null:dto.replyTo?.trim().toLowerCase(),listId:dto.listId,templateId:dto.templateId,htmlContent:dto.htmlContent?sanitizeEmailHtml(dto.htmlContent):undefined,textContent:dto.textContent,editorJson:normalizeTemplateEditorJson(dto.editorJson) as any,scheduledAt:undefined},
  });
  if(!changed.count)throw new BadRequestException('This campaign changed state before the edit was saved. Reload and try again.');
  return prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});
 }
 async remove(req:Request,id:string){const u=await this.actor(req);this.canWrite(u.role);const c=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});if(!c)throw new NotFoundException('Campaign not found.');if(c.status!=='DRAFT')throw new BadRequestException('Only draft campaigns can be deleted.');const removed=await prisma.campaign.deleteMany({where:{id,tenantId:u.tenantId,status:'DRAFT'}});if(removed.count!==1)throw new BadRequestException('This campaign changed state before deletion. Reload and try again.');return {success:true};}
 private async validateAudience(tenantId:string,campaign:any){
   if(!campaign.subject?.trim()||!campaign.htmlContent?.trim())throw new BadRequestException('Add a subject and email content before sending.');
   if(!campaign.fromEmail)throw new BadRequestException('Add sender details before sending.');
   const domain=campaign.fromEmail.split('@')[1]?.toLowerCase();
   const domainRecord=await prisma.sendingDomain.findFirst({where:{tenantId,domain}});
   const domainBlock=sendingDomainSendBlock(domainRecord,process.env.EMAIL_PROVIDER??'development');
   if(domainBlock)throw new BadRequestException(domainBlock);
   if(!campaign.listId)throw new BadRequestException('Choose a subscriber list before sending.');
   const result=await prisma.$queryRaw<Array<{count:bigint}>>`
     SELECT count(*)::bigint AS count
     FROM contacts AS c
     INNER JOIN list_contacts AS lc
       ON lc.tenant_id = c.tenant_id AND lc.contact_id = c.id
     WHERE c.tenant_id = ${tenantId}::uuid
       AND lc.list_id = ${campaign.listId}::uuid
       AND c.deleted_at IS NULL
       AND c.status = 'SUBSCRIBED'
       AND c.consent_at IS NOT NULL
       AND c.consent_source IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM suppressions AS s
         WHERE s.tenant_id = c.tenant_id AND s.normalized_email = c.normalized_email
       )
   `;
   const count=Number(result[0]?.count??0n);
   if(!Number.isSafeInteger(count))throw new BadRequestException('This audience is too large to prepare safely.');
   if(!count)throw new BadRequestException('This list has no eligible, permission-based subscribers.');
   return count;
 }
 private async createRecipients(tx:Prisma.TransactionClient,tenantId:string,campaignId:string,listId:string,status:'QUEUED'|'PENDING',expected:number){
   const inserted=await tx.$executeRaw`
     INSERT INTO campaign_recipients (tenant_id, campaign_id, contact_id, email, status, quota_date)
     SELECT c.tenant_id, ${campaignId}::uuid, c.id, c.email, ${status}::"RecipientStatus", campaign.quota_date
     FROM contacts AS c
     INNER JOIN campaigns AS campaign ON campaign.tenant_id=c.tenant_id AND campaign.id=${campaignId}::uuid
     INNER JOIN list_contacts AS lc
       ON lc.tenant_id = c.tenant_id AND lc.contact_id = c.id
     WHERE c.tenant_id = ${tenantId}::uuid
       AND lc.list_id = ${listId}::uuid
       AND c.deleted_at IS NULL
       AND c.status = 'SUBSCRIBED'
       AND c.consent_at IS NOT NULL
       AND c.consent_source IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM suppressions AS s
         WHERE s.tenant_id = c.tenant_id AND s.normalized_email = c.normalized_email
       )
     ON CONFLICT (campaign_id, contact_id) DO NOTHING
   `;
   if(inserted!==expected)throw new BadRequestException('The eligible audience changed while preparing this campaign. Review the audience and try again.');
 }
 private async enqueueCampaignRecipients(tenantId:string,campaignId:string){
   const queued=await prisma.campaignRecipient.count({where:{campaignId,status:'QUEUED'}});
   afterTenantCommit(async()=>{
     if(redis.status!=='ready')return;
     await this.publishCampaignRecipients(tenantId,campaignId);
   });
   return queued;
 }
 private async publishCampaignRecipients(tenantId:string,campaignId:string){
   const batchSize=500;let afterId:string|undefined;let queued=0;
   while(true){
     const rows=await withTenant(tenantId,()=>prisma.campaignRecipient.findMany({where:{campaignId,status:'QUEUED',...(afterId?{id:{gt:afterId}}:{})},orderBy:{id:'asc'},take:batchSize,select:{id:true}}));
     if(!rows.length)break;
     if(redis.status!=='ready')break;
     await rawSendingQueue.addBulk(rows.map(({id:recipientId})=>({name:'send',data:{recipientId},opts:{priority:EMAIL_JOB_PRIORITIES.campaign,jobId:`recipient-${recipientId}`,attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:false}})));
     queued+=rows.length;afterId=rows[rows.length-1].id;
   }
   return queued;
 }
 private async reserve(tenantId:string,count:number,day:Date){
   if(await isPlatformSendingPaused())throw new ForbiddenException('Repus has temporarily paused sending. Please try again after service is restored.');
   const today=quotaDay(day);const monthStart=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1));const monthEnd=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,1));
   await prisma.$transaction(async tx=>{
     await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
     const tenant=await tx.tenant.findUnique({where:{id:tenantId},select:{status:true}});
     const limits=await tx.tenantSendingLimit.findUnique({where:{tenantId}});
     if(tenant?.status!=='active')throw new ForbiddenException('Sending is paused for this workspace. Contact Repus support if you think this is a mistake.');
     if(!limits?.enabled)throw new ForbiddenException('Sending is paused for this workspace.');
     const platformControl=await tx.platformControl.findUniqueOrThrow({where:{id:1},select:{dailySendLimit:true,monthlySendLimit:true}});
     const {daily:platformLimit,monthly:platformMonthly}=effectivePlatformSendLimits(platformControl,process.env);
     await tx.$executeRaw`INSERT INTO daily_usage (id, tenant_id, usage_date, sent_count, reserved_count, created_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${today}::date, 0, 0, NOW()) ON CONFLICT (tenant_id, usage_date) DO NOTHING`;
     await tx.platformDailyUsage.upsert({where:{usageDate:today},create:{usageDate:today},update:{}});
     const own=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId,usageDate:today}}});
     const platformToday=await tx.platformDailyUsage.findUnique({where:{usageDate:today}});
     const tenantMonth=await tx.dailyUsage.aggregate({where:{tenantId,usageDate:{gte:monthStart,lt:monthEnd}},_sum:{sentCount:true,reservedCount:true}});
     const platformMonth=await tx.platformDailyUsage.aggregate({where:{usageDate:{gte:monthStart,lt:monthEnd}},_sum:{sentCount:true,reservedCount:true}});
     if((tenantMonth._sum.sentCount??0)+(tenantMonth._sum.reservedCount??0)+count>limits.monthlyLimit)throw new BadRequestException("You've reached your workspace's monthly email sending limit. The next monthly sending window begins on the first day of next month.");
     if((own!.sentCount+own!.reservedCount+count)>limits.dailyLimit)throw new BadRequestException("You've reached today's email sending limit. Your next sending window begins at midnight.");
     if((platformToday!.sentCount+platformToday!.reservedCount+count)>platformLimit||(platformMonth._sum.sentCount??0)+(platformMonth._sum.reservedCount??0)+count>platformMonthly)throw new BadRequestException("Repus has reached its sending allowance. Please schedule your campaign for the next available window.");
     await tx.dailyUsage.update({where:{tenantId_usageDate:{tenantId,usageDate:today}},data:{reservedCount:{increment:count}}});
     await tx.platformDailyUsage.update({where:{usageDate:today},data:{reservedCount:{increment:count}}});
   },{isolationLevel:'ReadCommitted'});
 }
 private async releaseReservation(tenantId:string,day:Date,count:number){await prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;await tx.dailyUsage.updateMany({where:{tenantId,usageDate:day},data:{reservedCount:{decrement:count}}});await tx.platformDailyUsage.updateMany({where:{usageDate:day},data:{reservedCount:{decrement:count}}});});}
 async sendNow(req:Request,id:string){const u=await this.actor(req);this.canWrite(u.role);const campaign=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});if(!campaign)throw new NotFoundException('Campaign not found.');if(campaign.status!=='DRAFT')throw new BadRequestException('Only a draft campaign can be sent.');const listId=campaign.listId;if(!listId)throw new BadRequestException('Choose a subscriber list before sending.');const recipientCount=await this.validateAudience(u.tenantId,campaign);const day=quotaDay(new Date());await this.reserve(u.tenantId,recipientCount,day);
   try{await prisma.$transaction(async tx=>{const claimed=await tx.campaign.updateMany({where:{id,tenantId:u.tenantId,status:'DRAFT'},data:{status:'PREPARING',startedAt:new Date(),quotaDate:day}});if(claimed.count!==1)throw new BadRequestException('This campaign is already being prepared or has already been sent.');await this.createRecipients(tx,u.tenantId,id,listId,'QUEUED',recipientCount);await tx.campaign.update({where:{id},data:{status:'QUEUED'}});});}
   catch(error){await this.releaseReservation(u.tenantId,day,recipientCount);throw error;}
   const queued=await this.enqueueCampaignRecipients(u.tenantId,id);return {queued};}
 async pause(req:Request,id:string){const u=await this.actor(req);this.canWrite(u.role);const campaign=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});if(!campaign)throw new NotFoundException('Campaign not found.');if(!['QUEUED','SENDING'].includes(campaign.status))throw new BadRequestException('Only an active campaign can be paused.');const changed=await prisma.campaign.updateMany({where:{id,tenantId:u.tenantId,status:{in:['QUEUED','SENDING']}},data:{status:'PAUSED'}});if(!changed.count)throw new BadRequestException('This campaign is no longer active.');const interruptedWorkerCount=await publishSendInterrupt({scope:'campaign',campaignId:id});return {status:'PAUSED',inFlightMayComplete:true,inFlightInterruptionPublished:(interruptedWorkerCount??0)>0};}
 async resume(req:Request,id:string){const u=await this.actor(req);this.canWrite(u.role);const campaign=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});if(!campaign)throw new NotFoundException('Campaign not found.');if(campaign.status!=='PAUSED')throw new BadRequestException('Only a paused campaign can be resumed.');const changed=await prisma.campaign.updateMany({where:{id,tenantId:u.tenantId,status:'PAUSED'},data:{status:'QUEUED'}});if(!changed.count)throw new BadRequestException('This campaign is no longer paused.');const queued=await this.enqueueCampaignRecipients(u.tenantId,id);return {status:'QUEUED',queued};} async schedule(req:Request,id:string,at:string){const u=await this.actor(req);this.canWrite(u.role);const campaign=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});if(!campaign)throw new NotFoundException('Campaign not found.');if(campaign.status!=='DRAFT')throw new BadRequestException('Only a draft campaign can be scheduled.');const date=new Date(at);if(Number.isNaN(date.getTime())||date<=new Date())throw new BadRequestException('Choose a future date and time.');const listId=campaign.listId;if(!listId)throw new BadRequestException('Choose a subscriber list before sending.');const recipientCount=await this.validateAudience(u.tenantId,campaign);const day=quotaDay(date);await this.reserve(u.tenantId,recipientCount,day);try{await prisma.$transaction(async tx=>{const claimed=await tx.campaign.updateMany({where:{id,tenantId:u.tenantId,status:'DRAFT'},data:{status:'PREPARING',quotaDate:day}});if(claimed.count!==1)throw new BadRequestException('This campaign is already being prepared or scheduled.');await this.createRecipients(tx,u.tenantId,id,listId,'PENDING',recipientCount);await tx.campaign.update({where:{id},data:{status:'SCHEDULED',scheduledAt:date}});});return {scheduledAt:date,recipients:recipientCount};}catch(error){await this.releaseReservation(u.tenantId,day,recipientCount);throw error;}}
 async reschedule(req:Request,id:string,at:string){
  const u=await this.actor(req);this.canWrite(u.role);
  const date=new Date(at);if(Number.isNaN(date.getTime())||date<=new Date())throw new BadRequestException('Choose a future date and time.');
  const targetDay=quotaDay(date);
  const result=await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
   if(date<=new Date())throw new BadRequestException('Choose a future date and time.');
   const campaign=await tx.campaign.findFirst({where:{id,tenantId:u.tenantId}});
   if(!campaign)throw new NotFoundException('Campaign not found.');
   if(campaign.status!=='SCHEDULED')throw new BadRequestException('Only a scheduled campaign can be rescheduled.');
   if(!campaign.quotaDate)throw new BadRequestException('The existing campaign quota reservation is missing.');
   const reservedCount=await tx.campaignRecipient.count({where:{campaignId:id,status:'PENDING',quotaReserved:true}});
   const pendingCount=await tx.campaignRecipient.count({where:{campaignId:id,status:'PENDING'}});
   if(reservedCount!==pendingCount)throw new BadRequestException('Scheduled recipients do not have matching quota reservations. Contact support before changing this schedule.');
   const oldDay=new Date(campaign.quotaDate);oldDay.setUTCHours(0,0,0,0);
   if(oldDay.getTime()===targetDay.getTime()){
    const changed=await tx.campaign.updateMany({where:{id,tenantId:u.tenantId,status:'SCHEDULED'},data:{scheduledAt:date}});
    if(!changed.count)throw new BadRequestException('This campaign is no longer scheduled.');
    return {scheduledAt:date,quotaDate:targetDay,recipients:reservedCount};
   }
   const tenant=await tx.tenant.findUnique({where:{id:u.tenantId},select:{status:true}});
   if(tenant?.status!=='active')throw new ForbiddenException('Sending is paused for this workspace.');
   const limits=await tx.tenantSendingLimit.findUnique({where:{tenantId:u.tenantId}});
   if(!limits?.enabled)throw new ForbiddenException('Sending is paused for this workspace.');
   const control=await tx.platformControl.findUniqueOrThrow({where:{id:1},select:{dailySendLimit:true,monthlySendLimit:true}});
   const {daily:platformDaily,monthly:platformMonthly}=effectivePlatformSendLimits(control,process.env);
   const targetMonthStart=new Date(Date.UTC(targetDay.getUTCFullYear(),targetDay.getUTCMonth(),1));
   const targetMonthEnd=new Date(Date.UTC(targetDay.getUTCFullYear(),targetDay.getUTCMonth()+1,1));
   await tx.$executeRaw`INSERT INTO daily_usage (id, tenant_id, usage_date, sent_count, reserved_count, created_at) VALUES (gen_random_uuid(), ${u.tenantId}::uuid, ${targetDay}::date, 0, 0, NOW()) ON CONFLICT (tenant_id, usage_date) DO NOTHING`;
   await tx.platformDailyUsage.upsert({where:{usageDate:targetDay},create:{usageDate:targetDay},update:{}});
   const targetTenantDay=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId:u.tenantId,usageDate:targetDay}}});
   const targetPlatformDay=await tx.platformDailyUsage.findUnique({where:{usageDate:targetDay}});
   const targetTenantMonth=await tx.dailyUsage.aggregate({where:{tenantId:u.tenantId,usageDate:{gte:targetMonthStart,lt:targetMonthEnd}},_sum:{sentCount:true,reservedCount:true}});
   const targetPlatformMonth=await tx.platformDailyUsage.aggregate({where:{usageDate:{gte:targetMonthStart,lt:targetMonthEnd}},_sum:{sentCount:true,reservedCount:true}});
   const oldTenantDay=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId:u.tenantId,usageDate:oldDay}}});
   const oldPlatformDay=await tx.platformDailyUsage.findUnique({where:{usageDate:oldDay}});
   if(!targetTenantDay||!targetPlatformDay||!oldTenantDay||!oldPlatformDay||oldTenantDay.reservedCount<reservedCount||oldPlatformDay.reservedCount<reservedCount)throw new BadRequestException('The existing quota reservation is inconsistent. Contact support before changing this schedule.');
   const sameMonth=oldDay.getUTCFullYear()===targetDay.getUTCFullYear()&&oldDay.getUTCMonth()===targetDay.getUTCMonth();
   const tenantMonthUsage=(targetTenantMonth._sum.sentCount??0)+(targetTenantMonth._sum.reservedCount??0)+(sameMonth?0:reservedCount);
   const platformMonthUsage=(targetPlatformMonth._sum.sentCount??0)+(targetPlatformMonth._sum.reservedCount??0)+(sameMonth?0:reservedCount);
   if(targetTenantDay.sentCount+targetTenantDay.reservedCount+reservedCount>limits.dailyLimit||tenantMonthUsage>limits.monthlyLimit)throw new BadRequestException('The new date exceeds this workspace sending quota. Choose another date.');
   if(targetPlatformDay.sentCount+targetPlatformDay.reservedCount+reservedCount>platformDaily||platformMonthUsage>platformMonthly)throw new BadRequestException('The new date exceeds Repus sending capacity. Choose another date.');
   if(reservedCount){
    const releasedTenant=await tx.dailyUsage.updateMany({where:{tenantId:u.tenantId,usageDate:oldDay,reservedCount:{gte:reservedCount}},data:{reservedCount:{decrement:reservedCount}}});
    const releasedPlatform=await tx.platformDailyUsage.updateMany({where:{usageDate:oldDay,reservedCount:{gte:reservedCount}},data:{reservedCount:{decrement:reservedCount}}});
    if(releasedTenant.count!==1||releasedPlatform.count!==1)throw new BadRequestException('The existing quota reservation changed; reload and try again.');
    await tx.dailyUsage.update({where:{tenantId_usageDate:{tenantId:u.tenantId,usageDate:targetDay}},data:{reservedCount:{increment:reservedCount}}});
    await tx.platformDailyUsage.update({where:{usageDate:targetDay},data:{reservedCount:{increment:reservedCount}}});
    const moved=await tx.campaignRecipient.updateMany({where:{campaignId:id,status:'PENDING',quotaReserved:true,quotaDate:oldDay},data:{quotaDate:targetDay}});
    if(moved.count!==reservedCount)throw new BadRequestException('Scheduled recipients changed while quota reservations were being moved.');
   }
   const changed=await tx.campaign.updateMany({where:{id,tenantId:u.tenantId,status:'SCHEDULED'},data:{scheduledAt:date,quotaDate:targetDay}});
   if(!changed.count)throw new BadRequestException('This campaign is no longer scheduled.');
   return {scheduledAt:date,quotaDate:targetDay,recipients:reservedCount};
  });
  return result;
 }
 async cancel(req:Request,id:string){
  const u=await this.actor(req);this.canWrite(u.role);
  const campaign=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});
  if(!campaign)throw new NotFoundException('Campaign not found.');
  if(!['SCHEDULED','QUEUED','PAUSED'].includes(campaign.status))throw new BadRequestException('This campaign can no longer be cancelled.');
  await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
   const claimed=await tx.campaign.updateMany({where:{id,tenantId:u.tenantId,status:{in:['SCHEDULED','QUEUED','PAUSED']}},data:{status:'CANCELLED'}});
   if(!claimed.count)throw new BadRequestException('This campaign changed state and can no longer be cancelled. Reload and try again.');
   const released=await tx.$queryRaw<Array<{quotaDate:Date}>>`UPDATE campaign_recipients SET quota_reserved=false,status='SUPPRESSED'::"RecipientStatus" WHERE tenant_id=${u.tenantId}::uuid AND campaign_id=${id}::uuid AND quota_reserved=true AND status IN ('PENDING'::"RecipientStatus",'QUEUED'::"RecipientStatus") RETURNING quota_date AS "quotaDate"`;
   const byDay=new Map<string,{date:Date;count:number}>();
   for(const row of released){
    const date=new Date(row.quotaDate);date.setUTCHours(0,0,0,0);
    const key=date.toISOString().slice(0,10);const entry=byDay.get(key)??{date,count:0};entry.count++;byDay.set(key,entry);
   }
   for(const [key,entry] of byDay){
    const tenantRelease=await tx.dailyUsage.updateMany({where:{tenantId:u.tenantId,usageDate:entry.date,reservedCount:{gte:entry.count}},data:{reservedCount:{decrement:entry.count}}});
    const platformRelease=await tx.platformDailyUsage.updateMany({where:{usageDate:entry.date,reservedCount:{gte:entry.count}},data:{reservedCount:{decrement:entry.count}}});
    if(tenantRelease.count!==1||platformRelease.count!==1)throw new Error(`Quota reservation mismatch while cancelling campaign ${id} for ${key}.`);
   }
  });
  const interruptedWorkerCount=await publishSendInterrupt({scope:'campaign',campaignId:id});
  return {success:true,inFlightMayComplete:true,inFlightInterruptionPublished:(interruptedWorkerCount??0)>0};
 }
 async testSend(req:Request,id:string,email:string){const u=await this.actor(req);this.canWrite(u.role);if(await isPlatformSendingPaused())throw new ForbiddenException('Repus has temporarily paused sending. Please try again after service is restored.');const c=await prisma.campaign.findFirst({where:{id,tenantId:u.tenantId}});if(!c)throw new NotFoundException('Campaign not found.');if(!c.subject||!c.htmlContent||!c.fromEmail)throw new BadRequestException('Add the subject, sender, and content before sending a test.');const [tenant,limits]=await Promise.all([prisma.tenant.findUnique({where:{id:u.tenantId},select:{status:true}}),prisma.tenantSendingLimit.findUnique({where:{tenantId:u.tenantId},select:{enabled:true}})]);const workspaceBlock=workspaceSendBlock(tenant?.status??null,limits?.enabled??null);if(workspaceBlock)throw new ForbiddenException(workspaceBlock);const domain=c.fromEmail.split('@')[1]?.toLowerCase();const domainRecord=domain?await prisma.sendingDomain.findFirst({where:{tenantId:u.tenantId,domain}}):null;const domainBlock=sendingDomainSendBlock(domainRecord,process.env.EMAIL_PROVIDER??'development');if(domainBlock)throw new BadRequestException(domainBlock);const fields={first_name:'there',last_name:'',email:email.trim().toLowerCase(),unsubscribe_url:'#unsubscribe-preview',preview_text:c.previewText};if(redis.status!=='ready')throw new ServiceUnavailableException();const html=renderEmailHtml(c.htmlContent,fields);await afterTenantCommit(async()=>{if(redis.status!=='ready')throw new ServiceUnavailableException();try{await rawSendingQueue.add('send-test',{email:fields.email,from:c.fromEmail,fromName:c.fromName,replyTo:c.replyTo,subject:`[Test] ${renderEmailSubject(c.subject??'',fields)}`,html,text:renderEmailTextAlternative(c.textContent,html,fields),tenantId:u.tenantId,campaignId:c.id},{priority:EMAIL_JOB_PRIORITIES.test,attempts:3,backoff:{type:'exponential',delay:3000},removeOnComplete:100,removeOnFail:1000});}catch{throw new ServiceUnavailableException();}},{required:true});return {queued:true};}
}

@ApiTags('campaigns') @Controller('campaigns')
export class CampaignsController{
 constructor(private service:CampaignsService){}
 @Get() list(@Req()r:Request,@Query('view')view?:string,@Query('page')page?:string){
  if(view==='summary'&&page!==undefined)return this.service.summaryPage(r,page);
  return this.service.list(r,view).then(data=>({data}));
 }
 @Post() create(@Req()r:Request,@Body()d:CreateCampaignDto){return this.service.create(r,d).then(data=>({data}));}
 @Get(':id') get(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return this.service.get(r,id).then(data=>({data}));}
 @Post(':id/preview') preview(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return this.service.preview(r,id).then(data=>({data}));}
 @Patch(':id') update(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:UpdateCampaignDto){return this.service.update(r,id,d).then(data=>({data}));}
 @Delete(':id') remove(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return this.service.remove(r,id).then(data=>({data}));}
 @Post(':id/send') send(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return this.service.sendNow(r,id).then(data=>({data}));}
 @Post(':id/schedule') schedule(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:ScheduleDto){return this.service.schedule(r,id,d.scheduledAt).then(data=>({data}));}
 @Post(':id/reschedule') reschedule(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:ScheduleDto){return this.service.reschedule(r,id,d.scheduledAt).then(data=>({data}));}
 @Post(':id/pause') pause(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return this.service.pause(r,id).then(data=>({data}));}
 @Post(':id/resume') resume(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return this.service.resume(r,id).then(data=>({data}));}
 @Post(':id/cancel') cancel(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return this.service.cancel(r,id).then(data=>({data}));}
 @Post(':id/test') @Throttle({default:TEST_SEND_RATE_LIMIT}) test(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:TestSendDto){return this.service.testSend(r,id,d.email).then(data=>({data}));}
}


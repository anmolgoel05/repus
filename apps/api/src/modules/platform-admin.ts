import type {Prisma} from '@repus/database';
import {Body,Controller,ForbiddenException,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Patch,Query,Req,BadRequestException} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {IsBoolean,IsIn,IsInt,IsOptional,IsString,Max,MaxLength,Min,MinLength} from 'class-validator';
import {Request} from 'express';
import {prisma,recordProviderAcceptance,withPlatformAdmin} from '@repus/database';
import {AuthService} from './auth';
import {effectivePlatformSendLimits,platformQuotaDate} from '@repus/validation';
import {publishSendInterrupt} from './send-interrupts';
import {resolveDefaultTenantLimits} from './tenant-default-limits';

class UpdateTenantAdminDto{
 @IsOptional() @IsIn(['active','paused','suspended']) status?:string;
 @IsOptional() @IsInt() @Min(0) @Max(10_000_000) dailyLimit?:number;
 @IsOptional() @IsInt() @Min(0) @Max(100_000_000) monthlyLimit?:number;
 @IsOptional() @IsInt() @Min(0) @Max(100_000_000) contactLimit?:number;
 @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) mediaStorageLimitBytes?:number;
 @IsOptional() @IsIn([true,false]) enabled?:boolean;
}
class UpdatePlatformSettingsDto{
 @IsOptional() @IsBoolean() sendingPaused?:boolean;
 @IsOptional() @IsInt() @Min(0) @Max(100_000_000) dailySendLimit?:number|null;
 @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) monthlySendLimit?:number|null;
 @IsOptional() @IsInt() @Min(0) @Max(10_000_000) defaultTenantDailyLimit?:number|null;
 @IsOptional() @IsInt() @Min(0) @Max(100_000_000) defaultTenantMonthlyLimit?:number|null;
}
class UpdateAbuseReportDto{@IsIn(['in_review','resolved','rejected']) status!:string;}
class ResolveUncertainSendDto{
 @IsIn(['accepted','not_accepted']) outcome!:string;
 @IsString() @MinLength(10) @MaxLength(500) evidence!:string;
 @IsOptional() @IsString() @MinLength(1) @MaxLength(256) messageId?:string;
}

@Injectable()
export class PlatformAdminService{
 constructor(private auth:AuthService){}
 private async actor(req:Request){const user=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!user.platformAdmin)throw new ForbiddenException('Platform administrator access is required.');return user;}
 async overview(req:Request,pageInput?:string,sizeInput?:string){const actor=await this.actor(req);const page=Math.max(1,Number.parseInt(pageInput??'1',10)||1);const pageSize=Math.min(100,Math.max(1,Number.parseInt(sizeInput??'25',10)||25));return withPlatformAdmin(async()=>{
  const now=new Date();const zone=process.env.PLATFORM_TIMEZONE??'Asia/Kolkata';const usageDate=platformQuotaDate(now,zone);
  const monthStart=new Date(Date.UTC(usageDate.getUTCFullYear(),usageDate.getUTCMonth(),1));const monthEnd=new Date(Date.UTC(monthStart.getUTCFullYear(),monthStart.getUTCMonth()+1,1));
  const [total,active,paused,suspended,tenants,usage,monthlyUsage,control]=await Promise.all([
   prisma.tenant.count(),prisma.tenant.count({where:{status:'active'}}),prisma.tenant.count({where:{status:'paused'}}),prisma.tenant.count({where:{status:'suspended'}}),
   prisma.tenant.findMany({skip:(page-1)*pageSize,take:pageSize,orderBy:{createdAt:'desc'},include:{_count:{select:{users:true}},sendingLimit:true}}),
   prisma.platformDailyUsage.findUnique({where:{usageDate}}),
   prisma.platformDailyUsage.aggregate({where:{usageDate:{gte:monthStart,lt:monthEnd}},_sum:{sentCount:true,reservedCount:true}}),
   prisma.platformControl.findUniqueOrThrow({where:{id:1}})
  ]);
  const metricsSince=new Date(now.getTime()-30*24*60*60*1000);
  const platformMetrics={totalContacts:0,acceptedLast30Days:0,deliveredLast30Days:0,bouncesLast30Days:0,complaintsLast30Days:0};
  const allTenantIds=await prisma.tenant.findMany({select:{id:true}});
  for(const tenant of allTenantIds){
   await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
   const [counts]=await prisma.$queryRaw<Array<{contacts:bigint;accepted:bigint;delivered:bigint;bounces:bigint;complaints:bigint}>>`
    SELECT
     (SELECT COUNT(*) FROM contacts WHERE tenant_id=${tenant.id}::uuid AND deleted_at IS NULL) AS contacts,
     COUNT(*) AS accepted,
     COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events e WHERE e.tenant_id=cr.tenant_id AND e.recipient_id=cr.id AND e.event_type='delivered')) AS delivered,
     COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events e WHERE e.tenant_id=cr.tenant_id AND e.recipient_id=cr.id AND e.event_type='bounce')) AS bounces,
     COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events e WHERE e.tenant_id=cr.tenant_id AND e.recipient_id=cr.id AND e.event_type='complaint')) AS complaints
    FROM campaign_recipients cr WHERE cr.tenant_id=${tenant.id}::uuid AND cr.provider_accepted_at >= ${metricsSince}`;
   platformMetrics.totalContacts+=Number(counts.contacts);platformMetrics.acceptedLast30Days+=Number(counts.accepted);platformMetrics.deliveredLast30Days+=Number(counts.delivered);platformMetrics.bouncesLast30Days+=Number(counts.bounces);platformMetrics.complaintsLast30Days+=Number(counts.complaints);
  }
  const tenantRows=[];
  for(const t of tenants){
   await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${t.id}, true)`;
   const [contacts,campaigns]=await Promise.all([prisma.contact.count({where:{tenantId:t.id,deletedAt:null}}),prisma.campaign.count({where:{tenantId:t.id}})]);
   tenantRows.push({id:t.id,name:t.name,slug:t.slug,plan:t.plan,status:t.status,timezone:t.timezone,createdAt:t.createdAt,members:t._count.users,contacts,campaigns,sendingLimit:t.sendingLimit});
  }
  await prisma.platformAuditLog.create({data:{actorUserId:actor.id,actorEmail:actor.email,action:'platform.overview.viewed',metadata:{page,pageSize}}});
  const rate=(count:number)=>platformMetrics.acceptedLast30Days?count/platformMetrics.acceptedLast30Days:null;
  const effectiveLimits=effectivePlatformSendLimits(control,process.env);
  return {summary:{tenantCount:total,activeTenants:active,pausedTenants:paused,suspendedTenants:suspended,totalContacts:platformMetrics.totalContacts,acceptedLast30Days:platformMetrics.acceptedLast30Days,deliveredLast30Days:platformMetrics.deliveredLast30Days,deliveryRateLast30Days:rate(platformMetrics.deliveredLast30Days),bounceRateLast30Days:rate(platformMetrics.bouncesLast30Days),complaintRateLast30Days:rate(platformMetrics.complaintsLast30Days),usageDate,sentToday:usage?.sentCount??0,reservedToday:usage?.reservedCount??0,sentThisMonth:monthlyUsage._sum.sentCount??0,reservedThisMonth:monthlyUsage._sum.reservedCount??0,dailyLimit:effectiveLimits.daily,monthlyLimit:effectiveLimits.monthly},tenants:tenantRows,pagination:{page,pageSize,total}};
 },{maxWait:10_000,timeout:60_000});}
 async platformSettings(req:Request){await this.actor(req);return withPlatformAdmin(async()=>{const control=await prisma.platformControl.findUniqueOrThrow({where:{id:1}});const effective=effectivePlatformSendLimits(control,process.env);return {...control,effectiveDailySendLimit:effective.daily,effectiveMonthlySendLimit:effective.monthly,tenantDefaults:resolveDefaultTenantLimits(control)};},{maxWait:5000,timeout:8000});}
 async updatePlatformSettings(req:Request,dto:UpdatePlatformSettingsDto){
  const actor=await this.actor(req);if(!Object.keys(dto).length)throw new BadRequestException('Choose at least one platform setting to update.');
  const control=await withPlatformAdmin(async()=>{
   if(dto.dailySendLimit!==undefined||dto.monthlySendLimit!==undefined)await prisma.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
   const data:any={updatedByUserId:actor.id};
   if(dto.sendingPaused!==undefined)data.sendingPaused=dto.sendingPaused;
   if(dto.dailySendLimit!==undefined)data.dailySendLimit=dto.dailySendLimit;
   if(dto.monthlySendLimit!==undefined)data.monthlySendLimit=dto.monthlySendLimit;
   if(dto.defaultTenantDailyLimit!==undefined)data.defaultTenantDailyLimit=dto.defaultTenantDailyLimit;
   if(dto.defaultTenantMonthlyLimit!==undefined)data.defaultTenantMonthlyLimit=dto.defaultTenantMonthlyLimit;
   const updated=await prisma.platformControl.update({where:{id:1},data});
   const limitChanges:Record<string,number|null>={};
   if(dto.dailySendLimit!==undefined)limitChanges.dailySendLimit=dto.dailySendLimit;
   if(dto.monthlySendLimit!==undefined)limitChanges.monthlySendLimit=dto.monthlySendLimit;
   if(dto.defaultTenantDailyLimit!==undefined)limitChanges.defaultTenantDailyLimit=dto.defaultTenantDailyLimit;
   if(dto.defaultTenantMonthlyLimit!==undefined)limitChanges.defaultTenantMonthlyLimit=dto.defaultTenantMonthlyLimit;
   const action=dto.sendingPaused!==undefined?(dto.sendingPaused?'platform.sending.paused':'platform.sending.resumed'):'platform.sending_limits.updated';
   await prisma.platformAuditLog.create({data:{actorUserId:actor.id,actorEmail:actor.email,action,metadata:{...(dto.sendingPaused!==undefined?{sendingPaused:dto.sendingPaused}:{}),...(Object.keys(limitChanges).length?{limits:limitChanges}: {})}}});
   const effective=effectivePlatformSendLimits(updated,process.env);
   return {...updated,effectiveDailySendLimit:effective.daily,effectiveMonthlySendLimit:effective.monthly,tenantDefaults:resolveDefaultTenantLimits(updated)};
  },{maxWait:5000,timeout:8000});
  const interruptedWorkerCount=dto.sendingPaused===true?await publishSendInterrupt({scope:'all'}):null;
  return {...control,...(dto.sendingPaused===true?{inFlightInterruptionPublished:(interruptedWorkerCount??0)>0}:{})};
 }
 async abuseReports(req:Request,pageInput?:string,sizeInput?:string,statusInput='active'){
  await this.actor(req);
  const page=Math.max(1,Math.min(100_000,Number.parseInt(pageInput??'1',10)||1));
  const pageSize=Math.min(100,Math.max(1,Number.parseInt(sizeInput??'25',10)||25));
  const statuses:Record<string,string[]>={active:['open','in_review'],resolved:['resolved'],rejected:['rejected']};
  if(statusInput!=='all'&&!statuses[statusInput])throw new BadRequestException('Choose active, resolved, rejected, or all reports.');
  const where=statusInput==='all'?{}:{status:{in:statuses[statusInput]}};
  return withPlatformAdmin(async()=>{
   const [items,total]=await Promise.all([
    prisma.abuseReport.findMany({where,orderBy:[{createdAt:'asc'},{id:'asc'}],skip:(page-1)*pageSize,take:pageSize}),
    prisma.abuseReport.count({where}),
   ]);
   return {items,page,pageSize,total,status:statusInput};
  });
 }
 async uncertainSends(req:Request,pageInput?:string){const actor=await this.actor(req);const page=Math.max(1,Math.min(1000,Number.parseInt(pageInput??'1',10)||1));const staleBefore=new Date(Date.now()-15*60_000);return withPlatformAdmin(async()=>{
  const staleWhere={status:'SENDING',sendStartedAt:{lt:staleBefore}} as const;
  const tenantIds=await prisma.tenant.findMany({select:{id:true}});const candidates:any[]=[];let total=0;
  for(const tenant of tenantIds){
   await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
   const [count,rows]=await Promise.all([
    prisma.campaignRecipient.count({where:{...staleWhere,tenantId:tenant.id}}),
    prisma.campaignRecipient.findMany({where:{...staleWhere,tenantId:tenant.id},orderBy:[{sendStartedAt:'asc'},{id:'asc'}],take:page*100,select:{id:true,tenantId:true,campaignId:true,email:true,status:true,sendStartedAt:true,providerMessageId:true,quotaReserved:true,campaign:{select:{name:true,tenant:{select:{name:true}}}}}}),
   ]);
   total+=count;candidates.push(...rows);
  }
  candidates.sort((a,b)=>a.sendStartedAt.getTime()-b.sendStartedAt.getTime()||a.id.localeCompare(b.id));
  const items=candidates.slice((page-1)*100,page*100);
  await prisma.platformAuditLog.create({data:{actorUserId:actor.id,actorEmail:actor.email,action:'platform.uncertain_sends.viewed',metadata:{page,pageSize:100,total}}});
  return {items,page,pageSize:100,total};
 },{maxWait:10_000,timeout:20_000});}
 async resolveUncertainSend(req:Request,id:string,dto:ResolveUncertainSendDto){
  const actor=await this.actor(req);
  if(dto.outcome==='accepted'&&!dto.messageId)throw new BadRequestException('A provider message ID is required when confirming acceptance.');
  if(dto.outcome==='not_accepted'&&dto.messageId)throw new BadRequestException('Do not provide a provider message ID when confirming non-acceptance.');
  const evidence=dto.evidence.trim();if(evidence.length<10)throw new BadRequestException('Add a supportable evidence note of at least 10 characters.');
  return withPlatformAdmin(async()=>prisma.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
   const tenantIds=await tx.tenant.findMany({select:{id:true}});let row:any=null;
   for(const tenant of tenantIds){await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;row=await tx.campaignRecipient.findFirst({where:{id,tenantId:tenant.id}});if(row)break;}
   if(!row)throw new NotFoundException('Recipient not found.');
   const staleBefore=new Date(Date.now()-15*60_000);
   if(row.status!=='SENDING'||!row.sendStartedAt||row.sendStartedAt>=staleBefore)throw new BadRequestException('This recipient is no longer awaiting provider review. Refresh the list and try again.');
   if(dto.outcome==='accepted'&&row.providerMessageId&&row.providerMessageId!==dto.messageId)throw new BadRequestException('The provider message ID does not match the ID already recorded for this recipient.');
   if(dto.outcome==='accepted'){
    const acceptedAt=new Date();
    await recordProviderAcceptance(tx,{recipientId:id,messageId:dto.messageId!,acceptedAt,source:'operator_review'});
    await tx.campaignRecipient.updateMany({where:{id,status:'SENDING',providerAcceptedAt:{not:null}},data:{status:'SENT'}});
   }else{
    const changed=await tx.campaignRecipient.updateMany({where:{id,status:'SENDING'},data:{status:'FAILED',quotaReserved:false,sendStartedAt:null}});
    if(changed.count&&row.quotaReserved){
     const quotaDate=new Date(row.quotaDate);quotaDate.setUTCHours(0,0,0,0);
     await tx.dailyUsage.updateMany({where:{tenantId:row.tenantId,usageDate:quotaDate,reservedCount:{gt:0}},data:{reservedCount:{decrement:1}}});
     await tx.platformDailyUsage.updateMany({where:{usageDate:quotaDate,reservedCount:{gt:0}},data:{reservedCount:{decrement:1}}});
    }
   }
   await tx.platformAuditLog.create({data:{actorUserId:actor.id,actorEmail:actor.email,tenantId:row.tenantId,action:'platform.uncertain_send.resolved',metadata:{recipientId:id,campaignId:row.campaignId,outcome:dto.outcome,...(dto.messageId?{messageId:dto.messageId}:{}),evidence}}});
   const active=await tx.campaignRecipient.count({where:{campaignId:row.campaignId,status:{in:['PENDING','QUEUED','SENDING']}}});
   if(!active){const accepted=await tx.campaignRecipient.count({where:{campaignId:row.campaignId,sentAt:{not:null}}});await tx.campaign.updateMany({where:{id:row.campaignId,status:{in:['QUEUED','SENDING','FAILED']}},data:{status:accepted?'COMPLETED':'FAILED',completedAt:new Date()}});}
   return {success:true,status:dto.outcome==='accepted'?'SENT':'FAILED'};
  }),{maxWait:10_000,timeout:20_000});
 }
 async updateAbuseReport(req:Request,id:string,dto:UpdateAbuseReportDto){const actor=await this.actor(req);return withPlatformAdmin(async()=>{const report=await prisma.abuseReport.update({where:{id},data:{status:dto.status}});await prisma.platformAuditLog.create({data:{actorUserId:actor.id,actorEmail:actor.email,action:'platform.abuse_report.updated',metadata:{reportId:id,status:dto.status}}});return report;},{maxWait:5000,timeout:8000});}
 async updateTenant(req:Request,id:string,dto:UpdateTenantAdminDto){const actor=await this.actor(req);if(!Object.keys(dto).length)throw new BadRequestException('Choose at least one tenant setting to update.');const quotaFields=['dailyLimit','monthlyLimit','contactLimit','mediaStorageLimitBytes'] as const;const result=await withPlatformAdmin(async()=>{
  if(dto.status!==undefined||dto.dailyLimit!==undefined||dto.monthlyLimit!==undefined||dto.enabled!==undefined)await prisma.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
  const tenant=await prisma.tenant.findUnique({where:{id}});if(!tenant)throw new NotFoundException('Workspace not found.');
  const existingLimits=await prisma.tenantSendingLimit.findUnique({where:{tenantId:id}});
  const limitFields={dailyLimit:dto.dailyLimit,monthlyLimit:dto.monthlyLimit,contactLimit:dto.contactLimit,mediaStorageLimitBytes:dto.mediaStorageLimitBytes,enabled:dto.enabled};const limitData:Prisma.TenantSendingLimitUpdateInput=Object.fromEntries(Object.entries(limitFields).filter(([,value])=>value!==undefined));
  const existingOverrides=Array.isArray(existingLimits?.quotaOverrides)?existingLimits.quotaOverrides.filter((field):field is string=>typeof field==='string'&&quotaFields.includes(field as typeof quotaFields[number])):[];
  const changedQuotaFields=quotaFields.filter(field=>dto[field]!==undefined);
  if(changedQuotaFields.length)limitData.quotaOverrides=[...new Set([...existingOverrides,...changedQuotaFields])];
  if(dto.status!==undefined)await prisma.tenant.update({where:{id},data:{status:dto.status}});
  if(Object.keys(limitData).length)await prisma.tenantSendingLimit.upsert({where:{tenantId:id},create:{tenantId:id,dailyLimit:dto.dailyLimit??500,monthlyLimit:dto.monthlyLimit??15000,contactLimit:dto.contactLimit??10000,mediaStorageLimitBytes:dto.mediaStorageLimitBytes??104857600,enabled:dto.enabled??true,quotaOverrides:[...new Set([...existingOverrides,...changedQuotaFields])]},update:limitData});
  const result=await prisma.tenant.findUnique({where:{id},include:{sendingLimit:true}});
  const changes:Record<string,string|number|boolean>={};if(dto.status!==undefined)changes.status=dto.status;if(dto.dailyLimit!==undefined)changes.dailyLimit=dto.dailyLimit;if(dto.monthlyLimit!==undefined)changes.monthlyLimit=dto.monthlyLimit;if(dto.contactLimit!==undefined)changes.contactLimit=dto.contactLimit;if(dto.mediaStorageLimitBytes!==undefined)changes.mediaStorageLimitBytes=dto.mediaStorageLimitBytes;if(dto.enabled!==undefined)changes.enabled=dto.enabled;
  await prisma.platformAuditLog.create({data:{actorUserId:actor.id,actorEmail:actor.email,action:'platform.tenant.updated',tenantId:id,metadata:{changes}}});
  return result;
 },{maxWait:10_000,timeout:20_000});
  const shouldInterrupt=dto.status==='paused'||dto.status==='suspended'||dto.enabled===false;
  const interruptedWorkerCount=shouldInterrupt?await publishSendInterrupt({scope:'tenant',tenantId:id}):null;
  return {...result,...(shouldInterrupt?{inFlightInterruptionPublished:(interruptedWorkerCount??0)>0}:{})};
 }
}

@ApiTags('platform administration')
@Controller('admin')
export class PlatformAdminController{
 constructor(private service:PlatformAdminService){}
 @Get('overview') async overview(@Req()req:Request,@Query('page')page?:string,@Query('pageSize')pageSize?:string){return {data:await this.service.overview(req,page,pageSize)};}
 @Get('settings') async settings(@Req()req:Request){return {data:await this.service.platformSettings(req)};}
 @Patch('settings') async updateSettings(@Req()req:Request,@Body()dto:UpdatePlatformSettingsDto){return {data:await this.service.updatePlatformSettings(req,dto)};}
 @Get('abuse-reports') async abuseReports(@Req()req:Request,@Query('page')page?:string,@Query('pageSize')pageSize?:string,@Query('status')status?:string){return {data:await this.service.abuseReports(req,page,pageSize,status)};}
 @Get('uncertain-sends') async uncertainSends(@Req()req:Request,@Query('page')page?:string){return {data:await this.service.uncertainSends(req,page)};}
 @Patch('uncertain-sends/:id') async resolveUncertainSend(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string,@Body()dto:ResolveUncertainSendDto){return {data:await this.service.resolveUncertainSend(req,id,dto)};}
 @Patch('abuse-reports/:id') async updateAbuseReport(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string,@Body()dto:UpdateAbuseReportDto){return {data:await this.service.updateAbuseReport(req,id,dto)};}
 @Patch('tenants/:id') async updateTenant(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string,@Body()dto:UpdateTenantAdminDto){return {data:await this.service.updateTenant(req,id,dto)};}
}


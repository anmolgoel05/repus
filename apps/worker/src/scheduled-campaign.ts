import type {PrismaClient} from '@repus/database';
import {effectivePlatformSendLimits,platformQuotaDate} from '@repus/validation';

function campaignQuotaDate(value:Date|null,fallback:Date){const day=new Date(value??fallback);day.setUTCHours(0,0,0,0);return day;}
function platformQuotaDay(value:Date){return platformQuotaDate(value,process.env.PLATFORM_TIMEZONE??'Asia/Kolkata');}

export async function queueDueCampaign(prisma:PrismaClient,campaignId:string):Promise<{ready:boolean;queuedCount:number;reason?:string}>{
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
  const campaign=await tx.campaign.findUnique({where:{id:campaignId}});
  if(!campaign||campaign.status!=='SCHEDULED'||!campaign.scheduledAt||campaign.scheduledAt>new Date())return {ready:false,queuedCount:0,reason:'campaign_not_due'};
  const tenant=await tx.tenant.findUnique({where:{id:campaign.tenantId},select:{status:true}});
  const limits=await tx.tenantSendingLimit.findUnique({where:{tenantId:campaign.tenantId}});
  if(tenant?.status!=='active'||!limits?.enabled)return {ready:false,queuedCount:0,reason:'workspace_paused'};
  if(!campaign.quotaDate)return {ready:false,queuedCount:0,reason:'reservation_date_missing'};
  const priorDay=campaignQuotaDate(campaign.quotaDate,new Date());
  const quotaDay=platformQuotaDay(new Date());
  const dateMoved=priorDay.getTime()!==quotaDay.getTime();
  const reservedCount=await tx.campaignRecipient.count({where:{campaignId,status:'PENDING',quotaReserved:true}});
  const pendingCount=await tx.campaignRecipient.count({where:{campaignId,status:'PENDING'}});
  if(reservedCount!==pendingCount)throw new Error(`Scheduled campaign ${campaignId} has pending recipients without a quota reservation.`);
  const count=reservedCount;
  const monthStart=new Date(Date.UTC(quotaDay.getUTCFullYear(),quotaDay.getUTCMonth(),1));
  const monthEnd=new Date(Date.UTC(quotaDay.getUTCFullYear(),quotaDay.getUTCMonth()+1,1));
  await tx.$executeRaw`INSERT INTO daily_usage (id, tenant_id, usage_date, sent_count, reserved_count, created_at) VALUES (gen_random_uuid(), ${campaign.tenantId}::uuid, ${quotaDay}::date, 0, 0, NOW()) ON CONFLICT (tenant_id, usage_date) DO NOTHING`;
  await tx.platformDailyUsage.upsert({where:{usageDate:quotaDay},create:{usageDate:quotaDay},update:{}});
  const tenantDay=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId:campaign.tenantId,usageDate:quotaDay}}});
  const platformDay=await tx.platformDailyUsage.findUnique({where:{usageDate:quotaDay}});
  const tenantMonth=await tx.dailyUsage.aggregate({where:{tenantId:campaign.tenantId,usageDate:{gte:monthStart,lt:monthEnd}},_sum:{sentCount:true,reservedCount:true}});
  const platformMonth=await tx.platformDailyUsage.aggregate({where:{usageDate:{gte:monthStart,lt:monthEnd}},_sum:{sentCount:true,reservedCount:true}});
  if(!tenantDay||!platformDay)throw new Error('Quota ledger rows could not be prepared for a scheduled campaign.');
  const monthShifted=priorDay.getUTCFullYear()!==quotaDay.getUTCFullYear()||priorDay.getUTCMonth()!==quotaDay.getUTCMonth();
  const dailyAddition=dateMoved?count:0;
  const tenantMonthUsage=(tenantMonth._sum.sentCount??0)+(tenantMonth._sum.reservedCount??0)+(monthShifted?count:0);
  const platformMonthUsage=(platformMonth._sum.sentCount??0)+(platformMonth._sum.reservedCount??0)+(monthShifted?count:0);
  const control=await tx.platformControl.findUniqueOrThrow({where:{id:1},select:{dailySendLimit:true,monthlySendLimit:true}});
  const {daily:platformDailyLimit,monthly:platformMonthlyLimit}=effectivePlatformSendLimits(control,process.env);
  if(tenantDay.sentCount+tenantDay.reservedCount+dailyAddition>limits.dailyLimit||tenantMonthUsage>limits.monthlyLimit||platformDay.sentCount+platformDay.reservedCount+dailyAddition>platformDailyLimit||platformMonthUsage>platformMonthlyLimit)return {ready:false,queuedCount:0,reason:'quota_unavailable'};
  if(dateMoved&&count){
   const oldTenant=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId:campaign.tenantId,usageDate:priorDay}}});
   const oldPlatform=await tx.platformDailyUsage.findUnique({where:{usageDate:priorDay}});
   if(!oldTenant||oldTenant.reservedCount<count||!oldPlatform||oldPlatform.reservedCount<count)throw new Error(`Scheduled quota reservation mismatch for campaign ${campaignId}.`);
   const releasedTenant=await tx.dailyUsage.updateMany({where:{tenantId:campaign.tenantId,usageDate:priorDay,reservedCount:{gte:count}},data:{reservedCount:{decrement:count}}});
   const releasedPlatform=await tx.platformDailyUsage.updateMany({where:{usageDate:priorDay,reservedCount:{gte:count}},data:{reservedCount:{decrement:count}}});
   if(releasedTenant.count!==1||releasedPlatform.count!==1)throw new Error(`Scheduled quota reservation changed during rebase for campaign ${campaignId}.`);
   await tx.dailyUsage.update({where:{tenantId_usageDate:{tenantId:campaign.tenantId,usageDate:quotaDay}},data:{reservedCount:{increment:count}}});
   await tx.platformDailyUsage.update({where:{usageDate:quotaDay},data:{reservedCount:{increment:count}}});
   const moved=await tx.campaignRecipient.updateMany({where:{campaignId,status:'PENDING',quotaReserved:true,quotaDate:priorDay},data:{quotaDate:quotaDay}});
   if(moved.count!==count)throw new Error(`Scheduled recipient quota dates changed while campaign ${campaignId} was being rebased.`);
  }
  const claimed=await tx.campaign.updateMany({where:{id:campaignId,status:'SCHEDULED'},data:{status:'QUEUED',startedAt:new Date(),quotaDate:quotaDay}});
  if(claimed.count!==1)throw new Error(`Scheduled campaign ${campaignId} changed while it was being queued.`);
  if(count){const queued=await tx.campaignRecipient.updateMany({where:{campaignId,status:'PENDING',quotaReserved:true},data:{status:'QUEUED'}});if(queued.count!==count)throw new Error(`Scheduled recipients changed while campaign ${campaignId} was being queued.`);}
  return {ready:true,queuedCount:count};
 },{isolationLevel:'ReadCommitted'});
}

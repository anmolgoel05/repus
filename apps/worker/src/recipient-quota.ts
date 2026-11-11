import type {PrismaClient} from '@repus/database';
import {effectivePlatformSendLimits,platformQuotaDate} from '@repus/validation';

/** Moves one still-reserved recipient into the actual platform-local send day.
 * The shared quota lock serializes this with reservations and acceptance ledger updates. */
export async function rebaseRecipientQuota(prisma:PrismaClient,recipientId:string,at=new Date()){
 const quotaDay=platformQuotaDate(at,process.env.PLATFORM_TIMEZONE??'Asia/Kolkata');
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
  const recipient=await tx.campaignRecipient.findUnique({where:{id:recipientId},select:{tenantId:true,quotaDate:true,quotaReserved:true,status:true}});
  if(!recipient||recipient.status!=='SENDING')return true;
  if(!recipient.quotaReserved)throw new Error(`Recipient ${recipientId} reached provider submission without a quota reservation.`);
  const priorDay=new Date(recipient.quotaDate);priorDay.setUTCHours(0,0,0,0);
  if(priorDay.getTime()===quotaDay.getTime())return true;

  const tenant=await tx.tenant.findUnique({where:{id:recipient.tenantId},select:{status:true}});
  const limits=await tx.tenantSendingLimit.findUnique({where:{tenantId:recipient.tenantId}});
  if(tenant?.status!=='active')return true;
  if(!limits)throw new Error(`Quota configuration is missing for tenant ${recipient.tenantId}.`);
  if(!limits.enabled)return true;
  const control=await tx.platformControl.findUniqueOrThrow({where:{id:1},select:{dailySendLimit:true,monthlySendLimit:true}});
  const {daily:platformDailyLimit,monthly:platformMonthlyLimit}=effectivePlatformSendLimits(control,process.env);
  const monthStart=new Date(Date.UTC(quotaDay.getUTCFullYear(),quotaDay.getUTCMonth(),1));
  const monthEnd=new Date(Date.UTC(quotaDay.getUTCFullYear(),quotaDay.getUTCMonth()+1,1));
  await tx.$executeRaw`INSERT INTO daily_usage (id, tenant_id, usage_date, sent_count, reserved_count, created_at) VALUES (gen_random_uuid(), ${recipient.tenantId}::uuid, ${quotaDay}::date, 0, 0, NOW()) ON CONFLICT (tenant_id, usage_date) DO NOTHING`;
  await tx.platformDailyUsage.upsert({where:{usageDate:quotaDay},create:{usageDate:quotaDay},update:{}});
  const tenantDay=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId:recipient.tenantId,usageDate:quotaDay}}});
  const platformDay=await tx.platformDailyUsage.findUnique({where:{usageDate:quotaDay}});
  const tenantMonth=await tx.dailyUsage.aggregate({where:{tenantId:recipient.tenantId,usageDate:{gte:monthStart,lt:monthEnd}},_sum:{sentCount:true,reservedCount:true}});
  const platformMonth=await tx.platformDailyUsage.aggregate({where:{usageDate:{gte:monthStart,lt:monthEnd}},_sum:{sentCount:true,reservedCount:true}});
  const oldTenant=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId:recipient.tenantId,usageDate:priorDay}}});
  const oldPlatform=await tx.platformDailyUsage.findUnique({where:{usageDate:priorDay}});
  if(!tenantDay||!platformDay||!oldTenant||!oldPlatform||oldTenant.reservedCount<1||oldPlatform.reservedCount<1)throw new Error(`Quota reservation mismatch for recipient ${recipientId}.`);
  const monthShifted=priorDay.getUTCFullYear()!==quotaDay.getUTCFullYear()||priorDay.getUTCMonth()!==quotaDay.getUTCMonth();
  const tenantMonthUse=(tenantMonth._sum.sentCount??0)+(tenantMonth._sum.reservedCount??0)+(monthShifted?1:0);
  const platformMonthUse=(platformMonth._sum.sentCount??0)+(platformMonth._sum.reservedCount??0)+(monthShifted?1:0);
  if(tenantDay.sentCount+tenantDay.reservedCount+1>limits.dailyLimit||tenantMonthUse>limits.monthlyLimit||platformDay.sentCount+platformDay.reservedCount+1>platformDailyLimit||platformMonthUse>platformMonthlyLimit)return false;

  const claimed=await tx.campaignRecipient.updateMany({where:{id:recipientId,quotaReserved:true,status:'SENDING',quotaDate:priorDay},data:{quotaDate:quotaDay}});
  if(!claimed.count)return false;
  const releasedTenant=await tx.dailyUsage.updateMany({where:{tenantId:recipient.tenantId,usageDate:priorDay,reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}});
  const releasedPlatform=await tx.platformDailyUsage.updateMany({where:{usageDate:priorDay,reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}});
  if(releasedTenant.count!==1||releasedPlatform.count!==1)throw new Error(`Quota reservation changed while rebasing recipient ${recipientId}.`);
  await tx.dailyUsage.update({where:{tenantId_usageDate:{tenantId:recipient.tenantId,usageDate:quotaDay}},data:{reservedCount:{increment:1}}});
  await tx.platformDailyUsage.update({where:{usageDate:quotaDay},data:{reservedCount:{increment:1}}});
  return true;
 },{isolationLevel:'ReadCommitted'});
}

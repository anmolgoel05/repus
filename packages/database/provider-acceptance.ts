import type {Prisma} from './generated/prisma/client';
import {platformQuotaDate} from '@repus/validation';

/** Idempotently accounts a provider-accepted marketing message, whether learned
 * from the send response or a later authenticated provider event. */
export async function recordProviderAcceptance(tx:Prisma.TransactionClient,input:{recipientId:string;messageId:string;acceptedAt:Date;source?:'worker_response'|'provider_event'|'operator_review'}){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
 const recipient=await tx.campaignRecipient.findUnique({where:{id:input.recipientId},select:{tenantId:true,quotaReserved:true,providerAcceptedAt:true,providerMessageId:true,quotaDate:true}});
 if(recipient?.providerMessageId&&recipient.providerMessageId!==input.messageId){
  throw new Error('Provider message ID does not match the recipient record.');
 }
 if(!recipient||recipient.providerAcceptedAt)return {recorded:false};
 const quotaDate=platformQuotaDate(input.acceptedAt,process.env.PLATFORM_TIMEZONE??'Asia/Kolkata');
 const reservedDate=new Date(recipient.quotaDate);reservedDate.setUTCHours(0,0,0,0);
 const claimed=await tx.campaignRecipient.updateMany({where:{id:input.recipientId,providerAcceptedAt:null},data:{providerAcceptedAt:input.acceptedAt,providerMessageId:input.messageId,sentAt:input.acceptedAt,quotaDate,quotaReserved:false,sendStartedAt:null}});
 if(!claimed.count)return {recorded:false};
 const reservation=recipient.quotaReserved?{reservedCount:{decrement:1}}:{};
 if(recipient.quotaReserved&&reservedDate.getTime()!==quotaDate.getTime()){
  const releasedTenant=await tx.dailyUsage.updateMany({where:{tenantId:recipient.tenantId,usageDate:reservedDate,reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}});
  const releasedPlatform=await tx.platformDailyUsage.updateMany({where:{usageDate:reservedDate,reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}});
  if(releasedTenant.count!==1||releasedPlatform.count!==1)throw new Error(`Quota reservation mismatch for accepted recipient ${input.recipientId}.`);
 }
 await tx.dailyUsage.upsert({where:{tenantId_usageDate:{tenantId:recipient.tenantId,usageDate:quotaDate}},create:{tenantId:recipient.tenantId,usageDate:quotaDate,sentCount:1},update:{sentCount:{increment:1},...(recipient.quotaReserved&&reservedDate.getTime()===quotaDate.getTime()?reservation:{})}});
 await tx.platformDailyUsage.upsert({where:{usageDate:quotaDate},create:{usageDate:quotaDate,sentCount:1},update:{sentCount:{increment:1},...(recipient.quotaReserved&&reservedDate.getTime()===quotaDate.getTime()?reservation:{})}});
 await tx.emailEvent.createMany({data:[{tenantId:recipient.tenantId,recipientId:input.recipientId,eventType:'accepted',eventKey:`accepted:${input.recipientId}`,occurredAt:input.acceptedAt,eventData:{providerMessageId:input.messageId,source:input.source??'worker_response'}}],skipDuplicates:true});
 return {recorded:true,quotaDate};
}

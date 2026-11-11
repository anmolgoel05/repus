import {createPrismaClient,recordProviderAcceptance} from '@repus/database';
import {PROVIDER_TERMINAL_FAILURE_EVENTS} from '@repus/validation';
import {reputationPauseReason,reputationThresholds} from './reputation-policy';
import {shouldPromoteProviderSuppression} from './suppression-precedence';
const prisma=createPrismaClient();
export const closeProviderEventDatabase=()=>prisma.$disconnect();
const thresholds=reputationThresholds();
export interface ProviderEvent {providerEventId:string;provider:string;eventType:string;payload:any;}
export const eventName=(value:string)=>({Send:'accepted',send:'accepted',Delivery:'delivered',Bounce:'bounce',Complaint:'complaint',Reject:'reject','Rendering Failure':'rendering_failure',RenderingFailure:'rendering_failure',DeliveryDelay:'delivery_delay',Open:'open',Click:'click',Subscription:'unsubscribe'}[value]??value.toLowerCase());
export const isNonCampaignProviderEvent=(tags:any)=>['subscription_confirmation','test','account'].includes(Array.isArray(tags?.kind)?tags.kind[0]:tags?.kind);
export const providerEventImpliesAcceptance=(type:string)=>['accepted','send','delivered','bounce','complaint','delivery_delay','open','click',...PROVIDER_TERMINAL_FAILURE_EVENTS].includes(type);
export function providerAcceptedAt(payload:any,fallback=new Date()){
 const values=[payload.mail?.timestamp,payload.send?.timestamp,payload.delivery?.timestamp,payload.bounce?.timestamp,payload.complaint?.timestamp,payload.event?.timestamp];
 for(const value of values){if(typeof value!=='string'&&!(value instanceof Date))continue;const date=value instanceof Date?value:new Date(value);if(Number.isFinite(date.getTime()))return date;}
 return fallback;
}

async function reconcileAccountEmail(input:ProviderEvent){
 const tags=input.payload.mail?.tags??input.payload.tags??{};
 const tag=(key:string)=>Array.isArray(tags[key])?tags[key][0]:tags[key];
 if(tag('kind')!=='account'||!providerEventImpliesAcceptance(eventName(input.eventType)))return;
 const tenantId=tag('tenant_id'),id=tag('account_token_id'),messageId=input.payload.mail?.messageId??input.payload.messageId;
 if(typeof tenantId!=='string'||typeof id!=='string'||typeof messageId!=='string')return;
 await prisma.oneTimeToken.updateMany({where:{id,tenantId,deliveryStatus:{in:['SENDING','UNCERTAIN']},OR:[{deliveryMessageId:null},{deliveryMessageId:messageId}]},data:{deliveryStatus:'SENT',deliveryMessageId:messageId,deliverySentAt:providerAcceptedAt(input.payload),tokenEncrypted:null}});
}

async function upsertProviderSuppression(tx:any,input:ProviderEvent,tenantId:string,normalizedEmail:string,email:string,reason:'hard_bounce'|'complaint'){
 const where={tenantId_normalizedEmail:{tenantId,normalizedEmail}};
 const existing=await tx.suppression.findUnique({where,select:{reason:true}});
 const update=shouldPromoteProviderSuppression(existing?.reason,reason)?{reason,source:input.provider}:{};
 await tx.suppression.upsert({where,create:{tenantId,email,normalizedEmail,reason,source:input.provider},update});
}

export async function finalizeCampaignIfDrained(campaignId:string){
 const active=await prisma.campaignRecipient.count({where:{campaignId,status:{in:['PENDING','QUEUED','SENDING']}}});
 if(active)return;
 const accepted=await prisma.campaignRecipient.count({where:{campaignId,sentAt:{not:null}}});
 await prisma.campaign.updateMany({where:{id:campaignId,status:{in:['QUEUED','SENDING','FAILED']}},data:{status:accepted?'COMPLETED':'FAILED',completedAt:new Date()}});
}

export async function processProviderEvent(input:ProviderEvent,interruptCampaign?:(campaignId:string)=>Promise<unknown>){
 const prior=await prisma.webhookDelivery.findUnique({where:{providerEventId:input.providerEventId}});
 if(prior?.status==='processed'){
  if(isNonCampaignProviderEvent(input.payload.mail?.tags??input.payload.tags??{})){await reconcileAccountEmail(input);return {duplicate:true};}
  const payload=input.payload;const tags=payload.mail?.tags??payload.tags??{};const tenantId=Array.isArray(tags.tenant_id)?tags.tenant_id[0]:tags.tenant_id;const taggedId=Array.isArray(tags.recipient_id)?tags.recipient_id[0]:tags.recipient_id;const messageId=payload.mail?.messageId??payload.messageId;
  const type=eventName(input.eventType);const bounceType=payload.bounce?.bounceType;const eventType=type==='bounce'&&bounceType==='Transient'?'delivery_delay':type;
  if(tenantId&&typeof messageId==='string'&&providerEventImpliesAcceptance(eventType)){
   let recipient=taggedId?await prisma.campaignRecipient.findFirst({where:{id:taggedId,tenantId},select:{id:true,campaignId:true}}):null;
   if(!recipient)recipient=await prisma.campaignRecipient.findFirst({where:{tenantId,providerMessageId:messageId},select:{id:true,campaignId:true}});
   if(recipient){await prisma.$transaction(async tx=>{await recordProviderAcceptance(tx,{recipientId:recipient.id,messageId,acceptedAt:providerAcceptedAt(payload),source:'provider_event'});if(PROVIDER_TERMINAL_FAILURE_EVENTS.includes(eventType))await tx.campaignRecipient.updateMany({where:{id:recipient.id,status:{in:['SENDING','SENT']}},data:{status:'FAILED'}});else await tx.campaignRecipient.updateMany({where:{id:recipient.id,status:{in:['SENDING','FAILED']},events:{none:{eventType:{in:PROVIDER_TERMINAL_FAILURE_EVENTS}}}},data:{status:'SENT'}});});if(recipient.campaignId)await finalizeCampaignIfDrained(recipient.campaignId);}
  }
  return {duplicate:true};
 }
 const raw=await prisma.webhookDelivery.upsert({where:{providerEventId:input.providerEventId},create:{provider:input.provider,providerEventId:input.providerEventId,payload:input.payload,status:'processing',attempts:1},update:{status:'processing',attempts:{increment:1}}});
 try{
  const payload=input.payload;const tags=payload.mail?.tags??payload.tags??{};
  if(isNonCampaignProviderEvent(tags)){await reconcileAccountEmail(input);await prisma.webhookDelivery.update({where:{id:raw.id},data:{status:'processed',processedAt:new Date()}});return {duplicate:false,eventType:'transactional_confirmation'};}
  const tenantId=Array.isArray(tags.tenant_id)?tags.tenant_id[0]:tags.tenant_id;const taggedId=Array.isArray(tags.recipient_id)?tags.recipient_id[0]:tags.recipient_id;const messageId=payload.mail?.messageId??payload.messageId;
  if(!tenantId)throw new Error('Provider event is missing its tenant message tag.');
  let recipient=taggedId?await prisma.campaignRecipient.findFirst({where:{id:taggedId,tenantId},include:{contact:true}}):null;
  if(!recipient&&messageId)recipient=await prisma.campaignRecipient.findFirst({where:{tenantId,providerMessageId:messageId},include:{contact:true}});
  if(!recipient)throw new Error('Provider event recipient could not be matched.');
  const type=eventName(input.eventType);const bounceType=payload.bounce?.bounceType;const eventType=type==='bounce'&&bounceType==='Transient'?'delivery_delay':type;
  if(providerEventImpliesAcceptance(eventType)&&typeof messageId!=='string')throw new Error('Provider acceptance event is missing its message ID.');
  const normalizedEmail=recipient.email.trim().toLowerCase();
  const key=`${input.provider}:${input.providerEventId}`;
  await prisma.$transaction(async tx=>{
   if(type==='bounce'||type==='complaint')await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
   let eventData=payload;
   if(type==='open'||type==='click'){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recipient!.id}, 7719))`;
    const prior=await tx.emailEvent.findFirst({where:{tenantId,recipientId:recipient!.id,eventType,eventData:{path:['unique'],equals:true}},select:{id:true}});
    eventData={...payload,unique:!prior};
   }
   if(providerEventImpliesAcceptance(eventType)){
    await recordProviderAcceptance(tx,{recipientId:recipient!.id,messageId:String(messageId),acceptedAt:providerAcceptedAt(payload),source:'provider_event'});
    await tx.campaignRecipient.updateMany({where:{id:recipient!.id,status:{in:['SENDING','FAILED']},events:{none:{eventType:{in:PROVIDER_TERMINAL_FAILURE_EVENTS}}}},data:{status:'SENT'}});
   }
   if(eventType!=='accepted')await tx.emailEvent.createMany({data:[{tenantId,recipientId:recipient!.id,eventType,eventKey:key,url:payload.click?.link??undefined,eventData}],skipDuplicates:true});
   if(type==='delivered')await tx.campaignRecipient.updateMany({where:{id:recipient!.id,status:{notIn:['BOUNCED','COMPLAINED']}},data:{status:'DELIVERED',deliveredAt:new Date(payload.delivery?.timestamp??Date.now())}});
   if(type==='bounce'&&bounceType==='Permanent'){
    await tx.campaignRecipient.updateMany({where:{id:recipient!.id,status:{not:'COMPLAINED'}},data:{status:'BOUNCED'}});
    if(recipient!.contact&&!recipient!.contact.deletedAt)await tx.contact.updateMany({where:{id:recipient!.contactId,tenantId,normalizedEmail,deletedAt:null,status:{notIn:['COMPLAINED','UNSUBSCRIBED']}},data:{status:'BOUNCED'}});
    await upsertProviderSuppression(tx,input,tenantId,normalizedEmail,recipient!.email,'hard_bounce');
   }
   if(type==='complaint'){
    await tx.campaignRecipient.update({where:{id:recipient!.id},data:{status:'COMPLAINED'}});
    if(recipient!.contact&&!recipient!.contact.deletedAt)await tx.contact.updateMany({where:{id:recipient!.contactId,tenantId,normalizedEmail,deletedAt:null},data:{status:'COMPLAINED'}});
    await upsertProviderSuppression(tx,input,tenantId,normalizedEmail,recipient!.email,'complaint');
   }
   if(PROVIDER_TERMINAL_FAILURE_EVENTS.includes(type))await tx.campaignRecipient.updateMany({where:{id:recipient!.id,status:{in:['SENDING','SENT']}},data:{status:'FAILED'}});
  });
  if(recipient.campaignId&&providerEventImpliesAcceptance(eventType))await finalizeCampaignIfDrained(recipient.campaignId);
  if((type==='complaint'||(type==='bounce'&&bounceType==='Permanent'))&&recipient.campaignId){
   const [total,bounces,complaints]=await Promise.all([
    prisma.campaignRecipient.count({where:{campaignId:recipient.campaignId,sentAt:{not:null}}}),
    prisma.campaignRecipient.count({where:{campaignId:recipient.campaignId,status:'BOUNCED'}}),
    prisma.campaignRecipient.count({where:{campaignId:recipient.campaignId,status:'COMPLAINED'}}),
   ]);
   const trigger=reputationPauseReason({total,bounces,complaints},thresholds);
   if(trigger){
    const pausedCount=await prisma.$transaction(async tx=>{
     const paused=await tx.campaign.updateMany({where:{id:recipient!.campaignId,status:{in:['QUEUED','SENDING']}},data:{status:'PAUSED'}});
     if(paused.count)await tx.auditLog.create({data:{tenantId,action:'campaign.auto_paused.reputation_threshold',entityType:'campaign',entityId:recipient!.campaignId,metadata:{reason:trigger.reason,total,bounces,complaints,bounceRate:trigger.bounceRate,complaintRate:trigger.complaintRate,minimumSample:thresholds.minimumSample,maximumBounceRate:thresholds.maximumBounceRate,maximumComplaintRate:thresholds.maximumComplaintRate}}});
     return paused.count;
    });
    if(pausedCount&&interruptCampaign){
     try{await interruptCampaign(recipient.campaignId);}
     catch{console.warn('Could not publish the reputation pause interrupt.');}
    }
   }
  }
  await prisma.webhookDelivery.update({where:{id:raw.id},data:{status:'processed',processedAt:new Date()}});
  return {duplicate:false,eventType};
 }catch(error){await prisma.webhookDelivery.update({where:{id:raw.id},data:{status:'failed'}});throw error;}
}


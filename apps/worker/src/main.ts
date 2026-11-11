import './production-preflight';
import { Queue, Worker, Job, DelayedError } from 'bullmq';
import IORedis from 'ioredis';
import { createPrismaClient,isPlatformSendingPaused,prisma as tenantAwarePrisma,recordProviderAcceptance,withTenant,withTrustedWorker } from '@repus/database';
import { createEmailProvider,providerSendFailureDisposition } from './email-provider';
import { htmlToPlainText,renderEmailHtml,renderEmailTextAlternative,renderEmailSubject } from '@repus/email-renderer';
import { createOpaqueToken,decryptToken,encryptToken,tokenHash } from '@repus/token-security';
import {closeImportWorker} from './import-worker';
import {campaignTrackingUrls,instrumentTrackingHtml,instrumentTrackingText} from './tracking';
import {queueDueCampaign} from './scheduled-campaign';
import {listPrivateImageObjects,deletePrivateImage} from '@repus/import-storage';
import {sweepOrphanedImages} from './image-orphan-sweep';
import {campaignSendActionAtProviderBoundary,campaignSenderDomainBlock} from './campaign-send-state';
import {EMAIL_JOB_PRIORITIES,PROVIDER_TERMINAL_FAILURE_EVENTS,SEND_INTERRUPT_CHANNEL,parseSendInterrupt,sendingDomainSendBlock,workspaceSendBlock,nextPlatformQuotaBoundary} from '@repus/validation';
import {publishQueuedRecipientBatch,recipientQueueJob} from './queued-recipient-recovery';
import {rebaseRecipientQuota} from './recipient-quota';
import {recipientConsentAllowsSend} from './recipient-consent';
import {singleFlight} from './single-flight';
import {deleteExpiredResolvedAbuseReports} from './abuse-report-retention';
import {createQueueHealthSnapshot,queueHealthMetricEvents} from './cloudwatch-emf';
import {abortInFlightSends,withInFlightAbort} from './in-flight-sends';
import {emailWorkerRateLimit} from './email-rate-limit';
import {SES_SEND_TIMEOUT_MS} from './send-timeout';
import {campaignSendDeferralBoundary} from './quota-send-window';
import {handleCampaignSendFailure} from './campaign-send-failure';
import {publishPendingAccountEmails,sendAccountEmail} from './account-email';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const prisma = createPrismaClient();
const provider = createEmailProvider();
export const sendingQueue = new Queue('repus-email-sending', { connection });
const providerEventsQueue=new Queue('repus-provider-events',{connection});
const interruptConnection=connection.duplicate();
connection.on('error',()=>console.error('Sending worker Redis connection failed.'));
interruptConnection.on('error',()=>console.error('Send interrupt Redis connection failed.'));
const inFlightSends=new Map<string,{campaignId:string|null;tenantId:string|null;controller:AbortController}>();
const interruptSubscriptionReady=interruptConnection.subscribe(SEND_INTERRUPT_CHANNEL).then(()=>true).catch(()=>{console.error('Could not subscribe to provider-send interrupts.');return false;});
interruptConnection.on('message',(channel,payload)=>{
 if(channel!==SEND_INTERRUPT_CHANNEL)return;
 const interrupt=parseSendInterrupt(payload);if(!interrupt)return;
 const count=abortInFlightSends(inFlightSends,interrupt);
 if(count)console.info(JSON.stringify({type:'provider_send_interrupted',count}));
});
let platformPauseCache:{value:boolean;checkedAt:number}|undefined;
async function platformSendingPaused(refresh=false){if(!refresh&&platformPauseCache&&Date.now()-platformPauseCache.checkedAt<1000)return platformPauseCache.value;const value=await isPlatformSendingPaused();platformPauseCache={value,checkedAt:Date.now()};return value;}

async function sendRecipient(job:Job<any>,jobToken?:string){
  if(job.name==='send-account')return sendAccountEmail(prisma,provider,String(job.data.tokenId));
  if(job.name==='send-test'){
    if(await platformSendingPaused(true))throw new Error('Repus has temporarily paused email sending.');
    const data=job.data as any;
    const fromDomain=typeof data.from==='string'?data.from.split('@')[1]?.toLowerCase():undefined;
    if(!fromDomain)return;
    try{
      await withInFlightAbort(inFlightSends,`test:${String(job.id)}`,null,data.tenantId,async signal=>{
        if(await platformSendingPaused(true))return null;
        const workspaceReady=await withTenant(data.tenantId,async()=>{
          const [tenant,limits,domain]=await Promise.all([
            prisma.tenant.findUnique({where:{id:data.tenantId},select:{status:true}}),
            prisma.tenantSendingLimit.findUnique({where:{tenantId:data.tenantId},select:{enabled:true}}),
            prisma.sendingDomain.findFirst({where:{tenantId:data.tenantId,domain:fromDomain},select:{verificationStatus:true,dkimStatus:true}}),
          ]);
          return !workspaceSendBlock(tenant?.status??null,limits?.enabled??null)&&!sendingDomainSendBlock(domain,process.env.EMAIL_PROVIDER??'development');
        });
        if(!workspaceReady)return null;
        return provider.sendEmail({to:data.email,from:data.from,fromName:data.fromName,replyTo:data.replyTo,subject:data.subject,html:data.html,text:data.text||htmlToPlainText(data.html),tags:{tenant_id:data.tenantId,campaign_id:data.campaignId,kind:'test'}},{signal});
      });
    }catch(error){
      const disposition=providerSendFailureDisposition(error);
      if(disposition==='retryable')throw error;
      console.error(`Test email request was ${disposition}; automatic retry was suppressed to avoid a duplicate.`);
    }
    return;
  }
  if(job.name==='send-confirmation'){
    if(await platformSendingPaused(true))throw new Error('Repus has temporarily paused email sending.');
    const data=job.data as {tenantId:string;email:string;tokenId:string;tokenEncrypted:string;workspaceName:string};
    try{
      await withInFlightAbort(inFlightSends,`confirmation:${String(job.id)}`,null,data.tenantId,async signal=>{
        if(await platformSendingPaused(true))return null;
        const tokenRecord=await prisma.contactConfirmationToken.findUnique({where:{id:data.tokenId},select:{confirmedAt:true,expiresAt:true,contact:{select:{status:true}}}});
        if(!tokenRecord||tokenRecord.confirmedAt||tokenRecord.expiresAt<=new Date()||tokenRecord.contact.status!=='PENDING_CONFIRMATION')return null;
        const token=decryptToken(data.tokenEncrypted,process.env.SESSION_SECRET??'');
        const confirmUrl=`${new URL('/confirm-subscription/'+encodeURIComponent(token),process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000')}`;
        const safeWorkspaceName=data.workspaceName.replace(/[\r\n]/g,' ').slice(0,160);
        const entities:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
        const workspaceName=safeWorkspaceName.replace(/[&<>"']/g,value=>entities[value]);
        return provider.sendEmail({to:data.email,from:process.env.EMAIL_FROM_ADDRESS??'',fromName:process.env.EMAIL_FROM_NAME??'Repus',subject:`Confirm your subscription to ${safeWorkspaceName}`,text:`Please confirm that you want to receive emails from ${safeWorkspaceName} by visiting: ${confirmUrl}\n\nThis link expires in 48 hours. If you did not expect this request, you can ignore this email.`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:24px;color:#17243b"><h1 style="font-size:22px">Confirm your subscription</h1><p>Please confirm that you want to receive emails from ${workspaceName}.</p><p><a href="${confirmUrl}" style="display:inline-block;background:#2563eb;color:white;padding:12px 18px;border-radius:7px;text-decoration:none">Confirm subscription</a></p><p style="font-size:13px;color:#68758b">This link expires in 48 hours. If you did not expect this request, you can ignore this email.</p></div>`,tags:{tenant_id:data.tenantId,kind:'subscription_confirmation'}},{signal});
      });
    }catch(error){
      const disposition=providerSendFailureDisposition(error);
      if(disposition==='retryable')throw error;
      if(disposition==='rejected')await prisma.contactConfirmationToken.updateMany({where:{id:data.tokenId,emailQueuedAt:{not:null}},data:{emailQueuedAt:null}});
      console.error(`Subscription confirmation provider outcome was ${disposition}; automatic retry was suppressed to avoid a duplicate.`);
      return;
    }
    return;
  }
  if(await platformSendingPaused())return;
  const decision=await prisma.$transaction(async tx=>{
    const initial=await tx.campaignRecipient.findUnique({where:{id:job.data.recipientId},select:{tenantId:true}});
    if(!initial)return {kind:'skip' as const};
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.tenantId}, 0))`;
    const current=await tx.campaignRecipient.findUnique({where:{id:job.data.recipientId},include:{campaign:true,contact:true}});
    if(!current||['SENT','DELIVERED','BOUNCED','COMPLAINED','SUPPRESSED','SENDING'].includes(current.status))return {kind:'skip' as const};
    if(current.campaign.status==='PAUSED')return {kind:'paused' as const};
    const tenant=await tx.tenant.findUnique({where:{id:current.tenantId},select:{status:true}});if(tenant?.status!=='active')return {kind:'suppress' as const,id:current.id};
    const tenantLimit=await tx.tenantSendingLimit.findUnique({where:{tenantId:current.tenantId},select:{enabled:true}});if(!tenantLimit?.enabled)return {kind:'suppress' as const,id:current.id};
    if(current.campaign.status==='CANCELLED')return {kind:'suppress' as const,id:current.id};
    const contact=current.contact;
    const suppression=contact?await tx.suppression.findUnique({where:{tenantId_normalizedEmail:{tenantId:current.tenantId,normalizedEmail:contact.normalizedEmail}}}):null;
    if(!contact||suppression||!recipientConsentAllowsSend(current.email,contact))return {kind:'suppress' as const,id:current.id};
    const claimed=await tx.campaignRecipient.updateMany({where:{id:current.id,status:{in:['QUEUED','PENDING','FAILED']}},data:{status:'SENDING',sendStartedAt:new Date()}});
    return claimed.count===1?{kind:'send' as const,recipient:current}:{kind:'skip' as const};
  });
  if(decision.kind==='skip'||decision.kind==='paused')return;
  if(decision.kind==='suppress'){await settleReservation(decision.id,'SUPPRESSED');return;}
  const recipient=decision.recipient;
  if(!await rebaseRecipientQuota(prisma,recipient.id)){
    await prisma.campaignRecipient.updateMany({where:{id:recipient.id,status:'SENDING'},data:{status:'QUEUED',sendStartedAt:null}});
    if(!jobToken)throw new Error('Cannot delay a quota-blocked recipient job without its BullMQ lock token.');
    const nextWindow=nextPlatformQuotaBoundary(new Date(),process.env.PLATFORM_TIMEZONE??'Asia/Kolkata');
    await job.moveToDelayed(nextWindow.getTime()+1000,jobToken);
    throw new DelayedError();
  }
  const c=recipient.campaign;
  let providerAccepted=false;
  try{
    let token=recipient.unsubscribeTokenEncrypted?decryptToken(recipient.unsubscribeTokenEncrypted,process.env.SESSION_SECRET??'') : '';
    if(!token){token=createOpaqueToken();await prisma.campaignRecipient.update({where:{id:recipient.id},data:{unsubscribeTokenHash:tokenHash(token),unsubscribeTokenEncrypted:encryptToken(token,process.env.SESSION_SECRET??'')}});}
    const {trackingBase,unsubscribeUrl}=campaignTrackingUrls(process.env.TRACKING_BASE_URL??process.env.API_URL??'http://localhost:4000',token);
    const fields={first_name:recipient.contact.firstName,last_name:recipient.contact.lastName,email:recipient.email,unsubscribe_url:unsubscribeUrl,preview_text:c.previewText};
    const html=renderEmailHtml(c.htmlContent??'',fields);
    const text=renderEmailTextAlternative(c.textContent,html,fields);
    const trackedHtml=instrumentTrackingHtml(html,recipient.tenantId,recipient.id,trackingBase,process.env.SESSION_SECRET??'');
    const trackedText=instrumentTrackingText(text,recipient.tenantId,recipient.id,trackingBase,process.env.SESSION_SECRET??'');
    const result=await withInFlightAbort(inFlightSends,recipient.id,c.id,recipient.tenantId,async signal=>{
      const latestTenant=await prisma.tenant.findUnique({where:{id:recipient.tenantId},select:{status:true}});
      if(latestTenant?.status!=='active'){await settleReservation(recipient.id,'SUPPRESSED');return null;}
      const latestLimit=await prisma.tenantSendingLimit.findUnique({where:{tenantId:recipient.tenantId},select:{enabled:true}});
      if(!latestLimit?.enabled){await settleReservation(recipient.id,'SUPPRESSED');return null;}
      const latestCampaign=await prisma.campaign.findUnique({where:{id:c.id},select:{status:true,fromEmail:true}});
      const boundaryAction=campaignSendActionAtProviderBoundary(latestCampaign?.status??null);
      if(boundaryAction==='requeue'){await prisma.campaignRecipient.updateMany({where:{id:recipient.id,status:'SENDING'},data:{status:'QUEUED',sendStartedAt:null}});return null;}
      if(boundaryAction==='suppress'){await settleReservation(recipient.id,'SUPPRESSED');return null;}
      if(await platformSendingPaused(true)){await prisma.campaignRecipient.updateMany({where:{id:recipient.id,status:'SENDING'},data:{status:'QUEUED',sendStartedAt:null}});return null;}
      const latestRecipient=await prisma.campaignRecipient.findUnique({where:{id:recipient.id},select:{status:true,contact:{select:{normalizedEmail:true,status:true,consentAt:true,consentSource:true,deletedAt:true}}}});
      const latestSuppression=latestRecipient?.contact?await prisma.suppression.findUnique({where:{tenantId_normalizedEmail:{tenantId:recipient.tenantId,normalizedEmail:latestRecipient.contact.normalizedEmail}},select:{id:true}}):null;
      if(!latestRecipient||latestRecipient.status!=='SENDING'||!recipientConsentAllowsSend(recipient.email,latestRecipient.contact)||latestSuppression){await settleReservation(recipient.id,'SUPPRESSED');return null;}
      const fromEmail=latestCampaign?.fromEmail??c.fromEmail??process.env.EMAIL_FROM_ADDRESS??'';
      const fromDomain=fromEmail.trim().split('@').at(-1)?.toLowerCase()??'';
      const latestDomain=fromDomain?await prisma.sendingDomain.findFirst({where:{tenantId:recipient.tenantId,domain:fromDomain},select:{verificationStatus:true,dkimStatus:true}}):null;
      if(campaignSenderDomainBlock(fromEmail,latestDomain,process.env.EMAIL_PROVIDER??'development')){
        await settleReservation(recipient.id,'FAILED');
        console.error('Campaign recipient failed because the sender domain is no longer ready at the provider boundary.');
        return null;
      }
      const deferUntil=campaignSendDeferralBoundary(new Date(),process.env.PLATFORM_TIMEZONE??'Asia/Kolkata',SES_SEND_TIMEOUT_MS);
      if(deferUntil)return {kind:'defer' as const,boundary:deferUntil};
      return {kind:'accepted' as const,result:await provider.sendEmail({to:recipient.email,from:fromEmail,fromName:c.fromName??process.env.EMAIL_FROM_NAME,replyTo:c.replyTo??undefined,subject:renderEmailSubject(c.subject??'',fields),html:trackedHtml,text:trackedText,tags:{tenant_id:recipient.tenantId,campaign_id:c.id,recipient_id:recipient.id},headers:[{name:'List-Unsubscribe',value:`<${unsubscribeUrl}>`},{name:'List-Unsubscribe-Post',value:'List-Unsubscribe=One-Click'}]},{signal})};
    });
    if(!result)return;
    if(result.kind==='defer'){
      const queued=await prisma.campaignRecipient.updateMany({where:{id:recipient.id,status:'SENDING'},data:{status:'QUEUED',sendStartedAt:null}});
      if(!queued.count)return;
      if(!jobToken)throw new Error('Cannot defer a campaign send without its BullMQ lock token.');
      await job.moveToDelayed(Math.max(result.boundary.getTime()+1000,Date.now()+1000),jobToken);
      throw new DelayedError();
    }
    providerAccepted=true;
    await prisma.$transaction(async tx=>{
      await recordProviderAcceptance(tx,{recipientId:recipient.id,messageId:result.result.messageId,acceptedAt:result.result.acceptedAt});
      await tx.campaignRecipient.updateMany({where:{id:recipient.id,status:{in:['SENDING','FAILED']},providerAcceptedAt:{not:null},events:{none:{eventType:{in:PROVIDER_TERMINAL_FAILURE_EVENTS}}}},data:{status:'SENT'}});
    });
    await prisma.campaign.updateMany({where:{id:c.id,status:'QUEUED'},data:{status:'SENDING'}});
    if(result.result.messageId.startsWith('dev-'))await providerEventsQueue.add('provider-event',{providerEventId:`development:${result.result.messageId}:delivery`,provider:'development',eventType:'Delivery',payload:{mail:{messageId:result.result.messageId,tags:{tenant_id:[recipient.tenantId],recipient_id:[recipient.id]}},delivery:{timestamp:new Date().toISOString()}}},{jobId:`development-delivery-${result.result.messageId}`,removeOnComplete:1000,removeOnFail:false});
  }catch(error){
    await handleCampaignSendFailure(error,{providerAccepted,attemptsMade:job.attemptsMade,attempts:Number(job.opts.attempts??1)},{
      releaseReservation:()=>settleReservation(recipient.id,'FAILED'),
      markRetry:()=>prisma.campaignRecipient.update({where:{id:recipient.id},data:{status:'FAILED',sendStartedAt:null}}),
    });
  }
}
async function settleReservation(recipientId:string,status:'SUPPRESSED'|'FAILED'){
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
  const recipient=await tx.campaignRecipient.findUnique({where:{id:recipientId}});if(!recipient)return;
  const claimed=await tx.campaignRecipient.updateMany({where:{id:recipientId,quotaReserved:true},data:{status,quotaReserved:false,sendStartedAt:null}});
  if(claimed.count===0){await tx.campaignRecipient.updateMany({where:{id:recipientId,status:'SENDING'},data:{status,sendStartedAt:null}});return;}
  const quotaDate=new Date(recipient.quotaDate);quotaDate.setUTCHours(0,0,0,0);
  const usage=await tx.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId:recipient.tenantId,usageDate:quotaDate}}});
  if(usage)await tx.dailyUsage.update({where:{id:usage.id},data:{reservedCount:{decrement:1}}});
  await tx.platformDailyUsage.updateMany({where:{usageDate:quotaDate},data:{reservedCount:{decrement:1}}});
 });
}
const sendingWorker=new Worker('repus-email-sending',async(job,token)=>{if(!await interruptSubscriptionReady)throw new Error('Provider-send interrupt listener is unavailable.');return sendRecipient(job,token);},{connection,concurrency:5,limiter:emailWorkerRateLimit()});
async function finalizeCampaignIfDrained(campaignId:string){
 const active=await prisma.campaignRecipient.count({where:{campaignId,status:{in:['PENDING','QUEUED','SENDING']}}});
 if(active)return;
 const accepted=await prisma.campaignRecipient.count({where:{campaignId,sentAt:{not:null}}});
 await prisma.campaign.updateMany({where:{id:campaignId,status:{in:['QUEUED','SENDING','FAILED']}},data:{status:accepted?'COMPLETED':'FAILED',completedAt:new Date()}});
}
async function enqueueQueuedCampaignRecipients(campaignId:string){
 const batchSize=500;let afterId:string|undefined;let queued=0;
 while(true){
  const rows=await prisma.campaignRecipient.findMany({where:{campaignId,status:'QUEUED',...(afterId?{id:{gt:afterId}}:{})},orderBy:{id:'asc'},take:batchSize,select:{id:true}});
  if(!rows.length)break;
  await sendingQueue.addBulk(rows.map(({id:recipientId})=>recipientQueueJob(recipientId)));
  queued+=rows.length;afterId=rows[rows.length-1].id;
 }
 return queued;
}
async function finalizeRecipientJob(job:Job|undefined){
 if(!job||job.name!=='send'||!job.data?.recipientId)return;
 const recipient=await prisma.campaignRecipient.findUnique({where:{id:job.data.recipientId},select:{campaignId:true}});
 if(recipient)await finalizeCampaignIfDrained(recipient.campaignId);
}
sendingWorker.on('error',()=>console.error('Sending queue worker encountered an infrastructure error.'));
sendingWorker.on('completed',job=>void finalizeRecipientJob(job).catch(()=>console.error('Campaign completion update failed.')));
sendingWorker.on('failed',(job,error)=>{
 if(job?.name==='send-confirmation'&&job.data?.tokenId&&job.attemptsMade>=Number(job.opts.attempts??1))void prisma.contactConfirmationToken.updateMany({where:{id:job.data.tokenId,emailQueuedAt:{not:null},emailQueueAttempts:{lt:3}},data:{emailQueuedAt:null}}).catch(()=>console.error('Could not reopen a failed subscription confirmation.'));
 if(job&&job.attemptsMade>=Number(job.opts.attempts??1))void finalizeRecipientJob(job).catch(()=>console.error('Failed campaign finalization after terminal send error.'));
 if(error)console.error('Email job failed.');
});
const scheduledQueue=new Queue('repus-scheduled-campaigns',{connection});
const importHealthQueue=new Queue('repus-csv-import',{connection});
const monitoredQueues=[
 {name:'repus-email-sending',queue:sendingQueue},
 {name:'repus-scheduled-campaigns',queue:scheduledQueue},
 {name:'repus-csv-import',queue:importHealthQueue},
 {name:'repus-provider-events',queue:providerEventsQueue},
];
for(const {name,queue} of monitoredQueues)queue.on('error',()=>console.error(`Queue ${name} encountered an infrastructure error.`));
let queuedRecipientRecoveryCursor:string|undefined;
const scheduleWorker=new Worker('repus-scheduled-campaigns',async(job)=>{
  if(await platformSendingPaused(true))return;
  const result=await queueDueCampaign(prisma,job.data.campaignId);
  if(!result.ready){if(result.reason==='quota_unavailable')console.info(`Scheduled campaign ${job.data.campaignId} is waiting for quota capacity.`);return;}
  if(result.queuedCount)await enqueueQueuedCampaignRecipients(job.data.campaignId);
  else await finalizeCampaignIfDrained(job.data.campaignId);
},{connection,concurrency:2});
scheduleWorker.on('error',()=>console.error('Scheduled campaign worker encountered an infrastructure error.'));
scheduleWorker.on('failed',()=>console.error('Scheduled campaign processing failed.'));

async function runScheduleDue(){
  await publishPendingAccountEmails(prisma,sendingQueue);
  if(await platformSendingPaused())return;
  const pendingConfirmations=await prisma.contactConfirmationToken.findMany({where:{confirmedAt:null,emailQueuedAt:null,emailQueueAttempts:{lt:3},expiresAt:{gt:new Date()},contact:{is:{status:'PENDING_CONFIRMATION'}}},select:{id:true,tenantId:true,tokenEncrypted:true,emailQueueAttempts:true,contact:{select:{email:true,tenant:{select:{name:true}}}}},take:100});
  for(const token of pendingConfirmations){
    await sendingQueue.add('send-confirmation',{tokenId:token.id,tenantId:token.tenantId,workspaceName:token.contact.tenant.name,email:token.contact.email,tokenEncrypted:token.tokenEncrypted},{priority:EMAIL_JOB_PRIORITIES.confirmation,jobId:`confirm-${token.id}-${token.emailQueueAttempts+1}`,attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:{age:3*24*60*60},removeOnFail:false});
    await prisma.contactConfirmationToken.updateMany({where:{id:token.id,emailQueuedAt:null},data:{emailQueuedAt:new Date(),emailQueueAttempts:{increment:1}}});
  }
  const campaigns=await prisma.campaign.findMany({where:{status:'SCHEDULED',scheduledAt:{lte:new Date()},tenant:{is:{status:'active',sendingLimit:{is:{enabled:true}}}}},select:{id:true,scheduledAt:true},take:100});
  const retrySlot=Math.floor(Date.now()/60_000);
  await Promise.all(campaigns.map(c=>scheduledQueue.add('launch',{campaignId:c.id},{jobId:`campaign-${c.id}-${c.scheduledAt?.getTime()}-${retrySlot}`,removeOnComplete:100,removeOnFail:false})));
  for(let page=0;page<10;page++){
    const batch=await publishQueuedRecipientBatch(prisma,sendingQueue,queuedRecipientRecoveryCursor,500);
    if(batch.done){queuedRecipientRecoveryCursor=undefined;break;}
    queuedRecipientRecoveryCursor=batch.nextCursor;
  }
}
const scheduleDue=singleFlight(runScheduleDue);
let imageSweepCursor:string|undefined;
let imageSweepRunning=false;
async function sweepImageOrphans(){
 if(imageSweepRunning)return;
 imageSweepRunning=true;
 try{
  const result=await sweepOrphanedImages({
   cursor:imageSweepCursor,
   list:cursor=>listPrivateImageObjects(cursor,500),
   findRegistered:async keys=>withTrustedWorker(async()=>{
    const rows=await tenantAwarePrisma.imageAsset.findMany({where:{objectKey:{in:keys}},select:{objectKey:true}});
    return rows.map(row=>row.objectKey);
   },{maxWait:5000,timeout:15000}),
   remove:deletePrivateImage,
  });
  imageSweepCursor=result.nextCursor;
  if(result.removed||result.failed)console.info(`Private image orphan sweep: removed ${result.removed}; cleanup failures ${result.failed}; scanned ${result.scanned}.`);
 }finally{imageSweepRunning=false;}
}
const timer=setInterval(()=>void scheduleDue().catch(()=>console.error('Schedule scan failed.')),15_000);
const imageSweepTimer=setInterval(()=>void sweepImageOrphans().catch(()=>console.error('Private image orphan sweep failed.')),60*60_000);
async function pruneResolvedAbuseReports(){
 const deleted=await deleteExpiredResolvedAbuseReports(prisma);
 if(deleted)console.info(`Abuse report retention removed ${deleted} resolved report(s) older than one year.`);
}
const abuseReportRetentionTimer=setInterval(()=>void pruneResolvedAbuseReports().catch(()=>console.error('Abuse report retention task failed.')),24*60*60_000);
let queueMetricsRunning=false;
async function reportQueueHealth(){
 if(process.env.NODE_ENV!=='production'||queueMetricsRunning)return;
 queueMetricsRunning=true;
 try{
  const samples=await Promise.all(monitoredQueues.map(async({name,queue})=>{
   let timeout:ReturnType<typeof setTimeout>|undefined;
   try{
    const counts=await Promise.race([queue.getJobCounts('waiting','active','delayed','failed'),new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('Queue metric query timed out.')),5000);})]);
    return {queueName:name,failed:counts.failed??0,waiting:counts.waiting??0,active:counts.active??0,delayed:counts.delayed??0,available:true};
   }catch{return {queueName:name,failed:0,waiting:0,active:0,delayed:0,available:false};}
   finally{if(timeout)clearTimeout(timeout);}
  }));
  for(const event of queueHealthMetricEvents(samples))console.info(JSON.stringify(event));
  try{await prisma.platformQueueHealthSample.create({data:createQueueHealthSnapshot(samples)});}
  catch{console.error('Could not persist queue health history.');}
 }finally{queueMetricsRunning=false;}
}
async function pruneQueueHealthHistory(){
 try{
  const result=await prisma.platformQueueHealthSample.deleteMany({where:{checkedAt:{lt:new Date(Date.now()-30*24*60*60_000)}}});
  if(result.count)console.info(`Queue health history retention removed ${result.count} old sample(s).`);
 }catch{console.error('Could not prune queue health history.');}
}
const queueHealthTimer=setInterval(()=>void reportQueueHealth().catch(()=>console.error('Queue health metrics failed.')),60_000);
const queueHealthRetentionTimer=setInterval(()=>void pruneQueueHealthHistory(),24*60*60_000);
void scheduleDue();
void reportQueueHealth().catch(()=>console.error('Queue health metrics failed.'));
setTimeout(()=>void pruneQueueHealthHistory(),60_000).unref();
setTimeout(()=>void pruneResolvedAbuseReports().catch(()=>console.error('Abuse report retention task failed.')),60_000).unref();
setTimeout(()=>void sweepImageOrphans().catch(()=>console.error('Private image orphan sweep failed.')),60_000).unref();
console.info('Repus sending workers started.');
let shutdownPromise:Promise<void>|undefined;
async function closeResources(label:string,operations:Promise<unknown>[]){
 const results=await Promise.allSettled(operations);
 for(const result of results)if(result.status==='rejected'){console.error(`${label} shutdown failed.`);process.exitCode=1;}
}
function shutdown(){
 if(shutdownPromise)return shutdownPromise;
 shutdownPromise=(async()=>{
  clearInterval(timer);clearInterval(imageSweepTimer);clearInterval(abuseReportRetentionTimer);clearInterval(queueHealthTimer);clearInterval(queueHealthRetentionTimer);
  await closeResources('Worker drain',[sendingWorker.close(),scheduleWorker.close(),closeImportWorker()]);
  await closeResources('Worker queues',[sendingQueue.close(),scheduledQueue.close(),importHealthQueue.close(),providerEventsQueue.close()]);
  await closeResources('Worker connections',[interruptConnection.quit(),connection.quit(),prisma.$disconnect()]);
 })();
 return shutdownPromise;
}
process.on('SIGINT',()=>{void shutdown()}); process.on('SIGTERM',()=>{void shutdown()});


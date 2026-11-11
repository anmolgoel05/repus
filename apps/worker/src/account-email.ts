import type {PrismaClient} from '@repus/database';
import type {Queue} from 'bullmq';
import {decryptToken,tokenHash} from '@repus/token-security';
import {escapeHtml} from '@repus/email-renderer';
import type {EmailProvider} from './email-provider';
import {providerSendFailureDisposition} from './provider-failure';
import {EMAIL_JOB_PRIORITIES} from '@repus/validation';

export async function publishPendingAccountEmails(db:PrismaClient,queue:Queue,now=new Date()){
 const unusableCapability = {
  tokenEncrypted: {not: null},
  OR: [{usedAt: {not: null}}, {expiresAt: {lte: now}}],
 };
 await db.oneTimeToken.updateMany({
  where: {...unusableCapability, deliveryStatus: 'PENDING'},
  data: {deliveryStatus: 'SKIPPED', tokenEncrypted: null},
 });
 // An interrupted submission can still be acknowledged by a signed provider event.
 await db.oneTimeToken.updateMany({
  where: {...unusableCapability, deliveryStatus: 'SENDING'},
  data: {tokenEncrypted: null},
 });
 const tokens=await db.oneTimeToken.findMany({where:{deliveryStatus:'PENDING',tokenEncrypted:{not:null},deliveryAttempts:{lt:5},usedAt:null,expiresAt:{gt:now},purpose:{in:['verify_email','reset_password','invite_member']},OR:[{deliveryNextAttemptAt:null},{deliveryNextAttemptAt:{lte:now}}]},orderBy:{createdAt:'asc'},take:100,select:{id:true,deliveryAttempts:true}});
 const jobs=[];
 for(const token of tokens){
  const jobId=`account-${token.id}-${token.deliveryAttempts}`;
  const existing=await queue.getJob(jobId);
  if(existing){
   if(await existing.getState()==='failed'){
    try{await existing.retry();}catch(error){if(await existing.getState()==='failed')throw error;}
   }
   continue;
  }
  jobs.push({name:'send-account',data:{tokenId:token.id},opts:{priority:EMAIL_JOB_PRIORITIES.account,jobId,attempts:1,removeOnComplete:true,removeOnFail:false}});
 }
 if(jobs.length)await queue.addBulk(jobs);
 return tokens.length;
}

export async function sendAccountEmail(db:PrismaClient,provider:EmailProvider,tokenId:string){
 const token=await db.oneTimeToken.findUnique({where:{id:tokenId},include:{user:true,tenant:true}});
 if(!token||token.deliveryStatus!=='PENDING')return;
 const now=new Date();
 if(token.usedAt||token.expiresAt<=now||!token.tokenEncrypted||token.deliveryAttempts>=5)return;
 if(token.deliveryNextAttemptAt&&token.deliveryNextAttemptAt>now)return;
 let role:string|undefined;
 if(token.purpose==='invite_member'){
  const membership=await db.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:token.tenantId,userId:token.userId}}});
  if(membership?.status==='PENDING')role=membership.role;
 }
 if(token.user.status==='DISABLED'||(token.purpose==='verify_email'&&token.user.status!=='PENDING')||(token.purpose==='reset_password'&&token.user.status!=='ACTIVE')||(token.purpose==='invite_member'&&!role)||!['verify_email','reset_password','invite_member'].includes(token.purpose)){
  await db.oneTimeToken.updateMany({where:{id:tokenId,deliveryStatus:'PENDING'},data:{deliveryStatus:'SKIPPED',tokenEncrypted:null}});return;
 }
 const claimed=await db.oneTimeToken.updateMany({where:{id:tokenId,deliveryStatus:'PENDING',deliveryAttempts:token.deliveryAttempts,usedAt:null,expiresAt:{gt:now},OR:[{deliveryNextAttemptAt:null},{deliveryNextAttemptAt:{lte:now}}]},data:{deliveryStatus:'SENDING',deliveryStartedAt:now,deliveryAttempts:{increment:1}}});
 if(!claimed.count)return;
 let submitted=false,accepted=false;
 try{
  const raw=decryptToken(token.tokenEncrypted,process.env.SESSION_SECRET??'');
  if(tokenHash(raw)!==token.tokenHash)throw new Error('Account capability does not match its record.');
  const route=token.purpose==='invite_member'?'/accept-invitation':token.purpose==='verify_email'?'/verify-email':'/reset-password';
  const link=`${new URL(route,process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000')}?token=${encodeURIComponent(raw)}`;
  const subject=token.purpose==='invite_member'?'You are invited to Repus':token.purpose==='verify_email'?'Verify your Repus email':'Reset your Repus password';
  const instruction=token.purpose==='invite_member'?`You have been invited to join ${token.tenant.name} as ${role}.`:token.purpose==='verify_email'?'Verify your email to finish setting up Repus.':'Use this link to reset your Repus password. If you did not request this, you can ignore this message.';
  const text=`Hi ${token.user.name},\n\n${instruction}\n\n${link}\n\nThis link expires at ${token.expiresAt.toISOString()}.`;
  const current=await db.oneTimeToken.findUnique({where:{id:tokenId},select:{usedAt:true,expiresAt:true}});
  if(!current||current.usedAt||current.expiresAt<=new Date()){await db.oneTimeToken.updateMany({where:{id:tokenId,deliveryStatus:'SENDING'},data:{deliveryStatus:'SKIPPED',tokenEncrypted:null}});return;}
  submitted=true;
  const html=`<p>Hi ${escapeHtml(token.user.name)},</p><p>${escapeHtml(instruction)}</p><p><a href="${escapeHtml(link)}">${subject}</a></p><p>This link expires at ${token.expiresAt.toISOString()}.</p>`;
  const result=await provider.sendEmail({to:token.user.email,from:process.env.EMAIL_FROM_ADDRESS??'',fromName:process.env.EMAIL_FROM_NAME??'Repus',subject,html,text,tags:{tenant_id:token.tenantId,kind:'account',account_token_id:token.id}});
  accepted=true;
  await db.oneTimeToken.updateMany({where:{id:tokenId,deliveryStatus:'SENDING'},data:{deliveryStatus:'SENT',deliverySentAt:result.acceptedAt,deliveryMessageId:result.messageId,tokenEncrypted:null}});
 }catch(error){
  const disposition=accepted?'ambiguous':submitted?providerSendFailureDisposition(error):'rejected';
  const retry=disposition==='retryable'&&token.deliveryAttempts+1<5;
  const status=retry?'PENDING':disposition==='ambiguous'?'UNCERTAIN':'FAILED';
  await db.oneTimeToken.updateMany({where:{id:tokenId,deliveryStatus:'SENDING'},data:{deliveryStatus:status,...(retry?{deliveryStartedAt:null,deliveryNextAttemptAt:new Date(Date.now()+5000*2**token.deliveryAttempts)}:{tokenEncrypted:null})}});
  console.error(`Account email submission ${status.toLowerCase()}; recipient and capability omitted.`);
  // eslint-disable-next-line preserve-caught-error -- Provider errors can contain addresses or capability-bearing message bodies; failed-job logs must keep only the safe classification above.
  if(!retry)throw new Error('Account email delivery requires review; use the account recovery or invitation resend flow.');
 }
}

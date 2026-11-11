export { PrismaClient, Prisma } from './generated/prisma/client';
export { recordProviderAcceptance } from './provider-acceptance';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from './generated/prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';

export function createPrismaClient(){
 // Prisma's pg adapter serializes DateTime parameters without a timezone offset.
 // Pin every pooled session to UTC so TIMESTAMPTZ filters/writes preserve instants,
 // independently of the server's timezone or connection-URL options.
 const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):undefined;
 if(url)url.searchParams.set('options',`${url.searchParams.get('options')??''} -c timezone=UTC`.trim());
 const adapter=new PrismaPg({connectionString:url?.toString(),options:'-c timezone=UTC',max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
 return new PrismaClient({adapter});
}
const base=createPrismaClient();
type RequestTransaction={tx:Prisma.TransactionClient;afterCommit:Array<{run:()=>Promise<unknown>;required:boolean}>};
const transactionContext=new AsyncLocalStorage<RequestTransaction>();
const delegates=new Set(['tenant','user','session','organizationMembership','apiKey','oneTimeToken','contact','contactConfirmationToken','contactList','listContact','template','campaign','campaignRecipient','emailEvent','webhookDelivery','suppression','unsubscribe','tenantSendingLimit','dailyUsage','platformDailyUsage','sendingDomain','importJob','importError','auditLog','platformAuditLog','customFieldDefinition','imageAsset','platformControl','platformQueueHealthSample','abuseReport','billingSubscription']);

/** All model calls inside a tenant request automatically use its RLS transaction. */
export const prisma=new Proxy(base as PrismaClient,{
 get(target,property){
  if(typeof property==='string'&&delegates.has(property))return new Proxy({}, {get(_delegate,method){return (...args:unknown[])=>{const db=(transactionContext.getStore()?.tx??target) as any;const delegate=db[property];return delegate[method](...args);};}});
  if(property==='$transaction')return (input:any,options?:any)=>{
   const active=transactionContext.getStore();
   if(active)return typeof input==='function'?input(active.tx):Promise.all(input);
   if(typeof input==='function')return target.$transaction((tx)=>input(tx),options);
   return target.$transaction(input,options);
  };
  const db=(transactionContext.getStore()?.tx??target) as any;const value=db[property];return typeof value==='function'?value.bind(db):value;
 }
}) as PrismaClient;

/** Start a request-scoped transaction and install a PostgreSQL RLS tenant claim. */
export async function withTenant<T>(tenantId:string,fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<T>{
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 const result=await base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  context.tx=tx;
  return transactionContext.run(context,fn);
 },options);
 await runPostCommitActions(context);
 return result;
}

/** Resolve an account email through a narrow authentication claim, then run the callback with its tenant claim. */
export async function withAuthUserEmail<T>(email:string,fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<T>{
 const active=transactionContext.getStore();
 if(active){
  await active.tx.$executeRaw`SELECT set_config('app.auth_user_email', ${email}, true)`;
  const user=await active.tx.user.findUnique({where:{normalizedEmail:email},select:{id:true}});
  if(user)await active.tx.$executeRaw`SELECT set_config('app.auth_user_id', ${user.id}, true)`;
  return fn();
 }
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 const result=await base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.auth_user_email', ${email}, true)`;
  const user=await tx.user.findUnique({where:{normalizedEmail:email},select:{id:true,tenantId:true}});
  if(user){
   await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${user.id}, true)`;
   await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, true)`;
  }
  context.tx=tx;
  return transactionContext.run(context,fn);
 },options);
 await runPostCommitActions(context);
 return result;
}

/** Resolve a server session under its token hash and install its tenant claim before application queries. */
export async function withSessionToken<T>(tokenHash:string,fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<T>{
 if(transactionContext.getStore())return fn();
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 const result=await base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.session_token_hash', ${tokenHash}, true)`;
  const session=await tx.session.findUnique({where:{tokenHash},select:{userId:true,tenantId:true,expiresAt:true}});
  if(session){
   await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${session.userId}, true)`;
   const membership=await tx.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:session.tenantId,userId:session.userId}},select:{status:true}});
   if(session.expiresAt>new Date()&&membership?.status==='ACTIVE')await tx.$executeRaw`SELECT set_config('app.tenant_id', ${session.tenantId}, true)`;
  }
  context.tx=tx;
  return transactionContext.run(context,fn);
 },options);
 await runPostCommitActions(context);
 return result;
}

/** Resolve a one-time account capability by hash and scope subsequent user/token work to its tenant. */
export async function withOneTimeToken<T>(tokenHash:string,fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<T>{
 if(transactionContext.getStore())return fn();
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 const result=await base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.one_time_token_hash', ${tokenHash}, true)`;
  const token=await tx.oneTimeToken.findUnique({where:{tokenHash},select:{userId:true,tenantId:true}});
  if(token){
   await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${token.userId}, true)`;
   await tx.$executeRaw`SELECT set_config('app.tenant_id', ${token.tenantId}, true)`;
  }
  context.tx=tx;
  return transactionContext.run(context,fn);
 },options);
 await runPostCommitActions(context);
 return result;
}

/** Permit a narrowly-scoped new tenant insert from an already-authenticated request. */
export async function withOrganizationCreation<T>(tenantId:string,fn:()=>Promise<T>):Promise<T>{
 const active=transactionContext.getStore();
 if(!active)throw new Error('Organization creation requires an authenticated request transaction.');
 await active.tx.$executeRaw`SELECT set_config('app.organization_create_id', ${tenantId}, true)`;
 return fn();
}

/** Explicit elevated transaction for allowlisted platform administration only. */
export async function withPlatformAdmin<T>(fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<T>{
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 const result=await base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.platform_admin', 'true', true)`;
  context.tx=tx;
  return transactionContext.run(context,fn);
 },options);
 await runPostCommitActions(context);
 return result;
}

/** Run a narrowly-scoped platform-control read for trusted background workers. */
export async function withTrustedWorker<T>(fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<T>{
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 const result=await base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.trusted_worker', 'true', true)`;
  context.tx=tx;
  return transactionContext.run(context,fn);
 },options);
 return result;
}

/** Narrow anonymous insertion context for the public abuse-report intake endpoint. */
export async function withPublicAbuseReport<T>(fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<T>{
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 return base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.public_abuse_report', 'true', true)`;
  context.tx=tx;
  return transactionContext.run(context,fn);
 },options);
}

/** Missing or unreadable global pause state fails closed. */
export async function isPlatformSendingPaused():Promise<boolean>{
 try{
  const read=async()=>{const control=await prisma.platformControl.findUnique({where:{id:1},select:{sendingPaused:true}});return control?.sendingPaused??true;};
  if(transactionContext.getStore())return await read();
  return await withTrustedWorker(read,{maxWait:5000,timeout:8000});
 }
 catch{return true;}
}

/** Resolve a hashed API key through a narrow RLS claim, then run the request in its tenant transaction. */
export async function withApiKey<T>(keyHash:string,fn:()=>Promise<T>,options:{maxWait?:number;timeout?:number}={}):Promise<{authorized:true;value:T}|{authorized:false;value:null}>{
 const context:RequestTransaction={tx:undefined as unknown as Prisma.TransactionClient,afterCommit:[]};
 const result=await base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.api_key_hash', ${keyHash}, true)`;
  const key=await tx.apiKey.findUnique({where:{keyHash},select:{id:true,tenantId:true,expiresAt:true,revokedAt:true}});
  if(!key||key.revokedAt||(key.expiresAt&&key.expiresAt<=new Date()))return {authorized:false as const,value:null};
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${key.tenantId}, true)`;
  await tx.apiKey.update({where:{id:key.id},data:{lastUsedAt:new Date()}});
  context.tx=tx;
  const value=await transactionContext.run(context,fn);
  return {authorized:true as const,value};
 },options);
 await runPostCommitActions(context);
 return result;
}
async function runPostCommitActions(context:RequestTransaction){
 for(const action of context.afterCommit){
  try{await action.run();}
  catch(error){
   if(action.required)throw error;
   console.error('Deferred post-commit action failed.');
  }
 }
}
export function afterTenantCommit(action:()=>Promise<unknown>,options:{required?:boolean}={}){
 const context=transactionContext.getStore();
 if(context){context.afterCommit.push({run:action,required:options.required===true});return;}
 if(options.required)return action();
 void action().catch(()=>console.error('Deferred action failed.'));
}

/** Resolve a random unsubscribe capability under its narrowly-scoped RLS exception. */
export async function withUnsubscribeToken<T>(hash:string,fn:(recipient:{id:string;tenantId:string})=>Promise<T>):Promise<T|null>{
 return base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.unsubscribe_token_hash', ${hash}, true)`;
  const recipient=await tx.campaignRecipient.findUnique({where:{unsubscribeTokenHash:hash},select:{id:true,tenantId:true}});
  if(!recipient)return null;
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${recipient.tenantId}, true)`;
  const context:RequestTransaction={tx,afterCommit:[]};
  return transactionContext.run(context,()=>fn(recipient));
 });
}

/** Resolve a public image capability under its narrow RLS exception. */
export async function withImageToken<T>(hash:string,fn:(asset:{id:string;tenantId:string;objectKey:string;contentType:string;byteSize:number})=>Promise<T>):Promise<T|null>{
 return base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.image_token_hash', ${hash}, true)`;
  const asset=await tx.imageAsset.findUnique({where:{tokenHash:hash},select:{id:true,tenantId:true,objectKey:true,contentType:true,byteSize:true}});
  if(!asset)return null;
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${asset.tenantId}, true)`;
  const context:RequestTransaction={tx,afterCommit:[]};
  return transactionContext.run(context,()=>fn(asset));
 });
}

/** Resolve a one-time subscription confirmation capability under tenant RLS. */
export async function withContactConfirmationToken<T>(hash:string,fn:(token:{id:string;tenantId:string;contactId:string;expiresAt:Date;confirmedAt:Date|null})=>Promise<T>):Promise<T|null>{
 return base.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.contact_confirmation_token_hash', ${hash}, true)`;
  const token=await tx.contactConfirmationToken.findUnique({where:{tokenHash:hash},select:{id:true,tenantId:true,contactId:true,expiresAt:true,confirmedAt:true}});
  if(!token)return null;
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${token.tenantId}, true)`;
  const context:RequestTransaction={tx,afterCommit:[]};
  return transactionContext.run(context,()=>fn(token));
 });
}

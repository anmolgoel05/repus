'use strict';

// Opt-in local process-crash drill. Never connect this tool to production services.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {Client}=require('pg');
const Redis=require('ioredis');
const {Queue,Worker}=require('bullmq');
const {resolveLaunch}=require('./command-launch.cjs');
const root=path.resolve(__dirname,'..');
fs.accessSync(path.join(root,'apps/worker/dist/main.js'));
require('dotenv').config({path:path.join(root,'.env'),override:false,quiet:true});
const local=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
const owner=new URL(process.env.MIGRATION_DATABASE_URL??'');
const worker=new URL(process.env.WORKER_DATABASE_URL??'');
const api=new URL(process.env.DATABASE_URL??'');
const redisUrl=new URL(process.env.WORKER_RECOVERY_REDIS_URL??'');
if(![owner,worker,api,redisUrl].every(local))throw Error('Recovery verification requires loopback services.');
if(!/^\/(?:[1-9]|1[0-5])$/.test(redisUrl.pathname))throw Error('Set WORKER_RECOVERY_REDIS_URL to an unused Redis database 1–15; database zero is forbidden.');
if(owner.username!=='repus'||worker.username!=='repus_worker'||api.username!=='repus_api'||[worker,api].some(url=>url.host!==owner.host))throw Error('Use standard development roles on the same PostgreSQL cluster.');
if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)throw Error('Configure a development session secret.');
const nonce=randomUUID().replaceAll('-','').slice(0,12);
const database=`repus_worker_drill_${nonce}`;
const directory=path.join(root,'.repus-test-data',`worker-drill-${nonce}`);
fs.mkdirSync(directory,{recursive:true});
const databaseUrl=role=>{const value=new URL(role);value.pathname='/'+database;value.search='';return value.toString();};
const environment={...process.env,NODE_ENV:'development',EMAIL_PROVIDER:'development',DATABASE_URL:databaseUrl(worker),WORKER_DATABASE_URL:databaseUrl(worker),MIGRATION_DATABASE_URL:databaseUrl(owner),REDIS_URL:redisUrl.toString(),AWS_SES_SQS_URL:'',AWS_SES_SNS_TOPIC_ARN:'',AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',IMPORT_STAGING_DIR:path.join(directory,'imports'),PLATFORM_TIMEZONE:'UTC',PLATFORM_DAILY_SEND_LIMIT:'100',PLATFORM_MONTHLY_SEND_LIMIT:'100',EMAIL_MAX_SEND_RATE_PER_SECOND:'5'};
environment.AWS_S3_BUCKET='';
const secrets=[owner.password,worker.password,api.password,redisUrl.password,process.env.SESSION_SECRET].filter(Boolean).flatMap(value=>[value,decodeURIComponent(value)]);
let output='',child;
const redact=value=>secrets.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),String(value));
function run(command,args,extra={}){
 const env={...environment,...extra};const launch=resolveLaunch(command,args,{root,cwd:root,env});
 const result=spawnSync(launch.file,launch.args,{cwd:root,env,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
 fs.appendFileSync(path.join(directory,'setup.log'),redact((result.stdout??'')+(result.stderr??'')));
 if(result.error||result.status!==0)throw Error(`Recovery setup failed at ${path.basename(command)}; inspect the local redacted log.`);
}
async function until(check,label,timeout=35000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(await check())return;if(child&&(child.spawnFailure||child.exitCode!==null))throw Error('Worker stopped unexpectedly.');await delay(200);}
 throw Error(`Timed out waiting for ${label}.`);
}
async function startWorker(){
 const startOffset=output.length;
 child=spawn(process.execPath,['apps/worker/dist/main.js'],{cwd:root,env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true});
 child.on('error',error=>{child.spawnFailure=true;output+=redact(error.message);});
 for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{const text=redact(data.toString());output+=text;fs.appendFileSync(path.join(directory,'worker.log'),text);});
 await until(()=>output.slice(startOffset).includes('Repus sending workers started.'),'worker startup');
}
async function crashWorker(){
 if(!child)return;const target=child;child=undefined;
 if(target.exitCode!==null||!target.pid)return;
 const exit=once(target,'exit');target.kill('SIGKILL');await exit;
}
function accepted(kind='campaign'){return output.split(/\r?\n/).flatMap(line=>{try{const event=JSON.parse(line);return event.type==='development_email_accepted'&&(kind==='campaign'?Boolean(event.tags?.recipient_id):event.tags?.kind===kind)?[event]:[];}catch{return [];}});}
function assert(condition,message){if(!condition)throw Error(message);}
async function restartRedisIfRequested(){
 if(process.env.WORKER_RECOVERY_RESTART_REDIS!=='1')return;
 if(typeof process.send!=='function')throw Error('Redis restart verification must run through test:redis-recovery.');
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{process.off('message',reply);reject(Error('Redis restart controller did not respond.'));},30000);
  function reply(message){if(message?.type!=='redis-restarted'&&message?.type!=='redis-restart-failed')return;clearTimeout(timeout);process.off('message',reply);message.type==='redis-restarted'?resolve():reject(Error('Isolated Redis restart failed.'));}
  process.on('message',reply);process.send({type:'redis-restart-ready'});
 });
}

(async()=>{
 const redis=new Redis(redisUrl.toString(),{maxRetriesPerRequest:1,connectTimeout:5000});
 const admin=new Client({connectionString:databaseUrl(owner).replace('/'+database,'/postgres')});
 let db,queues=[],created=false,ownsRedis=false;
 try{
  await redis.ping();assert(await redis.dbsize()===0,'Selected Redis database is not empty; no data was changed.');
  assert(await redis.set('repus-worker-recovery-lock',nonce,'NX')==='OK','Recovery database is in use.');ownsRedis=true;
  await admin.connect();assert(/^repus_worker_drill_[a-f0-9]{12}$/.test(database),'Invalid disposable database name.');
  await admin.query(`CREATE DATABASE "${database}"`);created=true;
  run('npm',['run','db:migrate']);
  const bin=process.env.PGCLIENT_BIN||(process.platform==='win32'?path.join(root,'.repus-tools/postgres-clients/bin'):'');
  const psql=bin?path.join(bin,process.platform==='win32'?'psql.exe':'psql'):'psql';
  run(psql,['--dbname='+databaseUrl(owner),'-v','ON_ERROR_STOP=1','-f','infrastructure/postgres/01-application-roles.sql'],{API_DB_PASSWORD:decodeURIComponent(api.password),WORKER_DB_PASSWORD:decodeURIComponent(worker.password)});
  db=new Client({connectionString:databaseUrl(owner)});await db.connect();await db.query("SET TIME ZONE 'UTC'");
  const {rows:[tenant]}=await db.query("INSERT INTO tenants(name,slug) VALUES('Local worker recovery drill',$1) RETURNING id",['worker-drill-'+nonce]);
  const terminalImportId=randomUUID(), failedImportId=randomUUID();
  const terminalKey=`${tenant.id}/${terminalImportId}.csv`, failedKey=`${tenant.id}/${failedImportId}.csv`;
  const terminalPath=path.join(environment.IMPORT_STAGING_DIR,terminalKey), failedPath=path.join(environment.IMPORT_STAGING_DIR,failedKey);
  // A directory at the object path makes the local file deletion fail predictably.
  fs.mkdirSync(terminalPath,{recursive:true});
  fs.writeFileSync(failedPath,'email\nretry-fixture@example.test\n');
  await db.query("INSERT INTO import_jobs(id,tenant_id,file_key,status,completed_at) VALUES($1,$2,$3,'COMPLETED',NOW()),($4,$2,$5,'FAILED',NOW())",[terminalImportId,tenant.id,terminalKey,failedImportId,failedKey]);
  const pendingImportId=randomUUID(),pendingKey=`${tenant.id}/${pendingImportId}.csv`;
  const pendingEmail='unpublished-import@example.test';
  fs.writeFileSync(path.join(environment.IMPORT_STAGING_DIR,pendingKey),`email\n${pendingEmail}\n`);
  await db.query("INSERT INTO import_jobs(id,tenant_id,file_key,status,attempt,total_rows,csv_headers,field_mapping,consent_source,consent_at) VALUES($1,$2,$3,'PROCESSING',1,1,$4,$5,'Local recovery fixture',NOW())",[pendingImportId,tenant.id,pendingKey,JSON.stringify(['email']),JSON.stringify({email:'email'})]);
  const {createOpaqueToken,encryptToken,tokenHash}=require('@repus/token-security');const rawAccountToken=createOpaqueToken();
  const {rows:[account]}=await db.query("INSERT INTO users(tenant_id,name,email,normalized_email,password_hash,status) VALUES($1,'Recovery account','account-recovery@example.test','account-recovery@example.test','not-authenticatable-fixture','PENDING') RETURNING id",[tenant.id]);
  const {rows:[accountToken]}=await db.query("INSERT INTO one_time_tokens(tenant_id,user_id,token_hash,token_encrypted,purpose,expires_at) VALUES($1,$2,$3,$4,'verify_email',NOW()+INTERVAL '1 hour') RETURNING id",[tenant.id,account.id,tokenHash(rawAccountToken),encryptToken(rawAccountToken,environment.SESSION_SECRET)]);
  const expiredCapability=createOpaqueToken();
  const {rows:[interruptedAccountToken]}=await db.query(
   "INSERT INTO one_time_tokens(tenant_id,user_id,token_hash,token_encrypted,purpose,expires_at,delivery_status,delivery_started_at,delivery_attempts) VALUES($1,$2,$3,$4,'verify_email',NOW()-INTERVAL '1 minute','SENDING',NOW()-INTERVAL '1 hour',1) RETURNING id",
   [tenant.id,account.id,tokenHash(expiredCapability),encryptToken(expiredCapability,environment.SESSION_SECRET)],
  );
  await db.query('INSERT INTO tenant_sending_limits(tenant_id,daily_limit,monthly_limit,contact_limit) VALUES($1,100,100,100)',[tenant.id]);
  await db.query("INSERT INTO sending_domains(tenant_id,domain,verification_status,dkim_status) VALUES($1,'example.test','verified','verified')",[tenant.id]);
  const recipients=[];
  for(let index=0;index<4;index++){
   const email=`recovery-${index}@example.test`;
   const {rows:[contact]}=await db.query("INSERT INTO contacts(tenant_id,email,normalized_email,status,consent_source,consent_at) VALUES($1,$2,$2,'SUBSCRIBED','Local synthetic recovery drill',NOW()) RETURNING id",[tenant.id,email]);
   const {rows:[campaign]}=await db.query("INSERT INTO campaigns(tenant_id,name,status,subject,html_content,text_content,from_email,quota_date,scheduled_at) VALUES($1,$2,$3,'Recovery verification','<p>Recovery probe</p>','Recovery probe','sender@example.test',CURRENT_DATE,$4) RETURNING id",[tenant.id,'Recovery '+index,index===2?'SCHEDULED':'QUEUED',index===2?new Date(Date.now()+12000):null]);
   const {rows:[recipient]}=await db.query("INSERT INTO campaign_recipients(tenant_id,campaign_id,contact_id,email,status,quota_date,quota_reserved,send_started_at) VALUES($1,$2,$3,$4,$5,CURRENT_DATE,true,$6) RETURNING id",[tenant.id,campaign.id,contact.id,email,index===2?'PENDING':index===3?'SENDING':'QUEUED',index===3?new Date():null]);
   recipients.push(recipient.id);
  }
  await db.query('INSERT INTO daily_usage(tenant_id,usage_date,reserved_count) VALUES($1,CURRENT_DATE,4)',[tenant.id]);
  await db.query('INSERT INTO platform_daily_usage(usage_date,reserved_count) VALUES(CURRENT_DATE,4)');
  queues=['repus-email-sending','repus-scheduled-campaigns','repus-provider-events','repus-csv-import'].map(name=>new Queue(name,{connection:redis}));
  const sending=queues[0];
  await sending.add('send',{recipientId:recipients[1]},{jobId:'recipient-'+recipients[1],delay:8000,removeOnComplete:false});
  // Fail an account job before its database claim, then let the real reconciler repair it.
  const accountJobId=`account-${accountToken.id}-0`;
  await sending.add('send-account',{tokenId:accountToken.id},{jobId:accountJobId,priority:1,attempts:1,removeOnComplete:true,removeOnFail:false});
  const probeConnection=redis.duplicate({maxRetriesPerRequest:null});
  const probeWorker=new Worker('repus-email-sending',async()=>{}, {connection:probeConnection,autorun:false});
  try{const job=await probeWorker.getNextJob('account-preclaim-probe');assert(job?.id===accountJobId,'Could not stage the pre-claim recovery probe.');await job.moveToFailed(new Error('Synthetic infrastructure failure before database claim'),'account-preclaim-probe');}
  finally{await probeWorker.close();await probeConnection.quit();}
  await startWorker();
  const sent=async id=>(await db.query('SELECT provider_message_id FROM campaign_recipients WHERE id=$1',[id])).rows[0].provider_message_id;
  await until(async()=>Boolean(await sent(recipients[0])),'orphaned queued recipient recovery');
  await until(async()=>(await db.query('SELECT status FROM import_jobs WHERE id=$1',[pendingImportId])).rows[0].status==='COMPLETED','unpublished CSV import recovery');
  await until(async()=>(await db.query('SELECT delivery_status FROM one_time_tokens WHERE id=$1',[accountToken.id])).rows[0].delivery_status==='SENT','durable account email');
  await until(()=>output.includes('Import staging cleanup will retry.'),'failed staging cleanup');
  await crashWorker();
  fs.rmdirSync(terminalPath);
  fs.writeFileSync(terminalPath,'email\ncleanup-fixture@example.test\n');
  assert(!await sent(recipients[1]),'Delayed recipient sent before the restart window.');
  await restartRedisIfRequested();
  await delay(8500);
  assert(!await sent(recipients[1]),'Stopped worker unexpectedly accepted a delayed send.');
  await startWorker();
  await until(async()=>Boolean(await sent(recipients[1]))&&Boolean(await sent(recipients[2])),'delayed and scheduled sends after restart');
  await until(async()=>(await db.query('SELECT staging_deleted_at FROM import_jobs WHERE id=$1',[terminalImportId])).rows[0].staging_deleted_at!==null,'staging cleanup after restart');
  assert(!fs.existsSync(terminalPath)&&fs.existsSync(failedPath),'Staging cleanup did not delete the completed file and preserve the retryable file.');
  await crashWorker();
  for(const id of recipients)await sending.add('send',{recipientId:id},{jobId:'replay-'+id,removeOnComplete:false});
  await startWorker();
  await until(async()=>{const jobs=await Promise.all(recipients.map(id=>sending.getJob('replay-'+id)));return (await Promise.all(jobs.map(job=>job.getState()))).every(state=>state==='completed');},'replayed job completion');
  await crashWorker();
  const events=accepted();assert(events.length===3,'Restart or replay produced an unexpected number of provider acceptances.');
  const {rows:[imported]}=await db.query('SELECT imported_rows,processed_rows,(SELECT count(*)::int FROM contacts WHERE tenant_id=$2 AND normalized_email=$3) AS contacts FROM import_jobs WHERE id=$1',[pendingImportId,tenant.id,pendingEmail]);
  assert(imported.imported_rows===1&&imported.processed_rows===1&&imported.contacts===1,'Unpublished import was lost or duplicated.');
  assert(new Set(events.map(event=>event.tags.recipient_id)).size===3,'A recipient was accepted more than once.');
  const acceptedEvents=await db.query("SELECT count(*)::int AS count,count(DISTINCT recipient_id)::int AS recipients FROM email_events WHERE event_type='accepted'");
  assert(acceptedEvents.rows[0].count===3&&acceptedEvents.rows[0].recipients===3,'Canonical acceptance history was duplicated or lost during restart/replay.');
  assert(accepted('account').length===1,'Account email was lost or duplicated across restart/replay.');
  const {rows:[accountDelivery]}=await db.query('SELECT delivery_status,token_encrypted,delivery_message_id FROM one_time_tokens WHERE id=$1',[accountToken.id]);
  assert(accountDelivery.delivery_status==='SENT'&&!accountDelivery.token_encrypted&&accountDelivery.delivery_message_id,'Account email acceptance was not durable or retained unnecessary capability material.');
  const {rows:[interruptedDelivery]}=await db.query('SELECT delivery_status,token_encrypted FROM one_time_tokens WHERE id=$1',[interruptedAccountToken.id]);
  assert(interruptedDelivery.delivery_status==='SENDING'&&interruptedDelivery.token_encrypted===null,'Expired interrupted account email must clear its capability and retain reconciliation state.');
  const {rows:[uncertain]}=await db.query('SELECT status,quota_reserved,provider_message_id FROM campaign_recipients WHERE id=$1',[recipients[3]]);
  assert(uncertain.status==='SENDING'&&uncertain.quota_reserved&&!uncertain.provider_message_id,'An ambiguous in-flight recipient was retried or its reservation released.');
  for(const table of ['daily_usage','platform_daily_usage']){const {rows:[usage]}=await db.query(`SELECT sent_count,reserved_count FROM ${table} WHERE usage_date=CURRENT_DATE`);assert(usage.sent_count===3&&usage.reserved_count===1,'Quota ledger changed more than once during restart/replay.');}
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:true,queuedRecovery:true,delayedRecovery:true,scheduledRecovery:true,workerProcessRestarts:2,redisRestart:process.env.WORKER_RECOVERY_RESTART_REDIS==='1',duplicateProviderAcceptances:0,uncertainSendRetained:true,expiredAccountCapabilityCleared:true,importStagingCleanupRetried:true,unpublishedImport:{processedRows:imported.processed_rows,importedRows:imported.imported_rows,contacts:imported.contacts},quota:{sent:3,reserved:1}},null,2));
  console.log('WORKER_RECOVERY_PASSED: queued, delayed and scheduled sends recovered across process crashes; replay produced no duplicate acceptance; uncertain send and quotas preserved.');
 }catch(error){
  if(db){
   const campaigns=await db.query('SELECT name,status,scheduled_at FROM campaigns');
   const recipients=await db.query('SELECT status,provider_message_id,quota_reserved FROM campaign_recipients');
   process.env.DATABASE_URL=environment.DATABASE_URL;
   const prisma=require('@repus/database').createPrismaClient();
   const visibility={
    scheduled:await prisma.campaign.count({where:{status:'SCHEDULED'}}),
    due:await prisma.campaign.count({where:{status:'SCHEDULED',scheduledAt:{lte:new Date()}}}),
    tenant:await prisma.campaign.count({where:{status:'SCHEDULED',tenant:{is:{status:'active',sendingLimit:{is:{enabled:true}}}}}}),
   };
   await prisma.$disconnect();
   const queueStates=await Promise.all(queues.map(async queue=>({name:queue.name,counts:await queue.getJobCounts('waiting','active','delayed','failed','completed'),jobs:(await queue.getJobs(['failed','active','delayed'])).map(job=>({id:job.id,reason:job.failedReason}))})));
   fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify({campaigns:campaigns.rows,recipients:recipients.rows,queueStates,visibility},null,2));
  }
  throw error;
 }finally{
  await crashWorker();await db?.end();
  if(ownsRedis){for(const queue of queues){await queue.obliterate({force:true});await queue.close();}await redis.del('repus-worker-recovery-lock');}
  await redis.quit();
  if(created)await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
 }
})().catch(error=>{console.error(redact(error.message));process.exit(1);});

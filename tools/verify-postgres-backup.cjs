const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Client}=require('pg');
const {resolveLaunch}=require('./command-launch.cjs');
const root=path.resolve(__dirname,'..');
require('dotenv').config({path:path.join(root,'.env'),override:false,quiet:true});
const ownerUrl=new URL(process.env.MIGRATION_DATABASE_URL??'');
const apiUrl=new URL(process.env.DATABASE_URL??'');
const workerUrl=new URL(process.env.WORKER_DATABASE_URL??'');
const urls=[ownerUrl,apiUrl,workerUrl];
if(urls.some(url=>!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Backup verification requires a disposable local PostgreSQL cluster.');
if(urls.some(url=>url.hostname!==ownerUrl.hostname||(url.port||'5432')!==(ownerUrl.port||'5432')))throw Error('All verification roles must use the same local cluster.');
if(ownerUrl.username!=='repus'||apiUrl.username!=='repus_api'||workerUrl.username!=='repus_worker')throw Error('Backup verification requires the standard development database roles.');
const cfg={host:ownerUrl.hostname.replace(/^\[|\]$/g,''),port:ownerUrl.port||'5432',ownerPassword:decodeURIComponent(ownerUrl.password),apiPassword:decodeURIComponent(apiUrl.password),workerPassword:decodeURIComponent(workerUrl.password)};
if(!cfg.ownerPassword||!cfg.apiPassword||!cfg.workerPassword)throw Error('Explicit local database-role passwords are required for this verification.');
const clientBin=process.env.PGCLIENT_BIN||(process.platform==='win32'?path.join(root,'.repus-tools/postgres-clients/bin'):'');
const migrationNames=fs.readdirSync(path.join(root,'packages/database/prisma/migrations'),{withFileTypes:true})
 .filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
const nonce=randomUUID().replaceAll('-','').slice(0,12);
const source=`repus_backup_drill_source_${nonce}`,target=`repus_backup_drill_target_${nonce}`;
const backupDir=path.join(root,'.repus-test-data',`backup-drill-${nonce}`);
if(!backupDir.startsWith(root+path.sep))throw Error('Unexpected backup target.');
fs.mkdirSync(backupDir,{recursive:true});
const key=randomBytes(32).toString('hex');
fs.writeFileSync(path.join(root,'.repus-test-data',`backup-drill-${nonce}.json`),JSON.stringify({source,target,key,backupDir},null,2),{mode:0o600});
console.log(`Local recovery verification: ${path.relative(root,backupDir)}`);
const host=cfg.host.includes(':')?`[${cfg.host}]`:cfg.host;
const url=(database,worker=false)=>`postgresql://${worker?'repus_worker':'repus'}:${encodeURIComponent(worker?cfg.workerPassword:cfg.ownerPassword)}@${host}:${cfg.port}/${database}`;
const posix=file=>file.replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()).replaceAll('\\','/');
const commonEnv={...process.env,PGPASSWORD:cfg.ownerPassword,API_DB_PASSWORD:cfg.apiPassword,WORKER_DB_PASSWORD:cfg.workerPassword,BACKUP_ENCRYPTION_KEY:key,BACKUP_DIR:posix(backupDir),RESTORE_CONFIRM:'RESTORE_TO_EMPTY_DATABASE',RESTORE_DATABASE_URL:url(target),PATH:(clientBin?clientBin+path.delimiter:'')+process.env.PATH};
function run(command,args,extra={},mustFail=false){
 const env={...commonEnv,...extra};const launch=resolveLaunch(command,args,{root,cwd:root,env});
 const result=spawnSync(launch.file,launch.args,{cwd:root,env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 let log=(result.stdout??'')+(result.stderr??'');for(const secret of [cfg.ownerPassword,cfg.apiPassword,cfg.workerPassword,key])for(const value of [secret,encodeURIComponent(secret)])log=log.replaceAll(value,'[redacted]');fs.appendFileSync(path.join(backupDir,'drill.log'),log);
 if(result.error)throw result.error;
 if(mustFail?result.status===0:result.status!==0)throw Error(`Unexpected exit ${result.status} from ${path.basename(command)}. Inspect the ignored drill log.`);
 return (result.stdout??'')+(result.stderr??'');
}
const bash=process.env.BASH_BIN||(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash');
const psql=clientBin?path.join(clientBin,process.platform==='win32'?'psql.exe':'psql'):'psql';
const restore=(archive,extra={},mustFail=false)=>run(bash,['--noprofile','--norc','tools/postgres-restore.sh',posix(archive)],extra,mustFail);
(async()=>{
 const admin=new Client({connectionString:url('postgres')});await admin.connect();
 for(const name of [source,target]){if(!/^repus_backup_drill_(source|target)_[a-f0-9]{12}$/.test(name))throw Error('Invalid disposable database name.');await admin.query(`CREATE DATABASE "${name}"`);}
 run('npm',['run','db:migrate'],{MIGRATION_DATABASE_URL:url(source)});
 run(psql,['-h',cfg.host,'-p',String(cfg.port),'-U','repus','-d',source,'-v','ON_ERROR_STOP=1','-f','infrastructure/postgres/01-application-roles.sql']);
 const sourceClient=new Client({connectionString:url(source)});await sourceClient.connect();
 const {rows:[tenant]}=await sourceClient.query("INSERT INTO tenants(name,slug) VALUES('Restore probe','restore-probe') RETURNING id");
 const deletedAt=new Date('2026-11-04T00:00:00Z');
 await sourceClient.query(
  "INSERT INTO import_jobs(tenant_id,file_key,status,completed_at,staging_deleted_at) VALUES($1,$2,'COMPLETED',$4,$4),($1,$3,'CANCELLED',$4,NULL)",
  [tenant.id,`${tenant.id}/completed.csv`,`${tenant.id}/pending-cleanup.csv`,deletedAt],
 );
 await sourceClient.query("INSERT INTO contacts(tenant_id,email,normalized_email,first_name,status,consent_source,consent_at) VALUES($1,'restore-probe@example.test','restore-probe@example.test','Recovery probe','SUBSCRIBED','Local backup drill',NOW())",[tenant.id]);
 const {rows:[contact]}=await sourceClient.query('SELECT id FROM contacts WHERE tenant_id=$1',[tenant.id]);
 for(const legacy of [false,true]){
  const {rows:[campaign]}=await sourceClient.query("INSERT INTO campaigns(tenant_id,name,status) VALUES($1,$2,'COMPLETED') RETURNING id",[tenant.id,legacy?'Existing accepted history':'Missing accepted history']);
  const {rows:[recipient]}=await sourceClient.query("INSERT INTO campaign_recipients(tenant_id,campaign_id,contact_id,email,status,quota_date,quota_reserved,provider_message_id,provider_accepted_at,sent_at) VALUES($1,$2,$3,'restore-probe@example.test','SENT',CURRENT_DATE,false,$4,NOW(),NOW()) RETURNING id",[tenant.id,campaign.id,contact.id,legacy?'legacy-probe':'backfill-probe']);
  if(legacy)await sourceClient.query("INSERT INTO email_events(tenant_id,recipient_id,event_type,event_key,event_data) VALUES($1,$2,'accepted','accepted:legacy-probe','{\"source\":\"operator_review\"}')",[tenant.id,recipient.id]);
 }
 const acceptanceBackfill=fs.readFileSync(path.join(root,'packages/database/prisma/migrations/202611030002_acceptance_event_history/migration.sql'),'utf8');
 await sourceClient.query(acceptanceBackfill);await sourceClient.query(acceptanceBackfill);
 const historyProbe=await sourceClient.query("SELECT count(*)::int AS count,count(*) FILTER (WHERE event_data->>'source'='operator_review')::int AS preserved FROM email_events WHERE event_type='accepted'");
 if(historyProbe.rows[0].count!==2||historyProbe.rows[0].preserved!==1)throw Error('Acceptance-history backfill duplicated or replaced existing events.');
 await sourceClient.end();
 run(bash,['--noprofile','--norc','tools/postgres-backup-loop.sh','once'],{DATABASE_URL:url(source,true)});
 const filename=fs.readdirSync(backupDir).find(name=>name.endsWith('.dump.enc'));
 if(!filename)throw Error('Encrypted archive missing.');const archive=path.join(backupDir,filename);
 const badKey=restore(archive,{BACKUP_ENCRYPTION_KEY:randomBytes(32).toString('hex')},true);
 if(!badKey.includes('authentication failed'))throw Error('Wrong-key restore did not fail authentication.');
 const tampered=path.join(backupDir,'tampered.dump.enc');fs.copyFileSync(archive,tampered);fs.appendFileSync(tampered,Buffer.from([1]));fs.copyFileSync(archive+'.hmac',tampered+'.hmac');
 if(!restore(tampered,{},true).includes('authentication failed'))throw Error('Tampered archive was not rejected.');
 const targetClient=new Client({connectionString:url(target)});await targetClient.connect();
 await targetClient.query("CREATE FUNCTION public.restore_guard() RETURNS integer LANGUAGE SQL AS 'SELECT 1'");
 if(!restore(archive,{},true).includes('contains application objects'))throw Error('Function-only restore target was not rejected.');
 await targetClient.query('DROP FUNCTION public.restore_guard()');
 restore(archive);
 const restored=await targetClient.query('SELECT first_name FROM contacts WHERE tenant_id=$1',[tenant.id]);
 if(restored.rows[0]?.first_name!=='Recovery probe')throw Error('Restored contact does not match.');
 const {rows:restoredImports}=await targetClient.query('SELECT status, staging_deleted_at FROM import_jobs WHERE tenant_id=$1',[tenant.id]);
 if(restoredImports.length!==2||restoredImports.find(row=>row.status==='COMPLETED')?.staging_deleted_at?.toISOString()!==deletedAt.toISOString()||restoredImports.find(row=>row.status==='CANCELLED')?.staging_deleted_at!==null){
  throw Error('Restored import staging cleanup state does not match.');
 }
 if((await targetClient.query("SELECT count(*)::int AS count FROM email_events WHERE event_type='accepted'")).rows[0].count!==2)throw Error('Acceptance history was not restored.');
 const history=await targetClient.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
 const restoredMigrations=history.rows.map(row=>row.migration_name).sort();
 if(JSON.stringify(restoredMigrations)!==JSON.stringify(migrationNames))throw Error('Restored migration history does not match the repository.');
 const campaignIndex=await targetClient.query("SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid = to_regclass('public.campaigns_tenant_created_id_idx') AND indisvalid");
 if(!campaignIndex.rows[0]?.definition.endsWith('USING btree (tenant_id, created_at DESC, id DESC)'))throw Error('Campaign pagination index was not restored.');
 if(!restore(archive,{},true).includes('contains application objects'))throw Error('Populated target was not rejected.');
 run(psql,['-h',cfg.host,'-p',String(cfg.port),'-U','repus','-d',target,'-v','ON_ERROR_STOP=1','-f','infrastructure/postgres/01-application-roles.sql']);
 const apiUrl=new URL(url(target));apiUrl.username='repus_api';apiUrl.password=cfg.apiPassword;
 const api=new Client({connectionString:apiUrl.toString()});await api.connect();
 if((await api.query('SELECT count(*)::int AS count FROM contacts')).rows[0].count!==0)throw Error('Restored contacts visible without tenant context.');
 await api.query('BEGIN');await api.query("SELECT set_config('app.tenant_id',$1,true)",[tenant.id]);
 if((await api.query('SELECT count(*)::int AS count FROM contacts')).rows[0].count!==1)throw Error('Restored tenant context cannot read its contact.');
 await api.query('COMMIT');await api.end();await targetClient.end();
 for(const name of [target,source])await admin.query(`DROP DATABASE "${name}"`);
 await admin.end();
 fs.writeFileSync(path.join(backupDir,'result.json'),JSON.stringify({passed:true,migrations:migrationNames.length,restoredMigrationNamesMatch:true,restoredCampaignPaginationIndex:true,wrongKeyRejected:true,tamperRejected:true,functionOnlyTargetRejected:true,populatedTargetRejected:true,restoredTenantRls:true,restoredImportStagingState:true,temporaryDatabasesRemoved:true},null,2));
 console.log('BACKUP_DRILL_PASSED: encrypted archive restored; wrong keys, tampering and non-empty targets rejected; restored tenant RLS verified; disposable databases removed.');
})().catch(error=>{console.error(error.message);process.exit(1);});

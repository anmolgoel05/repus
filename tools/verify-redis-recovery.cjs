'use strict';

// Owns and crashes a separate loopback Redis process. Never restarts the app's Redis.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {randomBytes,randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const Redis=require('ioredis');
const {Queue}=require('bullmq');
const root=path.resolve(__dirname,'..');
require('dotenv').config({path:path.join(root,'.env'),override:false,quiet:true});
const nonce=randomUUID().replaceAll('-','').slice(0,12);
const relativeDirectory=`.repus-test-data/redis-drill-${nonce}`;
const directory=path.join(root,relativeDirectory);
fs.mkdirSync(directory,{recursive:true});
const binary=process.env.REDIS_SERVER_BIN||(process.platform==='win32'?path.join(root,'.repus-tools/redis/Redis-8.10.3-Windows-x64-msys2/redis-server.exe'):'redis-server');
const password=randomBytes(32).toString('hex');
const redacted=value=>String(value).replaceAll(password,'[redacted]');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
let server,drill,redis,probe,restartPromise;
async function stopServer(){
 const target=server;server=undefined;if(!target||target.exitCode!==null||!target.pid)return;
 const exited=once(target,'exit');target.kill('SIGKILL');await exited;
}
async function startServer(){
 const target=spawn(binary,[relativeDirectory+'/redis.conf'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});server=target;
 let failure;target.on('error',error=>{failure=error;});
 for(const stream of [target.stdout,target.stderr])stream.on('data',data=>fs.appendFileSync(path.join(directory,'redis.log'),redacted(data)));
 for(let attempt=0;attempt<80;attempt++){
  if(failure||target.exitCode!==null)throw Error('Isolated Redis server failed to start; inspect the local log.');
  if(redis.status==='ready')return;
  await delay(100);
 }
 throw Error('Isolated Redis did not become ready.');
}
async function restart(){
 // Probe both BullMQ job representations as well as the real worker's pending job.
 await probe.add('waiting',{probe:nonce},{jobId:'probe-waiting'});
 await probe.add('delayed',{probe:nonce},{jobId:'probe-delayed',delay:300000});
 const sending=new Queue('repus-email-sending',{connection:redis});
 try{
  assert(await sending.getDelayedCount()===1,'Expected the real recipient job to be delayed before Redis restart.');
  // Redis 7.2+: establish the durability point before intentionally crashing it.
  const persisted=await redis.call('WAITAOF',1,0,5000);
  assert(Array.isArray(persisted)&&Number(persisted[0])===1,'AOF writes were not confirmed durable. Redis 7.2+ is required.');
  await stopServer();await delay(300);await startServer();
  assert((await probe.getJob('probe-waiting'))?.data.probe===nonce,'Waiting job was lost across the AOF restart.');
  assert(await (await probe.getJob('probe-waiting')).getState()==='waiting','Waiting job state changed across restart.');
  assert(await (await probe.getJob('probe-delayed')).getState()==='delayed','Delayed job was lost across the AOF restart.');
  assert(await sending.getDelayedCount()===1,'The real delayed recipient job was lost across the AOF restart.');
 }finally{await sending.close();}
}

(async()=>{
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 // The configuration file keeps the password out of command-line process listings.
 const dataPath=relativeDirectory;
 fs.writeFileSync(path.join(directory,'redis.conf'),`bind 127.0.0.1\nport ${port}\nprotected-mode yes\nrequirepass ${password}\nappendonly yes\nappendfsync everysec\nsave ""\ndir "${dataPath}"\n`,{mode:0o600});
 const url=`redis://:${password}@127.0.0.1:${port}/15`;
 redis=new Redis(url,{maxRetriesPerRequest:null,connectTimeout:500,retryStrategy:()=>100});
 redis.on('error',()=>{});
 try{
  await startServer();
  drill=spawn(process.execPath,['tools/verify-worker-recovery.cjs'],{cwd:root,env:{...process.env,WORKER_RECOVERY_REDIS_URL:url,WORKER_RECOVERY_RESTART_REDIS:'1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  drill.on('message',message=>{
   if(message?.type!=='redis-restart-ready'||restartPromise)return;
   probe=new Queue('repus-recovery-probe',{connection:redis});
   restartPromise=restart().then(()=>drill.send({type:'redis-restarted'})).catch(error=>{fs.appendFileSync(path.join(directory,'drill.log'),redacted(error.message)+'\n');drill.send({type:'redis-restart-failed'});});
  });
  for(const stream of [drill.stdout,drill.stderr])stream.on('data',data=>fs.appendFileSync(path.join(directory,'drill.log'),redacted(data)));
  const timeout=setTimeout(()=>{drill.kill('SIGKILL');},180000);
  const [code]=await once(drill,'exit');clearTimeout(timeout);await restartPromise;
  assert(code===0&&restartPromise,'The combined recovery drill failed; inspect the local drill log.');
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:true,redisCrashRestarts:1,aofDurabilityConfirmed:true,waitingJobPreserved:true,delayedJobPreserved:true,realWorkerRecovery:true},null,2));
  console.log('REDIS_RECOVERY_PASSED: AOF preserved waiting and delayed jobs across an isolated Redis crash; real worker recovery, replay protection and quotas passed.');
 }finally{
  if(drill&&drill.exitCode===null&&drill.signalCode===null){const exited=once(drill,'exit');drill.kill('SIGKILL');await exited;}
  await probe?.close();redis.disconnect();await stopServer();
 }
})().catch(error=>{console.error(redacted(error.message));process.exit(1);});


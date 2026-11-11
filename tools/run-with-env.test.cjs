const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const path=require('node:path');
const launcher=path.join(__dirname,'run-with-env.cjs');
function inspect(options,env,expression){
 const result=spawnSync(process.execPath,[launcher,...options,'node','-e',`process.stdout.write(JSON.stringify(${expression}))`],{env:{...process.env,...env},encoding:'utf8',shell:false});
 assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout);
}
test('production web commands override development NODE_ENV and use WEB_PORT independently of the API',()=>{
 assert.deepEqual(inspect(['--production','--web'],{NODE_ENV:'development',PORT:'4000',WEB_PORT:'3005'},'{nodeEnv:process.env.NODE_ENV,port:process.env.PORT}'),{nodeEnv:'production',port:'3005'});
});
test('web development preserves its environment while isolating the web port',()=>{
 assert.deepEqual(inspect(['--web'],{NODE_ENV:'development',PORT:'4000',WEB_PORT:'3005'},'{nodeEnv:process.env.NODE_ENV,port:process.env.PORT}'),{nodeEnv:'development',port:'3005'});
});
test('migration and worker modes select their own supplied database role',()=>{
 const env={DATABASE_URL:'postgresql://test-api@localhost/test',MIGRATION_DATABASE_URL:'postgresql://test-owner@localhost/test',WORKER_DATABASE_URL:'postgresql://test-worker@localhost/test'};
 assert.equal(inspect(['--migration-db'],env,'process.env.DATABASE_URL'),env.MIGRATION_DATABASE_URL);
 assert.equal(inspect(['--worker-db'],env,'process.env.DATABASE_URL'),env.WORKER_DATABASE_URL);
});
test('the launcher preserves the child exit status',()=>{
 const result=spawnSync(process.execPath,[launcher,'node','-e','process.exit(7)'],{encoding:'utf8'});
 assert.equal(result.status,7,result.stderr);
});

test('the launcher forwards SIGTERM and waits for the child to finish draining',{skip:process.platform==='win32',timeout:5000},async()=>{
 const program="process.once('SIGTERM',()=>setTimeout(()=>{console.log('drained');process.exit(0)},100));console.log('ready');setTimeout(()=>process.exit(2),3000);";
 const child=spawn(process.execPath,[launcher,'node','-e',program],{stdio:['ignore','pipe','ignore']});
 const closed=once(child,'close');
 let output='';
 child.stdout.setEncoding('utf8');
 child.stdout.on('data',chunk=>{
  const wasReady=output.includes('ready');
  output+=chunk;
  if(!wasReady&&output.includes('ready'))child.kill('SIGTERM');
 });
 const deadline=setTimeout(()=>child.kill('SIGKILL'),4000);
 try{
  const [code,signal]=await closed;
  assert.equal(signal,null);
  assert.equal(code,0);
  assert.match(output,/ready\r?\ndrained/);
 }finally{clearTimeout(deadline);}
});

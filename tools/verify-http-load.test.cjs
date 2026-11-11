'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const directories=()=>fs.existsSync(path.join(root,'.repus-test-data'))?fs.readdirSync(path.join(root,'.repus-test-data')).filter(name=>name.startsWith('http-load-')).sort():[];

for(const [name,overrides] of [
 ['production delivery',{EMAIL_PROVIDER:'ses'}],
 ['remote API',{HTTP_LOAD_API_URL:'http://api.example.test:4000'}],
 ['remote database',{WORKER_DATABASE_URL:'postgresql://repus_worker:unused@database.example.test:5432/repus'}],
 ['owner fixture role',{WORKER_DATABASE_URL:'postgresql://repus:unused@127.0.0.1:1/repus'}],
 ['unbounded rounds',{HTTP_LOAD_ROUNDS:'100'}],
 ['credential-bearing API URL',{HTTP_LOAD_API_URL:'http://user:unused@127.0.0.1:4000'}],
])test(`HTTP load guard rejects ${name} before fixture creation`,()=>{
 const before=directories();
 const result=spawnSync(process.execPath,[path.join(__dirname,'verify-http-load.cjs')],{cwd:root,env:{...process.env,EMAIL_PROVIDER:'development',WORKER_DATABASE_URL:'postgresql://repus_worker:unused@127.0.0.1:1/repus',HTTP_LOAD_API_URL:'http://127.0.0.1:4000',HTTP_LOAD_ROUNDS:'2',...overrides},encoding:'utf8',timeout:5000,windowsHide:true});
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.match(result.stderr,/Local HTTP load drill failed/);
 assert.doesNotMatch(result.stdout+result.stderr,/postgresql:\/\/|user:unused|repus_session/);
 assert.deepEqual(directories(),before,'Rejected configurations must not initialize a fixture run.');
});

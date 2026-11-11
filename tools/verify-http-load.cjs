'use strict';

// Local synthetic-data baseline, not a production capacity certification.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
require('dotenv').config({quiet:true});

async function main(){
 const local=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 const api=new URL(process.env.HTTP_LOAD_API_URL??process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000');
 const database=new URL(process.env.WORKER_DATABASE_URL??'');
 assert.equal(process.env.EMAIL_PROVIDER,'development','Only run against development services.');
 assert.ok(local(api)&&local(database),'Only loopback HTTP and PostgreSQL are allowed.');
 assert.equal(api.protocol,'http:','Use the local development HTTP server.');
 assert.equal(api.pathname,'/','The API URL must be an origin.');
 assert.ok(!api.username&&!api.password&&!api.search&&!api.hash,'Use a plain API origin.');
 assert.equal(database.username,'repus_worker','Use the standard development fixture role.');
 const rounds=Number(process.env.HTTP_LOAD_ROUNDS??3);
 assert.ok(Number.isInteger(rounds)&&rounds>=2&&rounds<=10,'Choose 2–10 rounds.');
 process.env.DATABASE_URL=database.toString();
 const {createPrismaClient}=require('@repus/database');
 const db=createPrismaClient();
 const nonce=randomUUID().replaceAll('-','').slice(0,12);
 const directory=path.resolve('.repus-test-data',`http-load-${nonce}`);
 fs.mkdirSync(directory,{recursive:true});
 const fixtures=[],samples=[],statuses={};
 const started=performance.now();
 let failure,stage='role-preflight';
 const report={kind:'local-http-load',rounds,concurrency:8,requestsPerRound:40,intervalMs:61000,latencyBudgetMs:5000,passed:false};
 async function request(route,cookie){
  const start=performance.now();
  const response=await fetch(new URL(`/api/v1${route}`,api),{headers:cookie?{cookie:`repus_session=${cookie}`}:{},signal:AbortSignal.timeout(10000),redirect:'error'});
  const body=await response.json();
  return {response,body,elapsed:performance.now()-start};
 }
 try{
  const [role]=await db.$queryRaw`SELECT rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname=current_user`;
  assert.deepEqual(role,{bypass:true,superuser:false},'Fixtures require a non-superuser trusted worker role.');
  stage='api-readiness';
  assert.equal((await request('/health/ready')).response.status,200,'Start the API before running the drill.');
  for(let index=0;index<2;index++){
   stage='fixture-creation';
   const tenantId=randomUUID(),userId=randomUUID(),cookie=randomBytes(32).toString('hex');
   const email=`http-load-${nonce}-${index}@example.test`,slug=`http-load-${nonce}-${index}`;
   const contacts=Array.from({length:120},(_,i)=>({id:randomUUID(),tenantId,email:`contact-${i}-${index}-${nonce}@example.test`,normalizedEmail:`contact-${i}-${index}-${nonce}@example.test`,status:'SUBSCRIBED',consentSource:'Local synthetic load fixture',consentAt:new Date()}));
   await db.$transaction(async tx=>{
    await tx.tenant.create({data:{id:tenantId,name:slug,slug}});
    await tx.user.create({data:{id:userId,tenantId,name:'Local load fixture',email,normalizedEmail:email,passwordHash:'unusable-load-fixture',status:'ACTIVE',emailVerifiedAt:new Date()}});
    await tx.organizationMembership.create({data:{tenantId,userId,role:'OWNER',status:'ACTIVE'}});
    await tx.session.create({data:{tenantId,userId,tokenHash:createHash('sha256').update(cookie).digest('hex'),expiresAt:new Date(Date.now()+30*60*1000)}});
    await tx.contact.createMany({data:contacts});
   });
   fixtures.push({tenantId,slug,cookie,contacts});
  }
  for(let round=0;round<rounds;round++){
   stage=`http-round-${round+1}`;
   const roundStart=performance.now();let next=0;
   const results=await Promise.allSettled(Array.from({length:8},async()=>{
    while(next<40){
     const index=next++,fixture=fixtures[index%2],foreign=fixtures[1-index%2];
     const mode=Math.floor(index/2)%4;
     const contact=fixture.contacts[index];
     // Forged query tenant IDs must never override the authenticated context.
     const route=mode===0?`/contacts/${foreign.contacts[index].id}`:mode===1?`/contacts/${contact.id}`:mode===2?`/contacts?page=2&tenantId=${foreign.tenantId}`:`/contacts?q=${nonce}&tenantId=${foreign.tenantId}`;
     const {response,body,elapsed}=await request(route,fixture.cookie);
     samples.push(elapsed);statuses[response.status]=(statuses[response.status]??0)+1;
     assert.equal(response.status,mode===0?404:200,`Unexpected status in round ${round+1}; do not clear or increase rate limits to make the drill pass.`);
     assert.match(response.headers.get('cache-control')??'',/no-store/);
     if(mode===1){assert.equal(body.data.id,contact.id);assert.equal(body.data.tenantId,fixture.tenantId);}
     if(mode>=2){
      assert.equal(body.data.total,120);assert.equal(body.data.items.length,25);
      for(const item of body.data.items){assert.equal(item.tenantId,fixture.tenantId);assert.ok(fixture.contacts.some(own=>own.id===item.id));}
     }
     assert.ok(elapsed<=5000,'A response exceeded the explicit 5-second local baseline budget.');
    }
   }));
   const rejected=results.find(result=>result.status==='rejected');
   if(rejected)throw rejected.reason;
   console.log(`HTTP load round ${round+1}/${rounds}: 40 responses verified; tenant isolation intact.`);
   if(round+1<rounds)await delay(Math.max(0,61000-(performance.now()-roundStart)));
  }
  report.passed=true;
 }catch(error){failure=error;report.failedStage=stage;report.failure='HTTP load verification failed. No raw responses or credentials are retained.';}
 finally{
  try{
   for(const fixture of fixtures)await db.tenant.deleteMany({where:{id:fixture.tenantId,slug:fixture.slug}});
   report.remainingFixtures=await db.tenant.count({where:{slug:{startsWith:`http-load-${nonce}-`}}});
   assert.equal(report.remainingFixtures,0,'Synthetic fixture cleanup failed.');
  }catch(error){failure??=error;report.passed=false;report.cleanupFailed=true;}
  await db.$disconnect();
  const sorted=samples.toSorted((a,b)=>a-b),percentile=p=>sorted.length?Math.round(sorted[Math.ceil(sorted.length*p)-1]):null;
  Object.assign(report,{requests:samples.length,statuses,durationMs:Math.round(performance.now()-started),latencyMs:{p50:percentile(.5),p95:percentile(.95),max:sorted.length?Math.round(sorted.at(-1)):null}});
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
 }
 // Never dump fixture objects, session cookies, raw responses or connection errors.
 if(failure)throw Error('Local HTTP load drill failed. See its local aggregate result; keep configured rate limits unchanged.');
}
main().catch(()=>{console.error('Local HTTP load drill failed. Check development services/configuration and the aggregate result in .repus-test-data.');process.exitCode=1;});

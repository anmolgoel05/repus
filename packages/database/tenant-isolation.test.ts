import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
const testDatabaseUrl=process.env.RLS_TEST_DATABASE_URL||process.env.TEST_DATABASE_URL;
const enabled=Boolean(testDatabaseUrl);
describe.skipIf(!enabled)('PostgreSQL tenant row-level security',()=>{
 it('keeps committed work successful and runs later callbacks after a best-effort failure',async()=>{
  const {afterTenantCommit}=await import('./index');
  const next=vi.fn().mockResolvedValue(undefined);
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
   await expect(withSessionToken(sessionHash,async()=>{
    afterTenantCommit(async()=>{throw new Error('private.redis.test');});
    afterTenantCommit(next);
    return 'committed';
   })).resolves.toBe('committed');
   expect(next).toHaveBeenCalledOnce();
   expect(log).toHaveBeenCalledExactlyOnceWith('Deferred post-commit action failed.');
  }finally{log.mockRestore();}
 });
 it('surfaces required post-commit failures without executing callbacks after rollback',async()=>{
  const {afterTenantCommit}=await import('./index');
  const failure=new Error('Required action failed');
  let ran=false;
  await expect(withSessionToken(sessionHash,async()=>{
   await afterTenantCommit(async()=>{ran=true;throw failure;},{required:true});
   expect(ran).toBe(false);
  })).rejects.toBe(failure);
  expect(ran).toBe(true);
  ran=false;
  await expect(withSessionToken(sessionHash,async()=>{
   await afterTenantCommit(async()=>{ran=true;},{required:true});
   throw failure;
  })).rejects.toBe(failure);
  expect(ran).toBe(false);
 });
 let unsharedUserB:any;
 let prisma:any,withTenant:any,withApiKey:any,withPlatformAdmin:any,withTrustedWorker:any,withImageToken:any,withPublicAbuseReport:any,withContactConfirmationToken:any,withAuthUserEmail:any,withSessionToken:any,withOneTimeToken:any,tenantA:any,tenantB:any,contactA:any,contactB:any,ownerB:any,importJobB:any,imageB:any,billingB:any,imageHash:string,confirmationHash:string,apiKeyHash:string,sessionHash:string,switchSessionHash:string,expiredSessionHash:string,oneTimeHash:string;
 beforeAll(async()=>{
  process.env.DATABASE_URL=testDatabaseUrl!;
  const db=await import('./index');prisma=db.prisma;withTenant=db.withTenant;withApiKey=db.withApiKey;withPlatformAdmin=db.withPlatformAdmin;withTrustedWorker=db.withTrustedWorker;withImageToken=db.withImageToken;withPublicAbuseReport=db.withPublicAbuseReport;withContactConfirmationToken=db.withContactConfirmationToken;withAuthUserEmail=db.withAuthUserEmail;withSessionToken=db.withSessionToken;withOneTimeToken=db.withOneTimeToken;
  const [role]=await prisma.$queryRaw`SELECT r.rolsuper, r.rolbypassrls, pg_has_role(current_user,c.relowner,'USAGE') AS owns_tenant_table FROM pg_roles r JOIN pg_class c ON c.oid='public.tenants'::regclass WHERE r.rolname=current_user`;
  expect(role).toMatchObject({rolsuper:false,rolbypassrls:false,owns_tenant_table:false});
  const [privileges]=await prisma.$queryRaw`SELECT has_table_privilege(current_user,'public.contacts','TRUNCATE') AS can_truncate, has_table_privilege(current_user,'public._prisma_migrations','INSERT, UPDATE, DELETE') AS can_edit_migrations`;
  expect(privileges).toEqual({can_truncate:false,can_edit_migrations:false});
  const [workerPrivileges]=await prisma.$queryRaw`SELECT has_table_privilege('repus_worker','public.contacts','TRUNCATE') AS can_truncate, has_table_privilege('repus_worker','public._prisma_migrations','INSERT, UPDATE, DELETE') AS can_edit_migrations`;
  expect(workerPrivileges).toEqual({can_truncate:false,can_edit_migrations:false});
  const [backupPrivileges]=await prisma.$queryRaw`SELECT has_table_privilege('repus_worker','public._prisma_migrations','SELECT') AS can_back_up_history`;
  expect(backupPrivileges.can_back_up_history).toBe(true);
  tenantA=await withPlatformAdmin(()=>prisma.tenant.create({data:{name:'Test workspace A',slug:`test-a-${randomUUID()}`}}));
  tenantB=await withPlatformAdmin(()=>prisma.tenant.create({data:{name:'Test workspace B',slug:`test-b-${randomUUID()}`}}));
  const ownerBEmail=`api-owner-${randomUUID()}@example.test`;ownerB=await withTenant(tenantB.id,()=>prisma.user.create({data:{tenantId:tenantB.id,name:'API key owner',email:ownerBEmail,normalizedEmail:ownerBEmail,passwordHash:'test-only',role:'OWNER',status:'ACTIVE'}}));
  await withTenant(tenantB.id,()=>prisma.organizationMembership.create({data:{tenantId:tenantB.id,userId:ownerB.id,role:'OWNER',status:'ACTIVE'}}));
  const unsharedEmail=`unshared-${randomUUID()}@example.test`;
  unsharedUserB=await withTenant(tenantB.id,()=>prisma.user.create({data:{tenantId:tenantB.id,name:'Unshared member',email:unsharedEmail,normalizedEmail:unsharedEmail,passwordHash:'test-only',status:'ACTIVE'}}));
  await withTenant(tenantB.id,()=>prisma.organizationMembership.create({data:{tenantId:tenantB.id,userId:unsharedUserB.id,role:'VIEWER',status:'ACTIVE'}}));
  sessionHash=createHash('sha256').update(`session-${randomUUID()}`).digest('hex');switchSessionHash=createHash('sha256').update(`switch-session-${randomUUID()}`).digest('hex');expiredSessionHash=createHash('sha256').update(`expired-session-${randomUUID()}`).digest('hex');oneTimeHash=createHash('sha256').update(`one-time-${randomUUID()}`).digest('hex');
  await withTenant(tenantB.id,()=>prisma.session.create({data:{tenantId:tenantB.id,userId:ownerB.id,tokenHash:sessionHash,expiresAt:new Date(Date.now()+60_000)}}));
  await withTenant(tenantB.id,()=>prisma.session.create({data:{tenantId:tenantB.id,userId:ownerB.id,tokenHash:switchSessionHash,expiresAt:new Date(Date.now()+60_000)}}));
  await withTenant(tenantA.id,()=>prisma.organizationMembership.create({data:{tenantId:tenantA.id,userId:ownerB.id,role:'VIEWER',status:'ACTIVE'}}));
  await withTenant(tenantB.id,()=>prisma.session.create({data:{tenantId:tenantB.id,userId:ownerB.id,tokenHash:expiredSessionHash,expiresAt:new Date(Date.now()-1000)}}));
  await withTenant(tenantB.id,()=>prisma.oneTimeToken.create({data:{tenantId:tenantB.id,userId:ownerB.id,tokenHash:oneTimeHash,purpose:'verify_email',expiresAt:new Date(Date.now()+60_000)}}));
  contactA=await withTenant(tenantA.id,()=>prisma.contact.create({data:{tenantId:tenantA.id,email:'tenant-a@example.test',normalizedEmail:'tenant-a@example.test',status:'SUBSCRIBED',consentSource:'integration test',consentAt:new Date()}}));
  contactB=await withTenant(tenantB.id,()=>prisma.contact.create({data:{tenantId:tenantB.id,email:'private@example.test',normalizedEmail:'private@example.test',status:'SUBSCRIBED',consentSource:'integration test',consentAt:new Date()}}));
  confirmationHash=createHash('sha256').update(`confirmation-${randomUUID()}`).digest('hex');
  await withTenant(tenantB.id,()=>prisma.contactConfirmationToken.create({data:{tenantId:tenantB.id,contactId:contactB.id,tokenHash:confirmationHash,tokenEncrypted:'integration-test-only',expiresAt:new Date(Date.now()+60_000)}}));
  const rawKey=`rps_live_${randomUUID()}`;apiKeyHash=createHash('sha256').update(rawKey).digest('hex');
  await withTenant(tenantB.id,()=>prisma.apiKey.create({data:{tenantId:tenantB.id,createdByUserId:ownerB.id,name:'Integration key',keyHash:apiKeyHash,role:'VIEWER'}}));
  await withTenant(tenantB.id,()=>prisma.tenantSendingLimit.create({data:{tenantId:tenantB.id,dailyLimit:321,monthlyLimit:654}}));
  importJobB=await withTenant(tenantB.id,()=>prisma.importJob.create({data:{tenantId:tenantB.id,fileKey:`${tenantB.id}/${randomUUID()}.csv`}}));
  await withTenant(tenantB.id,()=>prisma.importError.create({data:{tenantId:tenantB.id,importJobId:importJobB.id,rowNumber:2,email:'private@example.test',reason:'test',rowData:{email:'private@example.test'}}}));
  imageHash=createHash('sha256').update(`image-capability-${randomUUID()}`).digest('hex');
  imageB=await withTenant(tenantB.id,()=>prisma.imageAsset.create({data:{tenantId:tenantB.id,objectKey:`${tenantB.id}/${randomUUID()}.png`,contentType:'image/png',byteSize:8,tokenHash:imageHash,tokenEncrypted:'integration-test-only'}}));
  billingB=await withTenant(tenantB.id,()=>prisma.billingSubscription.create({data:{tenantId:tenantB.id,provider:'test',providerCustomerId:`customer-${randomUUID()}`,providerSubscriptionId:`subscription-${randomUUID()}`,plan:'starter',status:'active'}}));
 });
 afterAll(async()=>{if(prisma&&tenantA)await withPlatformAdmin(()=>prisma.tenant.delete({where:{id:tenantA.id}}));if(prisma&&tenantB)await withPlatformAdmin(()=>prisma.tenant.delete({where:{id:tenantB.id}}));if(prisma)await prisma.$disconnect()});
 it('hides a tenant B contact inside a tenant A transaction even without a tenant filter',async()=>{
  const found=await withTenant(tenantA.id,()=>prisma.contact.findUnique({where:{id:contactB.id}}));expect(found).toBeNull();
 });
 it('protects tenant, user, session, and one-time-token lookup through narrow authentication claims',async()=>{
  expect(await withTenant(tenantA.id,()=>prisma.user.findUnique({where:{id:unsharedUserB.id}}))).toBeNull();
  await expect(withAuthUserEmail(ownerB.email,()=>prisma.user.findUnique({where:{normalizedEmail:ownerB.email},include:{tenant:true}}))).resolves.toMatchObject({id:ownerB.id,tenant:{id:tenantB.id}});
  await expect(withSessionToken(sessionHash,()=>prisma.session.findUnique({where:{tokenHash:sessionHash},include:{user:{include:{tenant:true}}}}))).resolves.toMatchObject({tenantId:tenantB.id,user:{id:ownerB.id,tenant:{id:tenantB.id}}});
  await expect(withOneTimeToken(oneTimeHash,()=>prisma.oneTimeToken.findUnique({where:{tokenHash:oneTimeHash}}))).resolves.toMatchObject({userId:ownerB.id});
  expect(await withTenant(tenantA.id,()=>prisma.session.findUnique({where:{tokenHash:sessionHash}}))).toBeNull();
  expect(await withSessionToken(expiredSessionHash,()=>prisma.contact.findUnique({where:{id:contactB.id}}))).toBeNull();
 });
 it('exposes cross-workspace memberships only through the matching user authentication claim',async()=>{
  await expect(withTenant(tenantA.id,()=>prisma.user.findUnique({where:{id:ownerB.id},select:{id:true,name:true}}))).resolves.toMatchObject({id:ownerB.id});
  await expect(withTenant(tenantA.id,()=>prisma.tenant.findUnique({where:{id:tenantB.id}}))).resolves.toBeNull();
  await expect(withTenant(tenantA.id,()=>prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:tenantB.id,userId:ownerB.id}}}))).resolves.toBeNull();
  await expect(withTenant(tenantA.id,()=>withAuthUserEmail(ownerB.email,()=>prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:tenantB.id,userId:ownerB.id}}})))).resolves.toMatchObject({tenantId:tenantB.id,userId:ownerB.id,role:'OWNER',status:'ACTIVE'});
  await expect(withAuthUserEmail(ownerB.email,()=>prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:tenantB.id,userId:ownerB.id}}}))).resolves.toMatchObject({tenantId:tenantB.id,userId:ownerB.id,role:'OWNER',status:'ACTIVE'});
 });
 it('permits a session to switch only to a workspace with an active membership',async()=>{
  const nextHash=createHash('sha256').update(`rotated-session-${randomUUID()}`).digest('hex');
  await withSessionToken(switchSessionHash,async()=>{
   const session=await prisma.session.findUnique({where:{tokenHash:switchSessionHash}});
   const membership=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:tenantA.id,userId:ownerB.id}}});
   expect(membership?.status).toBe('ACTIVE');
   await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, true)`;
   await prisma.session.update({where:{id:session.id},data:{tenantId:tenantA.id,tokenHash:nextHash}});
  });
  await expect(withSessionToken(nextHash,()=>prisma.session.findUnique({where:{tokenHash:nextHash}}))).resolves.toMatchObject({tenantId:tenantA.id,userId:ownerB.id});
 });
 it('does not install a tenant claim for a session with a revoked membership',async()=>{
  await withTenant(tenantB.id,()=>prisma.organizationMembership.update({where:{tenantId_userId:{tenantId:tenantB.id,userId:ownerB.id}},data:{status:'DISABLED'}}));
  try{
   await expect(withSessionToken(sessionHash,()=>prisma.contact.findUnique({where:{id:contactB.id}}))).resolves.toBeNull();
  }finally{
   await withTenant(tenantB.id,()=>prisma.organizationMembership.update({where:{tenantId_userId:{tenantId:tenantB.id,userId:ownerB.id}},data:{status:'ACTIVE'}}));
  }
 });
 it('allows trusted workers to read platform controls while keeping writes platform-admin only',async()=>{
  const control=await withTrustedWorker(()=>prisma.platformControl.findUnique({where:{id:1}}));expect(control).toMatchObject({id:1});expect(typeof control.sendingPaused).toBe('boolean');
  await expect(withTrustedWorker(()=>prisma.platformControl.update({where:{id:1},data:{sendingPaused:true}}))).rejects.toThrow();
 });
 it('allows anonymous abuse-report inserts without allowing report reads or updates',async()=>{
  const senderAddress=`report-${randomUUID()}@example.test`;
  await withPublicAbuseReport(()=>prisma.abuseReport.createMany({data:[{senderAddress,category:'unsolicited',details:'An unsolicited message was sent to me.'}]}));
  try{
   const hidden=await withPublicAbuseReport(()=>prisma.abuseReport.findMany({where:{senderAddress}}));
   expect(hidden).toEqual([]);
   const changed=await withPublicAbuseReport(()=>prisma.abuseReport.updateMany({where:{senderAddress},data:{status:'resolved'}}));
   expect(changed.count).toBe(0);
   const visible=await withPlatformAdmin(()=>prisma.abuseReport.findFirst({where:{senderAddress}}));
   expect(visible).toMatchObject({senderAddress,status:'open'});
  }finally{await withPlatformAdmin(()=>prisma.abuseReport.deleteMany({where:{senderAddress}}));}
 });
 it('hides rejected import rows from another tenant',async()=>{
  const found=await withTenant(tenantA.id,()=>prisma.importError.findUnique({where:{importJobId_rowNumber:{importJobId:importJobB.id,rowNumber:2}}}));expect(found).toBeNull();
 });
 it('hides image metadata from other tenants and resolves it only through its image capability',async()=>{
  const hidden=await withTenant(tenantA.id,()=>prisma.imageAsset.findUnique({where:{id:imageB.id}}));expect(hidden).toBeNull();
  const resolved=await withImageToken(imageHash,async(asset:any)=>asset);expect(resolved).toMatchObject({id:imageB.id,tenantId:tenantB.id,contentType:'image/png'});
 });
 it('resolves confirmation capabilities without exposing tokens across tenant scopes',async()=>{
  const hidden=await withTenant(tenantA.id,()=>prisma.contactConfirmationToken.findUnique({where:{tokenHash:confirmationHash}}));
  expect(hidden).toBeNull();
  const resolved=await withContactConfirmationToken(confirmationHash,async(token:any)=>token);
  expect(resolved).toMatchObject({tenantId:tenantB.id,contactId:contactB.id,confirmedAt:null});
 });
 it('resolves an API key tenant and hides every other tenant under its RLS context',async()=>{
  const found=await withApiKey(apiKeyHash,async()=>({own:await prisma.contact.findUnique({where:{id:contactB.id}}),foreign:await prisma.contact.findUnique({where:{id:contactA.id}})}));
  expect(found).toMatchObject({authorized:true,value:{own:{id:contactB.id},foreign:null}});
 });
 it('does not run a request callback for an expired API key',async()=>{
  await withTenant(tenantB.id,()=>prisma.apiKey.update({where:{keyHash:apiKeyHash},data:{expiresAt:new Date(Date.now()-1000)}}));
  let called=false;
  const result=await withApiKey(apiKeyHash,async()=>{called=true;return 'unexpected';});
  expect(called).toBe(false);expect(result).toEqual({authorized:false,value:null});
 });
 it('allows cross-tenant quota controls only inside the explicit platform-admin context',async()=>{
  const hidden=await withTenant(tenantA.id,()=>prisma.tenantSendingLimit.findUnique({where:{tenantId:tenantB.id}}));
  expect(hidden).toBeNull();
  const elevated=await withPlatformAdmin(()=>prisma.tenantSendingLimit.findUnique({where:{tenantId:tenantB.id}}));
  expect(elevated).toMatchObject({tenantId:tenantB.id,dailyLimit:321});
 });
 it('isolates billing subscription records by tenant',async()=>{
  expect(await withTenant(tenantA.id,()=>prisma.billingSubscription.findUnique({where:{id:billingB.id}}))).toBeNull();
  const own=await withTenant(tenantB.id,()=>prisma.billingSubscription.findUnique({where:{id:billingB.id}}));
  expect(own).toMatchObject({tenantId:tenantB.id,provider:'test',plan:'starter',status:'active'});
  const changed=await withTenant(tenantA.id,()=>prisma.billingSubscription.updateMany({where:{id:billingB.id},data:{status:'cancelled'}}));
  expect(changed.count).toBe(0);
 });
 it('invalidates only one workspace invitation for an account with multiple invitations',async()=>{
  const tokenIds=[randomUUID(),randomUUID()];
  try{
   await withTenant(tenantB.id,()=>prisma.oneTimeToken.createMany({data:[tenantA.id,tenantB.id].map((tenantId,index)=>({id:tokenIds[index],tenantId,userId:ownerB.id,purpose:'invite_member',tokenHash:createHash('sha256').update(tokenIds[index]).digest('hex'),expiresAt:new Date(Date.now()+60_000)}))}));
   const visible=await withTenant(tenantB.id,()=>prisma.oneTimeToken.count({where:{id:{in:tokenIds},usedAt:null}}));
   expect(visible).toBe(2);
   const invalidated=await withTenant(tenantB.id,()=>prisma.oneTimeToken.updateMany({where:{tenantId:tenantA.id,userId:ownerB.id,purpose:'invite_member',usedAt:null},data:{usedAt:new Date()}}));
   expect(invalidated.count).toBe(1);
   await expect(withTenant(tenantB.id,()=>prisma.oneTimeToken.findUniqueOrThrow({where:{id:tokenIds[0]}}))).resolves.toMatchObject({usedAt:expect.any(Date)});
   await expect(withTenant(tenantB.id,()=>prisma.oneTimeToken.findUniqueOrThrow({where:{id:tokenIds[1]}}))).resolves.toMatchObject({usedAt:null});
  }finally{await withTenant(tenantB.id,()=>prisma.oneTimeToken.deleteMany({where:{id:{in:tokenIds}}}));}
 });
 it('rejects stale member edits and revocation after promotion without crossing tenant scope',async()=>{
  const key={tenantId:tenantB.id,userId:unsharedUserB.id};
  const original=await withTenant(tenantB.id,()=>prisma.organizationMembership.findUniqueOrThrow({where:{tenantId_userId:key}}));
  try{
   // Two separate transactions reproduce the authorization/read-to-write window.
   await withTenant(tenantB.id,()=>prisma.organizationMembership.update({where:{tenantId_userId:key},data:{role:'ADMIN'}}));
   const where={...key,role:original.role,status:original.status};
   const staleEdit=await withTenant(tenantB.id,()=>prisma.organizationMembership.updateMany({where,data:{role:'MARKETER'}}));
   const staleRemoval=await withTenant(tenantB.id,()=>prisma.organizationMembership.updateMany({where,data:{status:'DISABLED'}}));
   expect(staleEdit.count).toBe(0);expect(staleRemoval.count).toBe(0);
   const foreignRemoval=await withTenant(tenantA.id,()=>prisma.organizationMembership.updateMany({where:{...key,role:'ADMIN',status:'ACTIVE'},data:{status:'DISABLED'}}));
   expect(foreignRemoval.count).toBe(0);
   await expect(withTenant(tenantB.id,()=>prisma.organizationMembership.findUniqueOrThrow({where:{tenantId_userId:key}}))).resolves.toMatchObject({role:'ADMIN',status:'ACTIVE'});
  }finally{
   await withTenant(tenantB.id,()=>prisma.organizationMembership.update({where:{tenantId_userId:key},data:{role:original.role,status:original.status}}));
  }
 });
 it('keeps the platform quota ledger visible inside tenant-scoped transactions',async()=>{
  const usageDate=new Date('2099-01-01T00:00:00.000Z');
  await withPlatformAdmin(()=>prisma.platformDailyUsage.deleteMany({where:{usageDate}}));
  try{
   await withPlatformAdmin(()=>prisma.platformDailyUsage.create({data:{usageDate,reservedCount:7}}));
   const found=await withTenant(tenantA.id,()=>prisma.platformDailyUsage.findUnique({where:{usageDate}}));
   expect(found?.reservedCount).toBe(7);
  }finally{await withPlatformAdmin(()=>prisma.platformDailyUsage.deleteMany({where:{usageDate}}));}
 });
 it('restricts platform queue health history to platform admins and trusted worker writes',async()=>{
  const checkedAt=new Date('2099-01-02T00:00:00.000Z');
  const snapshot={checkedAt,queues:[{name:'repus-email-sending',status:'available',counts:{waiting:1,active:0,delayed:0,failed:0}}],failedJobCount:0,healthCheckFailures:0};
  let row:any;
  try{
   row=await withTrustedWorker(()=>prisma.platformQueueHealthSample.create({data:snapshot}));
   expect(await withTenant(tenantA.id,()=>prisma.platformQueueHealthSample.findUnique({where:{id:row.id}}))).toBeNull();
   await expect(withTenant(tenantA.id,()=>prisma.platformQueueHealthSample.create({data:{...snapshot,checkedAt:new Date('2099-01-03T00:00:00.000Z')}}))).rejects.toThrow();
   const admin=await withPlatformAdmin(()=>prisma.platformQueueHealthSample.findUnique({where:{id:row.id}}));
   expect(admin).toMatchObject({id:row.id,failedJobCount:0,healthCheckFailures:0});
  }finally{if(row)await withTrustedWorker(()=>prisma.platformQueueHealthSample.deleteMany({where:{id:row.id}}));}
 });
});

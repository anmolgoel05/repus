import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
vi.mock('bullmq',()=>({Queue:class{add=vi.fn()}}));
vi.mock('ioredis',()=>({default:class{}}));
vi.mock('./send-interrupts',()=>({publishSendInterrupt:vi.fn().mockResolvedValue(1)}));
const databaseUrl=process.env.RLS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('campaign cancellation with PostgreSQL quota reservations',()=>{
 let database:typeof import('@repus/database'),service:import('./campaigns').CampaignsService;
 let tenantId:string,campaignId:string,baseline=0,platformExisted=false;
 const day=new Date(new Date().toISOString().slice(0,10));
 const oldUrl=process.env.DATABASE_URL;
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl!;database=await import('@repus/database');
  const tenant=await database.withPlatformAdmin(()=>database.prisma.tenant.create({data:{name:'Cancellation regression',slug:`cancel-${randomUUID()}`}}));tenantId=tenant.id;
  await database.withTenant(tenantId,async()=>{
   await database.prisma.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
   const contact=await database.prisma.contact.create({data:{tenantId,email:'cancel@example.test',normalizedEmail:'cancel@example.test'}});
   const campaign=await database.prisma.campaign.create({data:{tenantId,name:'Cancellation regression',status:'SCHEDULED',scheduledAt:new Date(Date.now()+86400000),quotaDate:day}});campaignId=campaign.id;
   await database.prisma.campaignRecipient.create({data:{tenantId,campaignId,contactId:contact.id,email:contact.email,status:'PENDING',quotaDate:day,quotaReserved:true}});
   await database.prisma.dailyUsage.create({data:{tenantId,usageDate:day,reservedCount:1}});
   const existing=await database.prisma.platformDailyUsage.findUnique({where:{usageDate:day}});baseline=existing?.reservedCount??0;platformExisted=Boolean(existing);
   await database.prisma.platformDailyUsage.upsert({where:{usageDate:day},create:{usageDate:day,reservedCount:1},update:{reservedCount:{increment:1}}});
  });
  const {CampaignsService}=await import('./campaigns');service=new CampaignsService({authenticate:async()=>({tenantId,role:'OWNER'})} as any);
 });
 afterAll(async()=>{
  if(tenantId){
   await database.withTenant(tenantId,async()=>{
    await database.prisma.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
    const count=await database.prisma.campaignRecipient.count({where:{tenantId,quotaReserved:true}});
    if(count)await database.prisma.platformDailyUsage.updateMany({where:{usageDate:day,reservedCount:{gte:count}},data:{reservedCount:{decrement:count}}});
    await database.prisma.campaignRecipient.deleteMany({where:{tenantId}});
    if(!platformExisted)await database.prisma.platformDailyUsage.deleteMany({where:{usageDate:day,reservedCount:0,sentCount:0}});
   });
   await database.withPlatformAdmin(()=>database.prisma.tenant.delete({where:{id:tenantId}}));
  }
  if(database)await database.prisma.$disconnect();
  if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;
 });
 it('cancels the scheduled snapshot and releases each reserved quota exactly once',async()=>{
  const request={cookies:{repus_session:'test-session'}} as any;
  await database.withTenant(tenantId,()=>service.cancel(request,campaignId));
  await database.withTenant(tenantId,async()=>{
   expect(await database.prisma.campaign.findUnique({where:{id:campaignId},select:{status:true}})).toEqual({status:'CANCELLED'});
   expect(await database.prisma.campaignRecipient.findFirst({where:{campaignId},select:{status:true,quotaReserved:true}})).toEqual({status:'SUPPRESSED',quotaReserved:false});
   expect((await database.prisma.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId,usageDate:day}}}))?.reservedCount).toBe(0);
   expect((await database.prisma.platformDailyUsage.findUnique({where:{usageDate:day}}))?.reservedCount).toBe(baseline);
  });
  await expect(database.withTenant(tenantId,()=>service.cancel(request,campaignId))).rejects.toThrow('can no longer be cancelled');
 });
});

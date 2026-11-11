import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
vi.mock('bullmq',()=>({Queue:class{add=vi.fn()}}));
vi.mock('ioredis',()=>({default:class{}}));
const databaseUrl=process.env.RLS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('concurrent campaign quota reservations in PostgreSQL',()=>{
 let database:typeof import('@repus/database'),service:import('./campaigns').CampaignsService,tenantId:string;
 let baseline=0,platformExisted=false;
 const day=new Date('2099-06-07T00:00:00Z'),nextDay=new Date('2099-06-08T00:00:00Z');
 const oldUrl=process.env.DATABASE_URL,oldZone=process.env.PLATFORM_TIMEZONE;
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl!;process.env.PLATFORM_TIMEZONE='UTC';database=await import('@repus/database');
  tenantId=(await database.withPlatformAdmin(()=>database.prisma.tenant.create({data:{name:'Quota contention regression',slug:`quota-contention-${randomUUID()}`}}))).id;
  await database.withTenant(tenantId,async()=>{
   await database.prisma.tenantSendingLimit.create({data:{tenantId,dailyLimit:2,monthlyLimit:100,enabled:true}});
   const existing=await database.prisma.platformDailyUsage.findUnique({where:{usageDate:day}});baseline=existing?.reservedCount??0;platformExisted=Boolean(existing);
  });
  const {CampaignsService}=await import('./campaigns');service=new CampaignsService({} as any);
 });
 afterAll(async()=>{
  if(tenantId){
   await database.withTenant(tenantId,async()=>{
    await database.prisma.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
    const usage=await database.prisma.dailyUsage.findMany({where:{tenantId}});
    for(const row of usage)if(row.reservedCount)await database.prisma.platformDailyUsage.updateMany({where:{usageDate:row.usageDate,reservedCount:{gte:row.reservedCount}},data:{reservedCount:{decrement:row.reservedCount}}});
    if(!platformExisted)await database.prisma.platformDailyUsage.deleteMany({where:{usageDate:day,reservedCount:0,sentCount:0}});
   });
   await database.withPlatformAdmin(()=>database.prisma.tenant.delete({where:{id:tenantId}}));
  }
  if(database)await database.prisma.$disconnect();
  if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;
  if(oldZone===undefined)delete process.env.PLATFORM_TIMEZONE;else process.env.PLATFORM_TIMEZONE=oldZone;
 });
 it('allows only the available slots when eight requests race for two daily slots',async()=>{
  const results=await Promise.allSettled(Array.from({length:8},()=>database.withTenant(tenantId,()=>(service as any).reserve(tenantId,1,day),{maxWait:10000,timeout:15000})));
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(2);
  for(const result of results)if(result.status==='rejected')expect(result.reason.message).toContain("today's email sending limit");
  await database.withTenant(tenantId,async()=>{
   expect((await database.prisma.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId,usageDate:day}}}))?.reservedCount).toBe(2);
   expect((await database.prisma.platformDailyUsage.findUnique({where:{usageDate:day}}))?.reservedCount).toBe(baseline+2);
  });
 });
 it('reports monthly exhaustion on a different day and rolls back empty reservation rows',async()=>{
  await database.withTenant(tenantId,()=>database.prisma.tenantSendingLimit.update({where:{tenantId},data:{dailyLimit:100,monthlyLimit:2}}));
  await expect(database.withTenant(tenantId,()=>(service as any).reserve(tenantId,1,nextDay))).rejects.toThrow('monthly');
  expect(await database.withTenant(tenantId,()=>database.prisma.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId,usageDate:nextDay}}}))).toBeNull();
 });
});

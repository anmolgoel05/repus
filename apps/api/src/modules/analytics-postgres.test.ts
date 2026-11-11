import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {localDateKey,localMidnight} from './analytics-time';

const databaseUrl=process.env.RLS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('analytics with PostgreSQL tenant policies',()=>{
 let database:typeof import('@repus/database'),service:import('./analytics').AnalyticsService;
 let tenantId:string,foreignTenantId:string,campaignId:string;
 const oldUrl=process.env.DATABASE_URL;
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl!;
  database=await import('@repus/database');
  const tenant=await database.withPlatformAdmin(()=>database.prisma.tenant.create({data:{name:'Analytics regression',slug:`analytics-${randomUUID()}`,timezone:'America/New_York'}}));
  tenantId=tenant.id;
  foreignTenantId=(await database.withPlatformAdmin(()=>database.prisma.tenant.create({data:{name:'Other analytics workspace',slug:`foreign-analytics-${randomUUID()}`}}))).id;
  await database.withTenant(foreignTenantId,()=>database.prisma.contact.create({data:{tenantId:foreignTenantId,email:'foreign-growth@example.test',normalizedEmail:'foreign-growth@example.test',status:'SUBSCRIBED',consentAt:new Date(),consentSource:'Tenant isolation regression'}}));
  await database.withTenant(tenantId,async()=>{
   const contact=await database.prisma.contact.create({data:{tenantId,email:'analytics@example.test',normalizedEmail:'analytics@example.test',status:'SUBSCRIBED',consentAt:new Date(),consentSource:'PostgreSQL regression'}});
   const campaign=await database.prisma.campaign.create({data:{tenantId,name:'Analytics regression',status:'COMPLETED'}});
   campaignId=campaign.id;
   await database.prisma.auditLog.create({data:{tenantId,entityType:'campaign',entityId:campaignId,action:'campaign.auto_paused.reputation_threshold',metadata:{reason:'bounce_rate',internal:'fixture'}}});
   const recipient=await database.prisma.campaignRecipient.create({data:{tenantId,campaignId:campaign.id,contactId:contact.id,email:contact.email,status:'SENT',sentAt:new Date(),quotaDate:new Date(new Date().toISOString().slice(0,10)),quotaReserved:false}});
   await database.prisma.emailEvent.createMany({data:[
    {tenantId,recipientId:recipient.id,eventType:'delivered',eventData:{}},
    {tenantId,recipientId:recipient.id,eventType:'delivered',eventData:{}},
    {tenantId,recipientId:recipient.id,eventType:'rendering_failure',eventData:{}},
    {tenantId,recipientId:recipient.id,eventType:'open',eventData:{unique:true}},
    {tenantId,recipientId:recipient.id,eventType:'open',eventData:{unique:false}},
    {tenantId,recipientId:recipient.id,eventType:'click',eventData:{unique:true}},
   ]});
  });
  const {AnalyticsService}=await import('./analytics');
  service=new AnalyticsService({authenticate:async()=>({tenantId})} as any);
 });
 afterAll(async()=>{
  if(tenantId){
   await database.withTenant(tenantId,()=>database.prisma.campaignRecipient.deleteMany({where:{tenantId}}));
   await database.withPlatformAdmin(()=>database.prisma.tenant.delete({where:{id:tenantId}}));
  }
  if(foreignTenantId)await database.withPlatformAdmin(()=>database.prisma.tenant.delete({where:{id:foreignTenantId}}));
  if(database)await database.prisma.$disconnect();
  if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;
 });
 it('aggregates tenant-local days and preserves total versus unique engagement',async()=>{
  const request={cookies:{repus_session:'test-session'}} as any;
  const overview=await database.withTenant(tenantId,()=>service.overview(request));
  expect(overview).toMatchObject({contacts:1,activeSubscribers:1,campaigns:1,sentToday:1,delivered:1,totalOpens:2,uniqueOpens:1,totalClicks:1,uniqueClicks:1,uniqueOpenRate:100,uniqueClickRate:100});
  expect(overview.accepted).toBe(1);
  expect(overview.deliveryRate).toBe(100);
  const {CampaignReportsService}=await import('./campaign-reports');
  const reports=new CampaignReportsService({authenticate:async()=>({tenantId})} as any);
  const stats=await database.withTenant(tenantId,()=>reports.stats(request,campaignId));
  expect(stats).toMatchObject({accepted:1,delivered:1,deliveryRate:100});
  expect(stats.lastReputationPause).toEqual({reason:'bounce_rate',occurredAt:expect.any(Date)});
  await expect(database.withTenant(tenantId,()=>reports.events(request,campaignId,'1','25','delivered'))).resolves.toMatchObject({total:2});
  await expect(database.withTenant(tenantId,()=>reports.events(request,campaignId,'1','25','rendering_failure'))).resolves.toMatchObject({total:1});
  await database.withTenant(tenantId,async()=>{
   const original=await reports.recipients(request,campaignId);
   expect(original.items).toMatchObject([{status:'SENT',failureType:null}]);
   const id=original.items[0].id;
   await database.prisma.campaignRecipient.update({where:{id},data:{status:'FAILED'}});
   try{
    const failures=await reports.recipients(request,campaignId,'1','25','FAILED');
    expect(failures.items).toMatchObject([{id,status:'FAILED',failureType:'rendering_failure'}]);
    expect(failures.items[0]).not.toHaveProperty('events');
   }finally{
    await database.prisma.campaignRecipient.update({where:{id},data:{status:'SENT'}});
   }
  });
  expect(overview.contactGrowth).toHaveLength(14);
  expect(overview.contactGrowth.at(-1)?.added).toBe(1);
  const daily=await database.withTenant(tenantId,()=>service.daily(request));
  expect(daily).toHaveLength(14);
  expect(daily.at(-1)).toMatchObject({sent:1,delivered:1,opens:2,uniqueOpens:1,clicks:1,uniqueClicks:1});
 });
 it('groups new contacts at workspace midnight and excludes deleted contacts',async()=>{
  const midnight=localMidnight(localDateKey(new Date(),'America/New_York'),'America/New_York');
  await database.withTenant(tenantId,async()=>{
   for(const [index,date] of [new Date(midnight.getTime()-1),midnight,midnight,new Date(Date.now()+86400000)].entries())await database.prisma.contact.create({data:{tenantId,email:`growth-${index}@example.test`,normalizedEmail:`growth-${index}@example.test`,createdAt:date,...(index===2?{deletedAt:new Date()}:{}),status:'SUBSCRIBED',consentAt:date,consentSource:'Growth regression'}});
  });
  const overview=await database.withTenant(tenantId,()=>service.overview({cookies:{}} as any));
  expect(overview.contactGrowth.at(-1)?.added).toBe(2);
  expect(overview.contactGrowth.at(-2)?.added).toBe(1);
  expect(overview.contactGrowth.reduce((sum,day)=>sum+day.added,0)).toBe(3);
 });
});

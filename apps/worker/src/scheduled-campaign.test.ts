import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {queueDueCampaign} from './scheduled-campaign';
import {rebaseRecipientQuota} from './recipient-quota';

describe.skipIf(!process.env.TEST_DATABASE_URL)('scheduled campaign quota rebase (PostgreSQL)',()=>{
 let database:typeof import('@repus/database');

 beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL',process.env.TEST_DATABASE_URL!);
  vi.stubEnv('PLATFORM_TIMEZONE','UTC');
  vi.stubEnv('PLATFORM_DAILY_SEND_LIMIT','10000000');
  vi.stubEnv('PLATFORM_MONTHLY_SEND_LIMIT','10000000');
  database=await import('@repus/database');
 });

 afterAll(async()=>{
  await database?.prisma.$disconnect();
  vi.unstubAllEnvs();
 });

 it('blocks a full month, rebases the scheduled campaign and moves its active reservation at send time',async()=>{
  const {prisma,withTenant}=database;
  const tenantId=randomUUID();
  const rollback=new Error('Rollback synthetic scheduled campaign fixtures');
  // The request-scoped Prisma proxy keeps nested quota operations in this transaction.
  // The development scheduler cannot see this campaign and compete for its reservation.
  await expect(withTenant(tenantId,async()=>{
   await prisma.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
   const now=new Date();
   const quotaDay=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
   const priorDay=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));
   const nextDay=new Date(quotaDay.getTime()+86_400_000);
   const platformReserved=async(usageDate:Date)=>(await prisma.platformDailyUsage.findUnique({where:{usageDate}}))?.reservedCount??0;
   const tenantReserved=async(usageDate:Date)=>(await prisma.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId,usageDate}}}))?.reservedCount;
   const oldBaseline=await platformReserved(priorDay);
   const newBaseline=await platformReserved(quotaDay);
   const nextBaseline=await platformReserved(nextDay);
   await prisma.tenant.create({data:{id:tenantId,name:'Quota rebase test',slug:`quota-rebase-${tenantId}`}});
   const email=`quota-${tenantId}@example.test`;
   const contact=await prisma.contact.create({data:{tenantId,email,normalizedEmail:email,status:'SUBSCRIBED',consentSource:'integration test',consentAt:now}});
   await prisma.tenantSendingLimit.create({data:{tenantId,dailyLimit:100,monthlyLimit:0,contactLimit:100}});
   const campaign=await prisma.campaign.create({data:{tenantId,name:'Delayed schedule',status:'SCHEDULED',scheduledAt:new Date(now.getTime()-60_000),quotaDate:priorDay}});
   const recipient=await prisma.campaignRecipient.create({data:{tenantId,campaignId:campaign.id,contactId:contact.id,email,status:'PENDING',quotaReserved:true,quotaDate:priorDay}});
   await prisma.dailyUsage.create({data:{tenantId,usageDate:priorDay,reservedCount:1}});
   await prisma.platformDailyUsage.upsert({where:{usageDate:priorDay},create:{usageDate:priorDay,reservedCount:1},update:{reservedCount:{increment:1}}});

   expect(await queueDueCampaign(prisma,campaign.id)).toMatchObject({ready:false,reason:'quota_unavailable'});
   expect(await tenantReserved(priorDay)).toBe(1);
   expect(await prisma.campaign.findUnique({where:{id:campaign.id}})).toMatchObject({status:'SCHEDULED'});

   await prisma.tenantSendingLimit.update({where:{tenantId},data:{monthlyLimit:100}});
   expect(await queueDueCampaign(prisma,campaign.id)).toEqual({ready:true,queuedCount:1});
   expect(await tenantReserved(priorDay)).toBe(0);
   expect(await tenantReserved(quotaDay)).toBe(1);
   expect(await platformReserved(priorDay)).toBe(oldBaseline);
   expect(await platformReserved(quotaDay)).toBe(newBaseline+1);
   expect(await prisma.campaign.findUnique({where:{id:campaign.id}})).toMatchObject({status:'QUEUED',quotaDate:quotaDay});
   expect(await prisma.campaignRecipient.findUnique({where:{id:recipient.id}})).toMatchObject({status:'QUEUED',quotaReserved:true,quotaDate:quotaDay});
   expect(await queueDueCampaign(prisma,campaign.id)).toMatchObject({ready:false});

   await prisma.campaignRecipient.update({where:{id:recipient.id},data:{status:'SENDING'}});
   await expect(rebaseRecipientQuota(prisma,recipient.id,new Date(nextDay.getTime()+12*60*60_000))).resolves.toBe(true);
   expect(await prisma.campaignRecipient.findUnique({where:{id:recipient.id}})).toMatchObject({status:'SENDING',quotaReserved:true,quotaDate:nextDay});
   expect(await tenantReserved(quotaDay)).toBe(0);
   expect(await tenantReserved(nextDay)).toBe(1);
   expect(await platformReserved(nextDay)).toBe(nextBaseline+1);
   throw rollback;
  },{timeout:20000})).rejects.toBe(rollback);
  expect(await prisma.tenant.findUnique({where:{id:tenantId}})).toBeNull();
 });
});

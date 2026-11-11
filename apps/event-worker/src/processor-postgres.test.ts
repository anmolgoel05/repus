import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';

describe.skipIf(!process.env.TEST_DATABASE_URL)('concurrent provider events (PostgreSQL)',()=>{
 const previousUrl=process.env.DATABASE_URL,previousTimezone=process.env.PLATFORM_TIMEZONE;
 const nonce=randomUUID(),prefix='provider-concurrency-'+nonce;
 const acceptedAt=new Date('2037-05-10T12:00:00.000Z'),quotaDay=new Date('2037-05-10T00:00:00.000Z');
 const size=32;
 let prisma:any,tenantId:string,campaignId:string,processor:any,baseline:any;
 const recipients:Array<{id:string;email:string}>=[];
 beforeAll(async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL!;process.env.PLATFORM_TIMEZONE='UTC';
  vi.stubEnv('REPUS_REPUTATION_MINIMUM_SAMPLE','20');
  vi.stubEnv('REPUS_MAX_BOUNCE_RATE','0.05');
  vi.stubEnv('REPUS_MAX_COMPLAINT_RATE','0.001');
  prisma=(await import('@repus/database')).createPrismaClient();
  processor=await import('./processor');
  tenantId=(await prisma.tenant.create({data:{name:'Concurrent events regression',slug:prefix}})).id;
  campaignId=(await prisma.campaign.create({data:{tenantId,name:'Out of order provider events',status:'SENDING',quotaDate:quotaDay}})).id;
  baseline=await prisma.platformDailyUsage.findUnique({where:{usageDate:quotaDay}});
  await prisma.dailyUsage.create({data:{tenantId,usageDate:quotaDay,reservedCount:size}});
  await prisma.platformDailyUsage.upsert({where:{usageDate:quotaDay},create:{usageDate:quotaDay,reservedCount:size},update:{reservedCount:{increment:size}}});
  for(let index=0;index<size;index++){
   const email=`provider-${index}-${nonce}@example.test`;
   const contact=await prisma.contact.create({data:{tenantId,email,normalizedEmail:email,status:'SUBSCRIBED',consentSource:'Synthetic concurrency regression',consentAt:acceptedAt}});
   const recipient=await prisma.campaignRecipient.create({data:{tenantId,campaignId,contactId:contact.id,email,status:'SENDING',quotaDate:quotaDay,quotaReserved:true,sendStartedAt:acceptedAt}});
   recipients.push({id:recipient.id,email});
  }
 });
 afterAll(async()=>{
  if(prisma&&tenantId){
   // Subtract only this fixture's ledger contribution; never reset shared counters.
   const usages=await prisma.dailyUsage.findMany({where:{tenantId}});
   for(const usage of usages)await prisma.platformDailyUsage.updateMany({where:{usageDate:usage.usageDate,sentCount:{gte:usage.sentCount},reservedCount:{gte:usage.reservedCount}},data:{sentCount:{decrement:usage.sentCount},reservedCount:{decrement:usage.reservedCount}}});
   await prisma.webhookDelivery.deleteMany({where:{providerEventId:{startsWith:prefix}}});
   await prisma.campaignRecipient.deleteMany({where:{tenantId}});
   await prisma.tenant.delete({where:{id:tenantId}});
   if(!baseline)await prisma.platformDailyUsage.deleteMany({where:{usageDate:quotaDay,sentCount:0,reservedCount:0}});
  }
  await processor?.closeProviderEventDatabase();await prisma?.$disconnect();
  if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
  if(previousTimezone===undefined)delete process.env.PLATFORM_TIMEZONE;else process.env.PLATFORM_TIMEZONE=previousTimezone;
  vi.unstubAllEnvs();
 });
 it('deduplicates concurrent events, preserves quotas and requests an interrupt after a committed reputation pause',async()=>{
  const events:any[]=[];
  for(const [index,recipient] of recipients.entries()){
   const mail={messageId:`concurrency-${recipient.id}`,timestamp:acceptedAt.toISOString(),tags:{tenant_id:[tenantId],recipient_id:[recipient.id]}};
   const add=(type:string,suffix:string,extra={})=>events.push({providerEventId:`${prefix}-${index}-${suffix}`,provider:'ses',eventType:type,payload:{mail,...extra}});
   add('Send','accepted');
   if(index===recipients.length-1)add('Reject','reject');
   else if(index===recipients.length-2)add('Rendering Failure','rendering-failure',{failure:{errorMessage:'Synthetic rendering error'}});
   else add('Delivery','delivery',{delivery:{timestamp:acceptedAt.toISOString()}});
   add('Open','open-1');add('Open','open-2');
   add('Click','click-1',{click:{link:'https://example.test/offer'}});add('Click','click-2',{click:{link:'https://example.test/offer'}});
   if(index<4){add('Complaint','complaint');add('Bounce','bounce',{bounce:{bounceType:'Permanent'}});}
  }
  // Reverse order and submit each ID twice with overlapping workers, like SQS retries.
  const work=[...events].reverse().flatMap(event=>[event,event]);
  let cursor=0;
  const started=performance.now();
  await Promise.all(Array.from({length:8},async()=>{while(cursor<work.length)await processor.processProviderEvent(work[cursor++]);}));
  const elapsedMs=Math.round(performance.now()-started);
  expect(await prisma.emailEvent.count({where:{tenantId}})).toBe(200);
  expect(await prisma.emailEvent.count({where:{tenantId,eventType:'accepted'}})).toBe(size);
  expect(await prisma.emailEvent.count({where:{tenantId,eventType:'send'}})).toBe(0);
  for(const eventType of ['open','click']){
   expect(await prisma.emailEvent.count({where:{tenantId,eventType}})).toBe(64);
   expect(await prisma.emailEvent.count({where:{tenantId,eventType,eventData:{path:['unique'],equals:true}}})).toBe(size);
  }
  expect(await prisma.campaignRecipient.count({where:{tenantId,status:'COMPLAINED'}})).toBe(4);
  expect(await prisma.campaignRecipient.count({where:{tenantId,status:'DELIVERED'}})).toBe(26);
  expect(await prisma.emailEvent.count({where:{tenantId,eventType:'rendering_failure'}})).toBe(1);
  for(const failed of recipients.slice(-2)){
   const accepted=events.find(event=>event.eventType==='Send'&&event.payload.mail.tags.recipient_id[0]===failed.id);
   await expect(processor.processProviderEvent(accepted)).resolves.toEqual({duplicate:true});
   expect(await prisma.campaignRecipient.findUnique({where:{id:failed.id}})).toMatchObject({status:'FAILED'});
  }
  expect(await prisma.suppression.count({where:{tenantId,reason:'complaint'}})).toBe(4);
  const usage=await prisma.dailyUsage.findUnique({where:{tenantId_usageDate:{tenantId,usageDate:quotaDay}}});
  expect(usage).toMatchObject({sentCount:size,reservedCount:0});
  const platform=await prisma.platformDailyUsage.findUnique({where:{usageDate:quotaDay}});
  expect(platform.sentCount-(baseline?.sentCount??0)).toBe(size);
  expect(platform.reservedCount-(baseline?.reservedCount??0)).toBe(0);
  expect(await prisma.webhookDelivery.count({where:{providerEventId:{startsWith:prefix},status:'processed'}})).toBe(200);
  const delivered=recipients[4];
  const deliveredEvent=events.find(event=>event.eventType==='Delivery'&&event.payload.mail.tags.recipient_id[0]===delivered.id);
  await processor.processProviderEvent({...deliveredEvent,providerEventId:`${prefix}-late-reject`,eventType:'Reject'});
  expect(await prisma.campaignRecipient.findUnique({where:{id:delivered.id}})).toMatchObject({status:'DELIVERED'});
  await expect(processor.processProviderEvent({
   ...deliveredEvent,
   providerEventId:`${prefix}-mismatched-bounce`,
   eventType:'Bounce',
   payload:{...deliveredEvent.payload,mail:{...deliveredEvent.payload.mail,messageId:'wrong-provider-message'},bounce:{bounceType:'Permanent'}},
  })).rejects.toThrow('Provider message ID does not match');
  expect(await prisma.campaignRecipient.findUnique({where:{id:delivered.id}})).toMatchObject({status:'DELIVERED',providerMessageId:deliveredEvent.payload.mail.messageId});
  expect(await prisma.suppression.count({where:{tenantId,reason:'hard_bounce'}})).toBe(0);
  expect(await prisma.emailEvent.count({where:{tenantId,eventType:'accepted'}})).toBe(size);
  console.info(JSON.stringify({type:'provider_event_concurrency_regression',calls:work.length,distinctEvents:events.length,concurrency:8,elapsedMs}));
  // Keep one accepted recipient active to exercise a pause before the campaign drains.
  const affected=recipients[4],active=recipients[5];
  await prisma.campaign.update({where:{id:campaignId},data:{status:'SENDING',completedAt:null}});
  await prisma.campaignRecipient.update({where:{id:active.id},data:{status:'SENDING'}});
  const priorAudits=await prisma.auditLog.count({where:{tenantId,entityId:campaignId,action:'campaign.auto_paused.reputation_threshold'}});
  const interrupt=vi.fn(async(id:string)=>({
   status:(await prisma.campaign.findUniqueOrThrow({where:{id}})).status,
   auditCount:await prisma.auditLog.count({where:{tenantId,entityId:id,action:'campaign.auto_paused.reputation_threshold'}}),
  }));
  const complaint={providerEventId:`${prefix}-pause-check`,provider:'ses',eventType:'Complaint',payload:{
   mail:{messageId:`concurrency-${affected.id}`,timestamp:acceptedAt.toISOString(),tags:{tenant_id:[tenantId],recipient_id:[affected.id]}},complaint:{},
  }};
  await processor.processProviderEvent(complaint,interrupt);
  expect(interrupt).toHaveBeenCalledExactlyOnceWith(campaignId);
  await expect(interrupt.mock.results[0].value).resolves.toEqual({status:'PAUSED',auditCount:priorAudits+1});
  expect(await prisma.campaignRecipient.findUnique({where:{id:active.id}})).toMatchObject({status:'SENDING'});
  await expect(processor.processProviderEvent(complaint,interrupt)).resolves.toEqual({duplicate:true});
  expect(interrupt).toHaveBeenCalledOnce();
 },60000);
});

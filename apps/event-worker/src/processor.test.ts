import {beforeEach,describe,expect,it,vi} from 'vitest';
const database=vi.hoisted(()=>({
 prisma:{oneTimeToken:{updateMany:vi.fn().mockResolvedValue({count:1})},webhookDelivery:{findUnique:vi.fn(),upsert:vi.fn(),update:vi.fn()},campaignRecipient:{findFirst:vi.fn(),count:vi.fn()},campaign:{updateMany:vi.fn()},$transaction:vi.fn()},
 recordProviderAcceptance:vi.fn(),
}));
vi.mock('@repus/database',()=>({createPrismaClient:()=>database.prisma,recordProviderAcceptance:database.recordProviderAcceptance}));
import {eventName,finalizeCampaignIfDrained,isNonCampaignProviderEvent,processProviderEvent,providerAcceptedAt,providerEventImpliesAcceptance} from './processor';
describe('event normalization',()=>{
 it('keeps provider event labels distinct for analytics',()=>{
  expect(eventName('Send')).toBe('accepted');expect(eventName('send')).toBe('accepted');expect(providerEventImpliesAcceptance('accepted')).toBe(true);
  const map=(v:string)=>({Delivery:'delivered',Bounce:'bounce',Complaint:'complaint',Open:'open',Click:'click'}[v]??v.toLowerCase());
  expect(map('Delivery')).toBe('delivered');expect(map('Open')).toBe('open');expect(map('Click')).toBe('click');expect(map('Complaint')).toBe('complaint');
  expect(eventName('Delivery')).toBe('delivered');expect(eventName('Open')).toBe('open');expect(eventName('Click')).toBe('click');expect(eventName('Complaint')).toBe('complaint');
 });
 it('does not try to match transactional confirmation events to marketing recipients',()=>{
  expect(isNonCampaignProviderEvent({kind:['subscription_confirmation']})).toBe(true);
  expect(isNonCampaignProviderEvent({kind:'subscription_confirmation'})).toBe(true);
  expect(isNonCampaignProviderEvent({kind:['test']})).toBe(true);
  expect(isNonCampaignProviderEvent({kind:['account']})).toBe(true);
  expect(isNonCampaignProviderEvent({kind:['campaign']})).toBe(false);
 });
});
describe('provider acceptance recovery signals',()=>{
 it('uses authenticated SES campaign events as evidence of acceptance',()=>{
  expect(providerEventImpliesAcceptance('delivered')).toBe(true);expect(providerEventImpliesAcceptance('bounce')).toBe(true);expect(providerEventImpliesAcceptance('click')).toBe(true);expect(providerEventImpliesAcceptance('reject')).toBe(true);
 });
 it('uses the SES mail timestamp and falls back safely for malformed payload timestamps',()=>{
  expect(providerAcceptedAt({mail:{timestamp:'2026-10-30T08:00:00.000Z'}})).toEqual(new Date('2026-10-30T08:00:00.000Z'));
  const fallback=new Date('2026-10-30T09:00:00.000Z');expect(providerAcceptedAt({mail:{timestamp:'not-a-time'}},fallback)).toBe(fallback);
 });
});
describe('processed event recovery',()=>{
 beforeEach(()=>{vi.clearAllMocks();database.prisma.webhookDelivery.findUnique.mockResolvedValue({status:'processed'});database.prisma.campaignRecipient.findFirst.mockResolvedValue({id:'recipient-a'});database.prisma.$transaction.mockImplementation((fn:any)=>fn({campaignRecipient:{updateMany:vi.fn().mockResolvedValue({count:1})}}));database.recordProviderAcceptance.mockResolvedValue({recorded:true});});
 it('uses a duplicate authenticated SES event to reconcile missing acceptance state without replaying the event',async()=>{
  const result=await processProviderEvent({providerEventId:'event-a',provider:'ses',eventType:'Delivery',payload:{mail:{messageId:'message-a',timestamp:'2026-10-30T08:00:00.000Z',tags:{tenant_id:['tenant-a'],recipient_id:['recipient-a']}}}});
  expect(result).toEqual({duplicate:true});expect(database.recordProviderAcceptance).toHaveBeenCalledWith(expect.anything(),{recipientId:'recipient-a',messageId:'message-a',acceptedAt:new Date('2026-10-30T08:00:00.000Z'),source:'provider_event'});
  expect(database.prisma.webhookDelivery.upsert).not.toHaveBeenCalled();
 });
 it('reconciles an uncertain account email without matching or charging a campaign recipient',async()=>{
  await processProviderEvent({providerEventId:'account-event',provider:'ses',eventType:'Send',payload:{mail:{messageId:'account-message',tags:{kind:['account'],tenant_id:['tenant-a'],account_token_id:['token-a']}}}});
  expect(database.prisma.oneTimeToken.updateMany).toHaveBeenCalledWith({where:{id:'token-a',tenantId:'tenant-a',deliveryStatus:{in:['SENDING','UNCERTAIN']},OR:[{deliveryMessageId:null},{deliveryMessageId:'account-message'}]},data:expect.objectContaining({deliveryStatus:'SENT',deliveryMessageId:'account-message',tokenEncrypted:null})});
  expect(database.prisma.campaignRecipient.findFirst).not.toHaveBeenCalled();expect(database.recordProviderAcceptance).not.toHaveBeenCalled();
 });
});
describe('out-of-order delivery outcomes',()=>{
 const tx={
  $executeRaw:vi.fn(),
  campaignRecipient:{findFirst:vi.fn(),update:vi.fn().mockResolvedValue({}),updateMany:vi.fn().mockResolvedValue({count:1}),count:vi.fn().mockResolvedValue(0)},
  emailEvent:{createMany:vi.fn().mockResolvedValue({count:1})},
  contact:{updateMany:vi.fn().mockResolvedValue({count:1})},
  suppression:{findUnique:vi.fn().mockResolvedValue(null),upsert:vi.fn().mockResolvedValue({})},
  campaign:{updateMany:vi.fn().mockResolvedValue({count:0})},
  auditLog:{create:vi.fn()},
 };
 beforeEach(()=>{
  vi.clearAllMocks();
  tx.suppression.findUnique.mockResolvedValue(null);
  database.prisma.webhookDelivery.findUnique.mockResolvedValue(null);
  database.prisma.webhookDelivery.upsert.mockResolvedValue({id:'webhook-a'});
  database.prisma.webhookDelivery.update.mockResolvedValue({});
  database.prisma.campaignRecipient.findFirst.mockResolvedValue({id:'recipient-a',tenantId:'tenant-a',campaignId:'campaign-a',contactId:'contact-a',email:'reader@example.com',contact:{id:'contact-a',deletedAt:null,normalizedEmail:'reader@example.com'}});
  database.prisma.campaignRecipient.count.mockResolvedValue(0);
  database.prisma.$transaction.mockImplementation((fn:any)=>fn(tx));
  database.recordProviderAcceptance.mockResolvedValue({recorded:true});
 });
 it('does not let a late delivery event replace a hard bounce or complaint',async()=>{
  await processProviderEvent({providerEventId:'delivery-a',provider:'ses',eventType:'Delivery',payload:{mail:{messageId:'message-a',tags:{tenant_id:['tenant-a'],recipient_id:['recipient-a']}},delivery:{timestamp:'2026-10-31T08:00:00.000Z'}}});
  expect(tx.campaignRecipient.updateMany).toHaveBeenCalledWith({where:{id:'recipient-a',status:{notIn:['BOUNCED','COMPLAINED']}},data:{status:'DELIVERED',deliveredAt:new Date('2026-10-31T08:00:00.000Z')}});
 });
 it('does not downgrade complaint suppression when a permanent bounce arrives later',async()=>{
  tx.suppression.findUnique.mockResolvedValue({reason:'complaint'});
  await processProviderEvent({providerEventId:'bounce-a',provider:'ses',eventType:'Bounce',payload:{mail:{messageId:'message-a',tags:{tenant_id:['tenant-a'],recipient_id:['recipient-a']}},bounce:{bounceType:'Permanent'}}});
  expect(tx.campaignRecipient.updateMany).toHaveBeenCalledWith({where:{id:'recipient-a',status:{not:'COMPLAINED'}},data:{status:'BOUNCED'}});
  expect(tx.contact.updateMany).toHaveBeenCalledWith({where:{id:'contact-a',tenantId:'tenant-a',normalizedEmail:'reader@example.com',deletedAt:null,status:{notIn:['COMPLAINED','UNSUBSCRIBED']}},data:{status:'BOUNCED'}});
  expect(tx.suppression.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{}}));
 });
 it('promotes unsubscribe suppression to a permanent bounce',async()=>{
  tx.suppression.findUnique.mockResolvedValue({reason:'unsubscribe'});
  await processProviderEvent({providerEventId:'bounce-b',provider:'ses',eventType:'Bounce',payload:{mail:{messageId:'message-a',tags:{tenant_id:['tenant-a'],recipient_id:['recipient-a']}},bounce:{bounceType:'Permanent'}}});
  expect(tx.suppression.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{reason:'hard_bounce',source:'ses'}}));
 });
 it('keeps complaint contact updates scoped to contacts that remain undeleted',async()=>{
  tx.suppression.findUnique.mockResolvedValue({reason:'unsubscribe'});
  await processProviderEvent({providerEventId:'complaint-a',provider:'ses',eventType:'Complaint',payload:{mail:{messageId:'message-a',tags:{tenant_id:['tenant-a'],recipient_id:['recipient-a']}},complaint:{timestamp:'2026-10-31T08:00:00.000Z'}}});
  expect(tx.contact.updateMany).toHaveBeenCalledWith({where:{id:'contact-a',tenantId:'tenant-a',normalizedEmail:'reader@example.com',deletedAt:null},data:{status:'COMPLAINED'}});
  expect(tx.suppression.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{reason:'complaint',source:'ses'}}));
 });
 it('interrupts active sends only after a reputation pause has committed',async()=>{
  database.prisma.campaignRecipient.count.mockResolvedValueOnce(1).mockResolvedValueOnce(100_000).mockResolvedValueOnce(0).mockResolvedValueOnce(100_000);
  tx.campaign.updateMany.mockResolvedValueOnce({count:1});
  let committed=false;
  database.prisma.$transaction.mockImplementation(async(fn:any)=>{
   const result=await fn(tx);
   if(result===1)committed=true;
   return result;
  });
  const interrupt=vi.fn(async()=>committed);
  await processProviderEvent({providerEventId:'auto-pause',provider:'ses',eventType:'Complaint',payload:{mail:{messageId:'message-a',tags:{tenant_id:['tenant-a'],recipient_id:['recipient-a']}}}},interrupt);
  expect(interrupt).toHaveBeenCalledExactlyOnceWith('campaign-a');
  await expect(interrupt.mock.results[0].value).resolves.toBe(true);
  expect(database.prisma.campaignRecipient.count).toHaveBeenCalledWith({where:{campaignId:'campaign-a',sentAt:{not:null}}});
 });
 it.each([
  {eventType:'Bounce',details:{bounce:{bounceType:'Permanent'}},reason:'hard_bounce'},
  {eventType:'Complaint',details:{complaint:{}},reason:'complaint'},
 ])('binds a late $eventType to the sent address after the contact changes email',async({eventType,details,reason})=>{
  database.prisma.campaignRecipient.findFirst.mockResolvedValue({id:'recipient-a',tenantId:'tenant-a',campaignId:'campaign-a',contactId:'contact-a',email:'Old@Example.test',contact:{id:'contact-a',deletedAt:null,normalizedEmail:'new@example.test'}});
  await processProviderEvent({providerEventId:`late-${eventType}`,provider:'ses',eventType,payload:{mail:{messageId:'message-a',tags:{tenant_id:['tenant-a'],recipient_id:['recipient-a']}},...details}});
  expect(tx.suppression.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId_normalizedEmail:{tenantId:'tenant-a',normalizedEmail:'old@example.test'}},create:expect.objectContaining({normalizedEmail:'old@example.test',reason})}));
  expect(tx.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:'tenant-a',normalizedEmail:'old@example.test'})}));
 });
});
describe('campaign completion recovery',()=>{
 beforeEach(()=>{vi.clearAllMocks();});
 it('completes a campaign after the last uncertain recipient is reconciled',async()=>{
  database.prisma.campaignRecipient.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  await finalizeCampaignIfDrained('campaign-a');
  expect(database.prisma.campaign.updateMany).toHaveBeenCalledWith({where:{id:'campaign-a',status:{in:['QUEUED','SENDING','FAILED']}},data:expect.objectContaining({status:'COMPLETED',completedAt:expect.any(Date)})});
 });
 it('keeps a campaign active while other recipients remain queued or sending',async()=>{
  database.prisma.campaignRecipient.count.mockResolvedValueOnce(1);
  await finalizeCampaignIfDrained('campaign-a');
  expect(database.prisma.campaign.updateMany).not.toHaveBeenCalled();
 });
});



import {afterEach,describe,expect,it,vi} from 'vitest';
import {recordProviderAcceptance} from './provider-acceptance';

function mockTx({reserved=true,acceptedAt=null as Date|null}={}){
 return {
  $executeRaw:vi.fn().mockResolvedValue(1),
  campaignRecipient:{findUnique:vi.fn().mockResolvedValue({tenantId:'tenant-a',quotaReserved:reserved,providerAcceptedAt:acceptedAt,quotaDate:new Date('2026-10-30T00:00:00.000Z')}),updateMany:vi.fn().mockResolvedValue({count:1})},
  dailyUsage:{upsert:vi.fn().mockResolvedValue({}),updateMany:vi.fn().mockResolvedValue({count:1})},platformDailyUsage:{upsert:vi.fn().mockResolvedValue({}),updateMany:vi.fn().mockResolvedValue({count:1})},
  emailEvent:{createMany:vi.fn().mockResolvedValue({count:1})},
 };
}
describe('provider acceptance reconciliation',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('settles a reservation and records acceptance exactly once',async()=>{
  const tx=mockTx();const acceptedAt=new Date('2026-10-30T08:20:00.000Z');
  await expect(recordProviderAcceptance(tx as any,{recipientId:'recipient-a',messageId:'ses-message-a',acceptedAt})).resolves.toMatchObject({recorded:true,quotaDate:new Date('2026-10-30T00:00:00.000Z')});
  expect(tx.campaignRecipient.updateMany).toHaveBeenCalledWith({where:{id:'recipient-a',providerAcceptedAt:null},data:{providerAcceptedAt:acceptedAt,providerMessageId:'ses-message-a',sentAt:acceptedAt,quotaDate:new Date('2026-10-30T00:00:00.000Z'),quotaReserved:false,sendStartedAt:null}});
  expect(tx.dailyUsage.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{sentCount:{increment:1},reservedCount:{decrement:1}}}));
  expect(tx.platformDailyUsage.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{sentCount:{increment:1},reservedCount:{decrement:1}}}));
  expect(tx.emailEvent.createMany).toHaveBeenCalledWith({data:[{tenantId:'tenant-a',recipientId:'recipient-a',eventType:'accepted',eventKey:'accepted:recipient-a',occurredAt:acceptedAt,eventData:{providerMessageId:'ses-message-a',source:'worker_response'}}],skipDuplicates:true});
 });
 it('transfers a reservation if the provider accepted the message after the platform day changed',async()=>{
  vi.stubEnv('PLATFORM_TIMEZONE','UTC');
  const tx=mockTx();const acceptedAt=new Date('2026-10-31T00:00:02.000Z');
  await expect(recordProviderAcceptance(tx as any,{recipientId:'recipient-a',messageId:'ses-message-a',acceptedAt})).resolves.toMatchObject({recorded:true,quotaDate:new Date('2026-10-31T00:00:00.000Z')});
  expect(tx.dailyUsage.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',usageDate:new Date('2026-10-30T00:00:00.000Z'),reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}});
  expect(tx.dailyUsage.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId_usageDate:{tenantId:'tenant-a',usageDate:new Date('2026-10-31T00:00:00.000Z')}},create:{tenantId:'tenant-a',usageDate:new Date('2026-10-31T00:00:00.000Z'),sentCount:1},update:{sentCount:{increment:1}}}));
 });
 it('does not count duplicate event/worker acknowledgements twice',async()=>{
  const tx=mockTx({reserved:false,acceptedAt:new Date('2026-10-30T08:20:00.000Z')});
  await expect(recordProviderAcceptance(tx as any,{recipientId:'recipient-a',messageId:'ses-message-a',acceptedAt:new Date()})).resolves.toEqual({recorded:false});
  expect(tx.campaignRecipient.updateMany).not.toHaveBeenCalled();expect(tx.dailyUsage.upsert).not.toHaveBeenCalled();expect(tx.platformDailyUsage.upsert).not.toHaveBeenCalled();
  expect(tx.emailEvent.createMany).not.toHaveBeenCalled();
 });
 it('preserves an existing message ID on a legacy recipient without acceptance accounting',async()=>{
  const tx=mockTx();
  tx.campaignRecipient.findUnique.mockImplementation(async()=>({
   tenantId:'tenant-a',quotaReserved:true,providerAcceptedAt:null,
   quotaDate:new Date('2026-10-30T00:00:00.000Z'),providerMessageId:'existing-provider-message',
  }));
  await expect(recordProviderAcceptance(tx as any,{recipientId:'recipient-a',messageId:'different-message',acceptedAt:new Date()})).rejects.toThrow('Provider message ID does not match');
  expect(tx.campaignRecipient.updateMany).not.toHaveBeenCalled();
  expect(tx.dailyUsage.upsert).not.toHaveBeenCalled();
  expect(tx.platformDailyUsage.upsert).not.toHaveBeenCalled();
 });
 it('does not alter quota ledgers when another transaction wins the acceptance claim',async()=>{
  const tx=mockTx();tx.campaignRecipient.updateMany.mockResolvedValue({count:0});
  await expect(recordProviderAcceptance(tx as any,{recipientId:'recipient-a',messageId:'ses-message-a',acceptedAt:new Date()})).resolves.toEqual({recorded:false});
  expect(tx.dailyUsage.upsert).not.toHaveBeenCalled();expect(tx.platformDailyUsage.upsert).not.toHaveBeenCalled();
 });
});

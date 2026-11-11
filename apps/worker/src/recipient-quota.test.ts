import {afterEach,describe,expect,it,vi} from 'vitest';
import {rebaseRecipientQuota} from './recipient-quota';

function fixture({tenantSent=0,platformSent=0,recipientDay=new Date('2026-10-30T00:00:00.000Z')}={}){
 const tx={
  $executeRaw:vi.fn().mockResolvedValue(1),
  campaignRecipient:{findUnique:vi.fn().mockResolvedValue({tenantId:'tenant-a',quotaDate:recipientDay,quotaReserved:true,status:'SENDING'}),updateMany:vi.fn().mockResolvedValue({count:1})},
  tenant:{findUnique:vi.fn().mockResolvedValue({status:'active'})},
  tenantSendingLimit:{findUnique:vi.fn().mockResolvedValue({enabled:true,dailyLimit:10,monthlyLimit:100})},
  platformControl:{findUniqueOrThrow:vi.fn().mockResolvedValue({dailySendLimit:20,monthlySendLimit:200})},
  dailyUsage:{findUnique:vi.fn().mockImplementation(({where}:any)=>Promise.resolve(where.tenantId_usageDate.usageDate.toISOString().startsWith('2026-10-30')?{sentCount:0,reservedCount:1}:{sentCount:tenantSent,reservedCount:0})),aggregate:vi.fn().mockResolvedValue({_sum:{sentCount:0,reservedCount:0}}),updateMany:vi.fn().mockResolvedValue({count:1}),update:vi.fn().mockResolvedValue({})},
  platformDailyUsage:{upsert:vi.fn().mockResolvedValue({}),findUnique:vi.fn().mockImplementation(({where}:any)=>Promise.resolve(where.usageDate.toISOString().startsWith('2026-10-30')?{sentCount:0,reservedCount:1}:{sentCount:platformSent,reservedCount:0})),aggregate:vi.fn().mockResolvedValue({_sum:{sentCount:0,reservedCount:0}}),updateMany:vi.fn().mockResolvedValue({count:1}),update:vi.fn().mockResolvedValue({})},
 };
 const prisma={$transaction:vi.fn((fn:any)=>fn(tx))};
 return {tx,prisma};
}

describe('per-recipient quota day rebasing',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('moves one active recipient reservation to the actual platform-local day',async()=>{
  vi.stubEnv('PLATFORM_TIMEZONE','Asia/Kolkata');
  const {tx,prisma}=fixture();
  await expect(rebaseRecipientQuota(prisma as any,'recipient-a',new Date('2026-10-30T18:30:00.000Z'))).resolves.toBe(true);
  expect(tx.campaignRecipient.updateMany).toHaveBeenCalledWith({where:{id:'recipient-a',quotaReserved:true,status:'SENDING',quotaDate:new Date('2026-10-30T00:00:00.000Z')},data:{quotaDate:new Date('2026-10-31T00:00:00.000Z')}});
  expect(tx.dailyUsage.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',usageDate:new Date('2026-10-30T00:00:00.000Z'),reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}});
  expect(tx.dailyUsage.update).toHaveBeenCalledWith({where:{tenantId_usageDate:{tenantId:'tenant-a',usageDate:new Date('2026-10-31T00:00:00.000Z')}},data:{reservedCount:{increment:1}}});
 });
 it('does not move or send a reservation when the new day is at quota',async()=>{
  vi.stubEnv('PLATFORM_TIMEZONE','UTC');
  const {tx,prisma}=fixture({tenantSent:10,recipientDay:new Date('2026-10-30T00:00:00.000Z')});
  await expect(rebaseRecipientQuota(prisma as any,'recipient-a',new Date('2026-10-31T12:00:00.000Z'))).resolves.toBe(false);
  expect(tx.campaignRecipient.updateMany).not.toHaveBeenCalled();
  expect(tx.dailyUsage.updateMany).not.toHaveBeenCalled();
 });
});

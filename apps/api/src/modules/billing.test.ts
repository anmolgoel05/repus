import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  tenantSendingLimit: { findUnique: vi.fn() }, billingSubscription: { findFirst: vi.fn() },
  dailyUsage: { findUnique: vi.fn(), aggregate: vi.fn() }, contact: { count: vi.fn() },
  imageAsset: { aggregate: vi.fn() },
  tenant:{findUnique:vi.fn()},
}));
vi.mock('@repus/database', () => ({ prisma: db }));
import { AuthService } from './auth';
import { BillingService } from './billing';

describe('workspace billing overview', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    vi.clearAllMocks();
    db.tenantSendingLimit.findUnique.mockResolvedValue({ dailyLimit: 50, monthlyLimit: 700, contactLimit: 100, mediaStorageLimitBytes: 4096 });
    db.billingSubscription.findFirst.mockResolvedValue(null);
    db.dailyUsage.findUnique.mockResolvedValue({ sentCount: 4, reservedCount: 2 });
    db.dailyUsage.aggregate.mockResolvedValue({ _sum: { sentCount: 9, reservedCount: 3 } });
    db.contact.count.mockResolvedValue(12);
    db.imageAsset.aggregate.mockResolvedValue({ _sum: { byteSize: 1024 } });
    db.tenant.findUnique.mockResolvedValue({plan:'free'});
  });

  it('returns tenant-scoped plan and current usage, including reservations', async () => {
    const auth = { authenticate: vi.fn().mockResolvedValue({ tenantId: 'tenant-a', id: 'user-a' }) } as unknown as AuthService;
    const service = new BillingService(auth);
    const result = await service.overview({ cookies: { repus_session: 'session' } } as any);
    expect(db.tenantSendingLimit.findUnique).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' } });
    expect(db.dailyUsage.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }));
    expect(result.subscription).toMatchObject({ plan: 'free', status: 'free' });
    expect(result.timezone).toBe('Asia/Kolkata');
    expect(result.usage).toMatchObject({ today: { sent: 4, reserved: 2, limit: 50 }, month: { sent: 9, reserved: 3, limit: 700 }, contacts: { used: 12, limit: 100 }, media: { usedBytes: 1024, limitBytes: 4096 } });
    expect(result.billingEnabled).toBe(false);
  });

  it('reports the latest provider subscription without exposing provider identifiers', async () => {
    db.billingSubscription.findFirst.mockResolvedValue({ provider: 'example', plan: 'growth', status: 'active', currentPeriodStart: new Date('2026-10-01'), currentPeriodEnd: new Date('2026-11-01'), cancelAtPeriodEnd: false });
    const service = new BillingService({ authenticate: vi.fn().mockResolvedValue({ tenantId: 'tenant-a' }) } as any);
    const result = await service.overview({ cookies: { repus_session: 'session' } } as any);
    expect(db.billingSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' }, orderBy: { updatedAt: 'desc' } }));
    expect(result.subscription).toMatchObject({ plan: 'growth', status: 'active' });
    expect(result.subscription).not.toHaveProperty('providerCustomerId');
    expect(result.subscription).not.toHaveProperty('providerSubscriptionId');
  });

  it('uses the workspace plan for an operator-managed account without inventing a provider subscription',async()=>{
    db.tenant.findUnique.mockResolvedValue({plan:'growth'});
    const service=new BillingService({authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a'})} as any);
    const result=await service.overview({cookies:{repus_session:'session'}} as any);
    expect(db.tenant.findUnique).toHaveBeenCalledWith({where:{id:'tenant-a'},select:{plan:true}});
    expect(result.subscription).toMatchObject({provider:null,plan:'growth',status:'managed',currentPeriodEnd:null});
    expect(result.billingEnabled).toBe(false);
  });

  it('does not advertise send capacity when no tenant quota row exists', async () => {
    db.tenantSendingLimit.findUnique.mockResolvedValue(null);
    const service = new BillingService({ authenticate: vi.fn().mockResolvedValue({ tenantId: 'tenant-a' }) } as any);
    const result = await service.overview({ cookies: { repus_session: 'session' } } as any);
    expect(result.sendingEnabled).toBe(false);
    expect(result.usage.today.limit).toBe(0);
    expect(result.usage.month.limit).toBe(0);
    expect(result.usage.contacts.limit).toBeNull();
    expect(result.usage.media.limitBytes).toBe(104_857_600);
  });

  it('uses the configured platform timezone to select the quota day and month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T19:00:00.000Z'));
    vi.stubEnv('PLATFORM_TIMEZONE', 'Asia/Kolkata');
    const service = new BillingService({ authenticate: vi.fn().mockResolvedValue({ tenantId: 'tenant-a' }) } as any);
    await service.overview({ cookies: { repus_session: 'session' } } as any);
    const quotaDate = new Date('2026-07-01T00:00:00.000Z');
    expect(db.dailyUsage.findUnique).toHaveBeenCalledWith({ where: { tenantId_usageDate: { tenantId: 'tenant-a', usageDate: quotaDate } } });
    expect(db.dailyUsage.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', usageDate: { gte: quotaDate, lt: new Date('2026-08-01T00:00:00.000Z') } } }));
  });
});

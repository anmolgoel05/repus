import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  campaign: { findFirst: vi.fn() },
  campaignRecipient: { count: vi.fn(), findMany: vi.fn() },
  emailEvent: { count: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  auditLog: {findFirst: vi.fn()},
}));
vi.mock('@repus/database', () => ({ prisma: db }));

import { CampaignReportsService } from './campaign-reports';

const request = { cookies: { repus_session: 'session' } } as any;
const actor = { authenticate: vi.fn().mockResolvedValue({ tenantId: 'tenant-a' }) };

describe('campaign reports tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor.authenticate.mockResolvedValue({ tenantId: 'tenant-a' });
  });

  it('does not reveal a campaign from another tenant', async () => {
    db.campaign.findFirst.mockResolvedValue(null);
    const service = new CampaignReportsService(actor as any);
    await expect(service.stats(request, 'campaign-b')).rejects.toThrow('Campaign not found.');
    expect(db.campaign.findFirst).toHaveBeenCalledWith({ where: { id: 'campaign-b', tenantId: 'tenant-a' }, select: { id: true } });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports provider acceptance, engagement, and failure counts separately', async () => {
    db.campaign.findFirst.mockResolvedValue({ id: 'campaign-a' });
    db.$queryRaw.mockResolvedValueOnce([{recipients:20,accepted:10,delivered:8,opens:7,clicks:3,uniqueOpens:4,uniqueClicks:2,bounces:1,complaints:1,unsubscribes:1,failed:2,suppressed:1,uncertainSends:1}]);
    const occurredAt = new Date('2026-11-04T00:00:00Z');
    db.auditLog.findFirst.mockResolvedValueOnce({createdAt:occurredAt,metadata:{reason:'complaint_rate',internal:'omit from report'}});
    const service = new CampaignReportsService(actor as any);
    const result = await service.stats(request, 'campaign-a');
    expect(result).toMatchObject({ recipients: 20, accepted: 10, delivered: 8, opens: 7, uniqueOpens: 4, clicks: 3, uniqueClicks: 2, bounces: 1, complaints: 1, unsubscribes: 1, failed: 2, suppressed: 1, uncertainSends:1, deliveryRate: 80, uniqueOpenRate: 40, uniqueClickRate: 20 });
    expect(db.$queryRaw).toHaveBeenCalledExactlyOnceWith(expect.anything(),'tenant-a','campaign-a',expect.any(Date),'tenant-a');
    expect(result.lastReputationPause).toEqual({reason:'complaint_rate',occurredAt});
    expect(db.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',entityType:'campaign',entityId:'campaign-a',action:'campaign.auto_paused.reputation_threshold'}}));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const db = vi.hoisted(() => ({
  campaignRecipient: { findFirst: vi.fn() },
  emailEvent: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));
const decrypt = vi.hoisted(() => vi.fn((value: string) => value));
vi.mock('@repus/database', () => ({ prisma: db, withTenant: (_tenantId: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@repus/token-security', () => ({ decryptToken: decrypt }));
import { TrackingService } from './tracking';

describe('capability-based email tracking', () => {
  const tx = { $executeRaw: vi.fn(), emailEvent: { findFirst: vi.fn(), create: vi.fn() } };
  const service = new TrackingService();
  const capability = (value: Record<string, unknown>) => JSON.stringify(value);

  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation((fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx));
    db.campaignRecipient.findFirst.mockResolvedValue({ id: 'recipient-a', campaign: { htmlContent: '<a href="https://example.org/offer">Offer</a>', textContent: '' } });
    tx.emailEvent.findFirst.mockResolvedValue(null);
    tx.emailEvent.create.mockResolvedValue({ id: 'event-a' });
  });

  it('records total opens while marking only the first event unique', async () => {
    const token = capability({ v: 1, kind: 'open', tenantId: 'tenant-a', recipientId: 'recipient-a' });
    await service.recordOpen(token);
    expect(db.campaignRecipient.findFirst).toHaveBeenCalledWith({ where: { id: 'recipient-a', tenantId: 'tenant-a' }, select: { id: true } });
    expect(tx.emailEvent.create).toHaveBeenLastCalledWith({ data: { tenantId: 'tenant-a', recipientId: 'recipient-a', eventType: 'open', eventData: { unique: true } } });
    tx.emailEvent.findFirst.mockResolvedValue({ id: 'prior-open' });
    await service.recordOpen(token);
    expect(tx.emailEvent.create).toHaveBeenLastCalledWith({ data: { tenantId: 'tenant-a', recipientId: 'recipient-a', eventType: 'open', eventData: { unique: false } } });
  });

  it('rejects a capability for the wrong event type before database access', async () => {
    const token = capability({ v: 1, kind: 'click', tenantId: 'tenant-a', recipientId: 'recipient-a' });
    await expect(service.recordOpen(token)).rejects.toThrow(NotFoundException);
    expect(db.campaignRecipient.findFirst).not.toHaveBeenCalled();
  });

  it('redirects only to an HTTP(S) URL present in that recipient campaign', async () => {
    const token = capability({ v: 1, kind: 'click', tenantId: 'tenant-a', recipientId: 'recipient-a', target: 'https://example.org/offer' });
    await expect(service.clickDestination(token)).resolves.toBe('https://example.org/offer');
    expect(db.campaignRecipient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'recipient-a', tenantId: 'tenant-a' } }));
    expect(tx.emailEvent.create).toHaveBeenCalledWith({ data: { tenantId: 'tenant-a', recipientId: 'recipient-a', eventType: 'click', url: 'https://example.org/offer', eventData: { unique: true } } });
  });

  it('rejects unlisted, credential-bearing, and unsafe click targets', async () => {
    const unlisted = capability({ v: 1, kind: 'click', tenantId: 'tenant-a', recipientId: 'recipient-a', target: 'https://evil.example/path' });
    await expect(service.clickDestination(unlisted)).rejects.toThrow(NotFoundException);
    expect(tx.emailEvent.create).not.toHaveBeenCalled();
    for (const target of ['javascript:alert(1)', 'https://user:pass@example.org/offer']) {
      const token = capability({ v: 1, kind: 'click', tenantId: 'tenant-a', recipientId: 'recipient-a', target });
      await expect(service.clickDestination(token)).rejects.toThrow(NotFoundException);
    }
  });
});

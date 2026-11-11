import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    contact: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    listContact: { createMany: vi.fn(), deleteMany: vi.fn() },
    suppression: { upsert: vi.fn() },
    unsubscribe: { findMany: vi.fn(), createMany: vi.fn() },
    campaignRecipient: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    campaign: { updateMany: vi.fn() },
    emailEvent: { createMany: vi.fn() },
    dailyUsage: { updateMany: vi.fn() },
    platformDailyUsage: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      contact: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
      customFieldDefinition: { findMany: vi.fn() },
      contactList: { findFirst: vi.fn() },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn(async (action: any) => typeof action === 'function' ? action(tx) : Promise.all(action)),
    },
    publishSendInterrupt: vi.fn().mockResolvedValue(1),
  };
});
vi.mock('@repus/database', () => ({ prisma: db.prisma }));
vi.mock('./send-interrupts', () => ({ publishSendInterrupt: db.publishSendInterrupt }));

import { ContactsService } from './contacts';

const request = { cookies: { repus_session: 'session' } } as any;
const auth = { authenticate: vi.fn().mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'OWNER' }) };

describe('bulk contact actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.authenticate.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'OWNER' });
  });

  it('rejects foreign-tenant selections before writing anything', async () => {
    db.prisma.contact.findMany.mockResolvedValue([]);
    const service = new ContactsService(auth as any);
    await expect(service.bulk(request, { contactIds: ['contact-b'], action: 'delete' } as any)).rejects.toThrow('not found in this workspace');
    expect(db.prisma.contact.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', deletedAt: null, id: { in: ['contact-b'] } }, select: { id: true, email: true, normalizedEmail: true, customFields: true } });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('adds normalized tags without discarding custom fields', async () => {
    db.prisma.contact.findMany.mockResolvedValue([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', customFields: { company: 'Example', tags: ['existing'] } }]);
    const service = new ContactsService(auth as any);
    const result = await service.bulk(request, { contactIds: ['contact-a'], action: 'add_tags', tags: [' VIP ', 'existing'] } as any);
    expect(db.tx.contact.update).toHaveBeenCalledWith({ where: { id: 'contact-a' }, data: { customFields: { company: 'Example', tags: ['existing', 'vip'] } } });
    expect(result).toMatchObject({ action: 'add_tags', affectedCount: 1, tags: ['vip', 'existing'] });
  });

  it('scopes tag-filtered contact searches to the active tenant', async () => {
    db.prisma.contact.findMany.mockResolvedValue([]);
    db.prisma.contact.count.mockResolvedValue(0);
    const service = new ContactsService(auth as any);
    await service.list(request, 1, '', 'vip');
    expect(db.prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', deletedAt: null, customFields: { path: ['tags'], array_contains: ['vip'] } } }));
  });

  it('does not expose a contact profile from another tenant', async () => {
    db.prisma.contact.findFirst.mockResolvedValue(null);
    const service = new ContactsService(auth as any);
    await expect(service.get(request, 'contact-b')).rejects.toThrow('Contact not found.');
    expect(db.prisma.contact.findFirst).toHaveBeenCalledWith({ where: { id: 'contact-b', tenantId: 'tenant-a', deletedAt: null } });
    expect(db.prisma.customFieldDefinition.findMany).not.toHaveBeenCalled();
  });

  it('records unsubscribe suppressions and permanent unsubscribe history', async () => {
    db.prisma.contact.findMany.mockResolvedValue([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', customFields: {} }]);
    db.tx.contact.findMany.mockResolvedValue([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', status: 'SUBSCRIBED' }]);
    db.tx.campaignRecipient.findMany.mockResolvedValue([{ id: 'recipient-a', campaignId: 'campaign-a', status: 'SENDING', quotaReserved: true, quotaDate: new Date('2026-10-31T00:00:00.000Z') }]);
    const service = new ContactsService(auth as any);
    const result = await service.bulk(request, { contactIds: ['contact-a'], action: 'unsubscribe' } as any);
    expect(db.tx.suppression.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_normalizedEmail: { tenantId: 'tenant-a', normalizedEmail: 'a@example.test' } } }));
    expect(db.tx.unsubscribe.createMany).toHaveBeenCalledWith({ data: [{ tenantId: 'tenant-a', contactId: 'contact-a', email: 'a@example.test', reason: 'workspace_bulk_action' }] });
    expect(db.tx.emailEvent.createMany).toHaveBeenCalledWith({ data: [{ tenantId: 'tenant-a', recipientId: 'recipient-a', eventType: 'unsubscribe', eventKey: 'unsubscribe:recipient-a' }], skipDuplicates: true });
    expect(db.publishSendInterrupt).toHaveBeenCalledWith({ scope: 'recipient', recipientId: 'recipient-a' });
    expect(result).toEqual({ action: 'unsubscribe', affectedCount: 1 });
  });

  it('appends history after a reactivated contact opts out again, but keeps retries idempotent', async () => {
    db.prisma.contact.findMany.mockResolvedValue([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', customFields: {} }]);
    db.tx.contact.findMany.mockResolvedValueOnce([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', status: 'SUBSCRIBED' }]).mockResolvedValueOnce([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', status: 'UNSUBSCRIBED' }]);
    db.tx.campaignRecipient.findMany.mockResolvedValue([]);
    const service = new ContactsService(auth as any);
    await service.bulk(request, { contactIds: ['contact-a'], action: 'unsubscribe' } as any);
    await service.bulk(request, { contactIds: ['contact-a'], action: 'unsubscribe' } as any);
    expect(db.tx.unsubscribe.createMany).toHaveBeenCalledTimes(1);
    expect(db.tx.unsubscribe.createMany).toHaveBeenCalledWith({ data: [{ tenantId: 'tenant-a', contactId: 'contact-a', email: 'a@example.test', reason: 'workspace_bulk_action' }] });
  });

  it('suppresses queued recipients and releases tenant and platform quota before returning', async () => {
    db.prisma.contact.findMany.mockResolvedValue([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', customFields: {} }]);
    db.tx.campaignRecipient.findMany.mockResolvedValue([
      { id: 'queued-a', campaignId: 'campaign-a', status: 'QUEUED', quotaReserved: true, quotaDate: new Date('2026-10-31T00:00:00.000Z') },
      { id: 'unreserved-a', campaignId: 'campaign-a', status: 'PENDING', quotaReserved: false, quotaDate: new Date('2026-10-31T00:00:00.000Z') },
    ]);
    db.tx.campaignRecipient.updateMany.mockResolvedValue({ count: 2 });
    db.tx.contact.findMany.mockResolvedValue([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', status: 'SUBSCRIBED' }]);
    const service = new ContactsService(auth as any);
    await service.bulk(request, { contactIds: ['contact-a'], action: 'unsubscribe' } as any);
    expect(db.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(db.tx.campaignRecipient.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['queued-a', 'unreserved-a'] }, status: { in: ['PENDING', 'QUEUED'] } }, data: { status: 'SUPPRESSED', quotaReserved: false } });
    expect(db.tx.dailyUsage.updateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', usageDate: new Date('2026-10-31T00:00:00.000Z') }, data: { reservedCount: { decrement: 1 } } });
    expect(db.tx.platformDailyUsage.updateMany).toHaveBeenCalledWith({ where: { usageDate: new Date('2026-10-31T00:00:00.000Z') }, data: { reservedCount: { decrement: 1 } } });
  });

  it('anonymizes deleted profiles and releases reservations for queued campaign sends', async () => {
    db.prisma.contact.findMany.mockResolvedValue([{ id: 'contact-a', email: 'a@example.test', normalizedEmail: 'a@example.test', customFields: { company: 'Private Co' } }]);
    const quotaDate = new Date('2026-10-30T00:00:00.000Z');
    db.tx.campaignRecipient.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    db.tx.campaignRecipient.findMany.mockResolvedValue([{ id: 'recipient-a', campaignId: 'campaign-a', quotaDate }]);
    db.tx.campaignRecipient.updateMany.mockResolvedValue({ count: 1 });
    const service = new ContactsService(auth as any);
    const result = await service.bulk(request, { contactIds: ['contact-a'], action: 'delete' } as any);
    expect(db.tx.campaignRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SUPPRESSED', quotaReserved: false } }));
    expect(db.tx.dailyUsage.updateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', usageDate: quotaDate }, data: { reservedCount: { decrement: 1 } } });
    expect(db.tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'contact-a' }, data: expect.objectContaining({ email: 'deleted+contact-a@redacted.repus.invalid', status: 'UNSUBSCRIBED', consentSource: null, customFields: {}, deletedAt: expect.any(Date) }) }));
    expect(result).toEqual({ action: 'delete', affectedCount: 1 });
  });
});

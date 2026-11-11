import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sesSend = vi.hoisted(() => vi.fn());
const resolveTxt = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({ sendingDomain: { upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn() } }));
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class { send = sesSend; },
  GetEmailIdentityCommand: class { constructor(public input: unknown) {} },
}));
vi.mock('node:dns/promises', () => ({ resolveTxt }));
vi.mock('@repus/database', () => ({ prisma: db }));
import { AuthService } from './auth';
import { DomainsService } from './domains';

describe('SES domain onboarding', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_PROVIDER', 'ses');
    sesSend.mockReset();
    resolveTxt.mockReset();
    db.sendingDomain.upsert.mockReset();
    db.sendingDomain.findFirst.mockReset();
    db.sendingDomain.update.mockReset();
    db.sendingDomain.upsert.mockResolvedValue({ id: 'domain-1', domain: 'mail.example.com' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reads a pre-provisioned SES identity and returns its DKIM tokens', async () => {
    sesSend.mockResolvedValue({ DkimAttributes: { Tokens: ['dkim-a', 'dkim-b'] } });
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'OWNER' }) } as any as AuthService);
    const result = await service.add({ cookies: { repus_session: 'session' } } as any, 'mail.example.com');
    expect(sesSend).toHaveBeenCalledTimes(1);
    expect(sesSend.mock.calls[0][0].input).toEqual({ EmailIdentity: 'mail.example.com' });
    expect(result.dns.dkim).toEqual([
      { type: 'CNAME', name: 'dkim-a._domainkey.mail.example.com', value: 'dkim-a.dkim.amazonses.com' },
      { type: 'CNAME', name: 'dkim-b._domainkey.mail.example.com', value: 'dkim-b.dkim.amazonses.com' },
    ]);
  });

  it('asks an operator to provision an identity rather than creating one at runtime', async () => {
    sesSend.mockRejectedValue(Object.assign(new Error('missing identity'), { name: 'NotFoundException' }));
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'OWNER' }) } as any as AuthService);
    await expect(service.add({ cookies: { repus_session: 'session' } } as any, 'mail.example.com')).rejects.toThrow('not provisioned in Amazon SES');
    expect(db.sendingDomain.upsert).not.toHaveBeenCalled();
  });

  it('scopes domain detail reads to the authenticated tenant', async () => {
    db.sendingDomain.findFirst.mockResolvedValue({ id: 'domain-1', tenantId: 'tenant-1' });
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'OWNER' }) } as any as AuthService);
    await expect(service.get({ cookies: { repus_session: 'session' } } as any, 'domain-1')).resolves.toMatchObject({ tenantId: 'tenant-1' });
    expect(db.sendingDomain.findFirst).toHaveBeenCalledWith({ where: { id: 'domain-1', tenantId: 'tenant-1' } });
  });

  it('does not disclose a domain belonging to another tenant', async () => {
    db.sendingDomain.findFirst.mockResolvedValue(null);
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'OWNER' }) } as any as AuthService);
    await expect(service.get({ cookies: { repus_session: 'session' } } as any, 'domain-2')).rejects.toThrow('Sending domain not found.');
    expect(db.sendingDomain.findFirst).toHaveBeenCalledWith({ where: { id: 'domain-2', tenantId: 'tenant-1' } });
  });

  it('checks SES verification and DKIM plus SPF and DMARC records before persisting readiness', async () => {
    db.sendingDomain.findFirst.mockResolvedValue({ id: 'domain-1', tenantId: 'tenant-1', domain: 'mail.example.com' });
    db.sendingDomain.update.mockResolvedValue({ id: 'domain-1', verificationStatus: 'verified', dkimStatus: 'verified', spfStatus: 'verified', dmarcStatus: 'verified' });
    sesSend.mockResolvedValue({ VerificationStatus: 'SUCCESS', DkimAttributes: { Status: 'SUCCESS' } });
    resolveTxt.mockImplementation(async (name: string) => name === 'mail.example.com'
      ? [['V=SPF1 INCLUDE:AMAZONSES.COM ~ALL']]
      : [['V=DMARC1; p=none; rua=mailto:postmaster@example.com']]);
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'OWNER' }) } as any as AuthService);

    await expect(service.verify({ cookies: { repus_session: 'session' } } as any, 'domain-1')).resolves.toMatchObject({ verificationStatus: 'verified', dkimStatus: 'verified', spfStatus: 'verified', dmarcStatus: 'verified' });
    expect(db.sendingDomain.findFirst).toHaveBeenCalledWith({ where: { id: 'domain-1', tenantId: 'tenant-1' } });
    expect(sesSend.mock.calls[0][0].input).toEqual({ EmailIdentity: 'mail.example.com' });
    expect(resolveTxt).toHaveBeenCalledWith('mail.example.com');
    expect(resolveTxt).toHaveBeenCalledWith('_dmarc.mail.example.com');
    expect(db.sendingDomain.update).toHaveBeenCalledWith({ where: { id: 'domain-1' }, data: { verificationStatus: 'verified', dkimStatus: 'verified', spfStatus: 'verified', dmarcStatus: 'verified' } });
  });

  it('fails readiness closed when SES or the DNS records are not verified', async () => {
    db.sendingDomain.findFirst.mockResolvedValue({ id: 'domain-1', tenantId: 'tenant-1', domain: 'mail.example.com' });
    db.sendingDomain.update.mockResolvedValue({ id: 'domain-1', verificationStatus: 'pending', dkimStatus: 'pending', spfStatus: 'missing', dmarcStatus: 'missing' });
    sesSend.mockResolvedValue({ VerificationStatus: 'PENDING', DkimAttributes: { Status: 'PENDING' } });
    resolveTxt.mockRejectedValue(new Error('DNS record not found'));
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'OWNER' }) } as any as AuthService);

    await expect(service.verify({ cookies: { repus_session: 'session' } } as any, 'domain-1')).resolves.toMatchObject({ verificationStatus: 'pending', dkimStatus: 'pending', spfStatus: 'missing', dmarcStatus: 'missing' });
    expect(db.sendingDomain.update).toHaveBeenCalledWith({ where: { id: 'domain-1' }, data: { verificationStatus: 'pending', dkimStatus: 'pending', spfStatus: 'missing', dmarcStatus: 'missing' } });
  });

  it('does not mark SPF or DMARC ready when multiple policy records are published', async () => {
    db.sendingDomain.findFirst.mockResolvedValue({ id: 'domain-1', tenantId: 'tenant-1', domain: 'mail.example.com' });
    db.sendingDomain.update.mockResolvedValue({ id: 'domain-1', verificationStatus: 'verified', dkimStatus: 'verified', spfStatus: 'missing', dmarcStatus: 'missing' });
    sesSend.mockResolvedValue({ VerificationStatus: 'SUCCESS', DkimAttributes: { Status: 'SUCCESS' } });
    resolveTxt.mockImplementation(async (name: string) => name === 'mail.example.com'
      ? [['v=spf1 include:amazonses.com ~all'], ['v=spf1 include:other-mail.example ~all']]
      : [['v=DMARC1; p=none'], ['v=DMARC1; p=reject']]);
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'OWNER' }) } as any as AuthService);

    await expect(service.verify({ cookies: { repus_session: 'session' } } as any, 'domain-1')).resolves.toMatchObject({ verificationStatus: 'verified', dkimStatus: 'verified', spfStatus: 'missing', dmarcStatus: 'missing' });
    expect(db.sendingDomain.update).toHaveBeenCalledWith({ where: { id: 'domain-1' }, data: { verificationStatus: 'verified', dkimStatus: 'verified', spfStatus: 'missing', dmarcStatus: 'missing' } });
  });

  it('does not let viewers refresh domain readiness', async () => {
    const service = new DomainsService({ authenticate: vi.fn().mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'VIEWER' }) } as any as AuthService);
    await expect(service.verify({ cookies: { repus_session: 'session' } } as any, 'domain-1')).rejects.toThrow('read-only');
    expect(db.sendingDomain.findFirst).not.toHaveBeenCalled();
    expect(sesSend).not.toHaveBeenCalled();
  });
});

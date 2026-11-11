import { describe, expect, it } from 'vitest';
import { campaignSendActionAtProviderBoundary,campaignSenderDomainBlock } from './campaign-send-state';

describe('campaign state at the provider boundary', () => {
  it('submits only campaigns that remain active', () => {
    expect(campaignSendActionAtProviderBoundary('QUEUED')).toBe('submit');
    expect(campaignSendActionAtProviderBoundary('SENDING')).toBe('submit');
  });

  it('requeues a recipient when the campaign is paused', () => {
    expect(campaignSendActionAtProviderBoundary('PAUSED')).toBe('requeue');
  });

  it.each(['CANCELLED', 'DRAFT', 'SCHEDULED', 'COMPLETED', 'FAILED', null] as const)(
    'suppresses a recipient when the campaign is %s', status => {
      expect(campaignSendActionAtProviderBoundary(status)).toBe('suppress');
    },
  );
});

describe('campaign sender readiness at the provider boundary',()=>{
  it('requires the sender domain to remain verified immediately before submission',()=>{
    expect(campaignSenderDomainBlock('news@example.com',null,'ses')).toContain('Verify your sender domain');
    expect(campaignSenderDomainBlock('news@example.com',{verificationStatus:'verified',dkimStatus:'pending'},'ses')).toContain('DKIM');
    expect(campaignSenderDomainBlock('news@example.com',{verificationStatus:'verified',dkimStatus:'verified'},'ses')).toBeNull();
  });
  it('rejects a malformed sender address before provider submission',()=>{
    expect(campaignSenderDomainBlock('news@',null,'development')).toContain('valid sender email');
  });
});

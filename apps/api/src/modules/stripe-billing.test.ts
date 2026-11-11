import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readStripePlanCatalog, stripeUnixDate, verifyStripeSignature } from './stripe-billing';

describe('Stripe billing primitives', () => {
  const secret = 'whsec_test_secret';
  const body = Buffer.from('{"id":"evt_test","type":"customer.subscription.updated"}');

  it('verifies the exact raw payload and accepts any matching v1 signature', () => {
    const timestamp = 1_800_000_000;
    const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
    expect(verifyStripeSignature(body, `t=${timestamp},v1=${'0'.repeat(64)},v1=${digest}`, secret, timestamp)).toBe(true);
    expect(verifyStripeSignature(Buffer.from(`${body.toString()} `), `t=${timestamp},v1=${digest}`, secret, timestamp)).toBe(false);
  });

  it('rejects missing, malformed, and stale signatures', () => {
    expect(verifyStripeSignature(body, undefined, secret)).toBe(false);
    expect(verifyStripeSignature(body, 't=nope,v1=00', secret)).toBe(false);
    expect(verifyStripeSignature(body, 't=1,v1=00', secret, 1_800_000_000)).toBe(false);
  });

  it('validates the configured plan catalog and prevents ambiguous price mappings', () => {
    const catalog = readStripePlanCatalog(JSON.stringify({ starter: { priceId: 'price_abc123', dailyLimit: 100, monthlyLimit: 2000, contactLimit: 1000, mediaStorageLimitBytes: 5_000_000 } }));
    expect(catalog.starter).toMatchObject({ priceId: 'price_abc123', dailyLimit: 100 });
    expect(() => readStripePlanCatalog('{broken')).toThrow('valid JSON');
    expect(() => readStripePlanCatalog(JSON.stringify({ a: { priceId: 'price_same', dailyLimit: 1, monthlyLimit: 1, contactLimit: 1, mediaStorageLimitBytes: 1 }, b: { priceId: 'price_same', dailyLimit: 1, monthlyLimit: 1, contactLimit: 1, mediaStorageLimitBytes: 1 } }))).toThrow('unique');
    expect(() => readStripePlanCatalog(JSON.stringify({ a: { priceId: 'price_abc', dailyLimit: -1, monthlyLimit: 1, contactLimit: 1, mediaStorageLimitBytes: 1 } }))).toThrow('dailyLimit');
    expect(() => readStripePlanCatalog(JSON.stringify({ constructor: { priceId: 'price_abc', dailyLimit: 10_000_001, monthlyLimit: 1, contactLimit: 1, mediaStorageLimitBytes: 1 } }))).toThrow('dailyLimit');
  });

  it('converts only valid Stripe unix seconds to dates', () => {
    expect(stripeUnixDate(1_800_000_000)).toEqual(new Date('2027-01-15T08:00:00.000Z'));
    expect(stripeUnixDate('1800000000')).toBeNull();
    expect(stripeUnixDate(-1)).toBeNull();
  });
});

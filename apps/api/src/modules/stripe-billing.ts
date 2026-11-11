import { createHmac, timingSafeEqual } from 'node:crypto';

export type StripePlan = {
  priceId: string;
  dailyLimit: number;
  monthlyLimit: number;
  contactLimit: number;
  mediaStorageLimitBytes: number;
};

export function verifyStripeSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300) {
  if (!signatureHeader || !secret || !Buffer.isBuffer(rawBody)) return false;
  const values = signatureHeader.split(',').map(part => part.trim().split('=', 2) as [string, string]);
  const timestampText = values.find(([key]) => key === 't')?.[1];
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const signed = Buffer.from(createHmac('sha256', secret).update(`${timestampText}.`).update(rawBody).digest('hex'), 'hex');
  return values.filter(([key]) => key === 'v1').some(([, value]) => {
    if (!/^[a-f\d]{64}$/i.test(value)) return false;
    const candidate = Buffer.from(value, 'hex');
    return candidate.length === signed.length && timingSafeEqual(candidate, signed);
  });
}

export function readStripePlanCatalog(value = process.env.STRIPE_PLAN_CATALOG ?? ''): Record<string, StripePlan> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('STRIPE_PLAN_CATALOG must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('STRIPE_PLAN_CATALOG must be a JSON object.');
  const result: Record<string, StripePlan> = Object.create(null) as Record<string, StripePlan>;
  const priceIds = new Set<string>();
  const maximums: Record<string, number> = { dailyLimit: 10_000_000, monthlyLimit: 100_000_000, contactLimit: 100_000_000, mediaStorageLimitBytes: 2_000_000_000 };
  for (const [name, raw] of Object.entries(parsed)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('STRIPE_PLAN_CATALOG contains an invalid plan.');
    const plan = raw as Record<string, unknown>;
    if (typeof plan.priceId !== 'string' || !/^price_[A-Za-z0-9]+$/.test(plan.priceId) || priceIds.has(plan.priceId)) throw new Error('Each Stripe plan must have a unique valid priceId.');
    for (const key of ['dailyLimit', 'monthlyLimit', 'contactLimit', 'mediaStorageLimitBytes']) {
      const field = plan[key];
      if (!Number.isSafeInteger(field) || (field as number) < 0 || (field as number) > maximums[key]) throw new Error(`Stripe plan ${name} has an invalid ${key}.`);
    }
    priceIds.add(plan.priceId);
    result[name] = {
      priceId: plan.priceId,
      dailyLimit: plan.dailyLimit as number,
      monthlyLimit: plan.monthlyLimit as number,
      contactLimit: plan.contactLimit as number,
      mediaStorageLimitBytes: plan.mediaStorageLimitBytes as number,
    };
  }
  return result;
}

export function stripeUnixDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

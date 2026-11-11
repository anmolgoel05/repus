import { describe, expect, it } from 'vitest';
import { buildTenantAdminPatch, type TenantAdminValues } from './quota-change';

describe('platform tenant edit payloads', () => {
  const values: TenantAdminValues = { status: 'paused', dailyLimit: 300, monthlyLimit: 9000, contactLimit: 2000, mediaStorageLimitBytes: 52_428_800, enabled: false };

  it('sends only the fields the platform operator changed', () => {
    expect(buildTenantAdminPatch(values, new Set(['status']))).toEqual({ status: 'paused' });
    expect(buildTenantAdminPatch(values, new Set(['dailyLimit', 'enabled']))).toEqual({ dailyLimit: 300, enabled: false });
  });

  it('does not mark quota fields as overridden for unrelated status edits', () => {
    const patch = buildTenantAdminPatch(values, new Set(['status']));
    expect(patch).not.toHaveProperty('dailyLimit');
    expect(patch).not.toHaveProperty('monthlyLimit');
    expect(patch).not.toHaveProperty('contactLimit');
    expect(patch).not.toHaveProperty('mediaStorageLimitBytes');
  });
});

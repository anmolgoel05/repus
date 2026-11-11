export type TenantAdminField = 'status' | 'dailyLimit' | 'monthlyLimit' | 'contactLimit' | 'mediaStorageLimitBytes' | 'enabled';
export type TenantAdminValues = Record<TenantAdminField, string | number | boolean>;

export function buildTenantAdminPatch(values: TenantAdminValues, changedFields: ReadonlySet<TenantAdminField>) {
  const patch: Partial<TenantAdminValues> = {};
  for (const field of changedFields) patch[field] = values[field];
  return patch;
}

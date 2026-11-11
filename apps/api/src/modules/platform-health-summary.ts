export function nonNegativeCounts(counts: object) {
  const values = counts as Record<string, number | undefined>;
  return Object.fromEntries(['waiting', 'active', 'delayed', 'failed', 'paused'].map(key => { const value = Number(values[key] ?? 0); return [key, Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0]; }));
}

export function isSesSandbox(provider:{status:string;productionAccess:boolean|null}){
  return provider.status==='available'&&provider.productionAccess===false;
}

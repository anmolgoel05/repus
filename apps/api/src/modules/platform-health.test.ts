import { describe, expect, it } from 'vitest';
import { isSesSandbox, nonNegativeCounts } from './platform-health-summary';

describe('platform queue health summaries', () => {
  it('returns stable queue counters and clamps invalid values', () => {
    expect(nonNegativeCounts({ waiting: 4, active: 2.9, delayed: -3, failed: Number.NaN })).toEqual({ waiting: 4, active: 2, delayed: 0, failed: 0, paused: 0 });
  });
});

describe('SES access readiness',()=>{
  it('flags a reachable SES account that is still in sandbox',()=>expect(isSesSandbox({status:'available',productionAccess:false})).toBe(true));
  it('does not label the development adapter, production accounts, or unavailable checks as sandbox',()=>{
    expect(isSesSandbox({status:'development',productionAccess:false})).toBe(false);
    expect(isSesSandbox({status:'available',productionAccess:true})).toBe(false);
    expect(isSesSandbox({status:'unavailable',productionAccess:null})).toBe(false);
  });
});

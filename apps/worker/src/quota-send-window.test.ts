import {describe,expect,it} from 'vitest';
import {campaignSendDeferralBoundary} from './quota-send-window';

describe('campaign provider send window',()=>{
 it('defers when the provider timeout could cross platform-local midnight',()=>{
  expect(campaignSendDeferralBoundary(new Date('2026-10-30T18:29:30.000Z'),'Asia/Kolkata',30_000)?.toISOString()).toBe('2026-10-30T18:30:00.000Z');
 });
 it('keeps the full provider timeout plus safety margin inside the current quota day',()=>{
  expect(campaignSendDeferralBoundary(new Date('2026-10-30T18:29:28.999Z'),'Asia/Kolkata',30_000)).toBeNull();
 });
 it('uses the actual local midnight across daylight-saving boundaries',()=>{
  expect(campaignSendDeferralBoundary(new Date('2026-03-08T04:59:29.000Z'),'America/New_York',30_000)?.toISOString()).toBe('2026-03-08T05:00:00.000Z');
 });
});

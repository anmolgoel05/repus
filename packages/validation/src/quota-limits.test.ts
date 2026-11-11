import {describe,expect,it} from 'vitest';
import {effectivePlatformSendLimits,platformQuotaDate,nextPlatformQuotaBoundary} from './quota-limits';

describe('effective platform send limits',()=>{
 it('prefers persisted operator overrides over environment defaults',()=>{
  expect(effectivePlatformSendLimits({dailySendLimit:900,monthlySendLimit:12_000},{PLATFORM_DAILY_SEND_LIMIT:'2500',PLATFORM_MONTHLY_SEND_LIMIT:'75000'})).toEqual({daily:900,monthly:12_000});
 });
 it('uses environment defaults only for unset persistent overrides',()=>{
  expect(effectivePlatformSendLimits({dailySendLimit:null,monthlySendLimit:40_000},{PLATFORM_DAILY_SEND_LIMIT:'700',PLATFORM_MONTHLY_SEND_LIMIT:'75000'})).toEqual({daily:700,monthly:40_000});
  expect(effectivePlatformSendLimits({dailySendLimit:null,monthlySendLimit:null},{})).toEqual({daily:2500,monthly:75_000});
 });
 it('fails closed when a used environment default is malformed',()=>{
  expect(()=>effectivePlatformSendLimits({dailySendLimit:null,monthlySendLimit:null},{PLATFORM_DAILY_SEND_LIMIT:'1.5'})).toThrow('PLATFORM_DAILY_SEND_LIMIT');
  expect(()=>effectivePlatformSendLimits({dailySendLimit:100,monthlySendLimit:null},{PLATFORM_MONTHLY_SEND_LIMIT:'-1'})).toThrow('PLATFORM_MONTHLY_SEND_LIMIT');
 });
});

describe('platform quota date',()=>{
 it('uses the configured local calendar day at midnight boundaries',()=>{
  expect(platformQuotaDate(new Date('2026-10-30T18:29:59.999Z'),'Asia/Kolkata')).toEqual(new Date('2026-10-30T00:00:00.000Z'));
  expect(platformQuotaDate(new Date('2026-10-30T18:30:00.000Z'),'Asia/Kolkata')).toEqual(new Date('2026-10-31T00:00:00.000Z'));
 });
 it('keeps date-only quota keys correct across daylight-saving transitions',()=>{
  expect(platformQuotaDate(new Date('2026-03-08T07:30:00.000Z'),'America/New_York')).toEqual(new Date('2026-03-08T00:00:00.000Z'));
  expect(platformQuotaDate(new Date('2026-11-01T06:30:00.000Z'),'America/New_York')).toEqual(new Date('2026-11-01T00:00:00.000Z'));
 });
 it('resolves the next local midnight to the correct UTC instant across DST changes',()=>{
  expect(nextPlatformQuotaBoundary(new Date('2026-03-08T04:00:00.000Z'),'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
  expect(nextPlatformQuotaBoundary(new Date('2026-11-01T04:00:00.000Z'),'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  expect(nextPlatformQuotaBoundary(new Date('2026-09-05T12:00:00.000Z'),'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
 });
 it('rejects invalid instants and timezone configuration',()=>{
  expect(()=>platformQuotaDate(new Date(Number.NaN),'UTC')).toThrow('valid timestamp');
  expect(()=>platformQuotaDate(new Date('2026-01-01T00:00:00.000Z'),'not/a-zone')).toThrow();
 });
});

import {describe,expect,it} from 'vitest';
import {addLocalDays,localDateKey,localMidnight} from './analytics-time';

describe('analytics timezone windows',()=>{
 it('starts the reporting day at midnight in the tenant timezone',()=>{
  expect(localMidnight('2026-10-30','Asia/Kolkata').toISOString()).toBe('2026-10-29T18:30:00.000Z');
  expect(localMidnight('2026-10-30','America/Los_Angeles').toISOString()).toBe('2026-10-30T07:00:00.000Z');
 });
 it('handles daylight-saving transitions and local calendar day arithmetic',()=>{
  const before=localMidnight('2026-03-08','America/New_York');const after=localMidnight('2026-03-09','America/New_York');
  expect(after.getTime()-before.getTime()).toBe(23*60*60*1000);
  expect(addLocalDays('2026-03-08',1)).toBe('2026-03-09');
  expect(localDateKey(before,'America/New_York')).toBe('2026-03-08');
 });
});

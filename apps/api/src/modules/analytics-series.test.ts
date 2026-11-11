import {describe,expect,it} from 'vitest';
import {buildDailyAnalytics} from './analytics-series';

describe('daily analytics series',()=>{
 it('fills the tenant-local 14-day window and carries bounce and complaint counts',()=>{
  const result=buildDailyAnalytics(new Date('2026-10-30T01:00:00Z'),'Asia/Kolkata',[
   {day:'2026-10-29',sent:12},
  ],[
   {day:'2026-10-29',delivered:10,bounces:1,complaints:1,opens:7,clicks:3,uniqueOpens:4,uniqueClicks:2},
  ]);
  expect(result).toHaveLength(14);
  expect(result[12]).toEqual({date:'2026-10-29',sent:12,delivered:10,bounces:1,complaints:1,opens:7,clicks:3,uniqueOpens:4,uniqueClicks:2});
  expect(result[13]).toEqual({date:'2026-10-30',sent:0,delivered:0,bounces:0,complaints:0,opens:0,clicks:0,uniqueOpens:0,uniqueClicks:0});
  expect(result[0].date).toBe('2026-10-17');
 });
});

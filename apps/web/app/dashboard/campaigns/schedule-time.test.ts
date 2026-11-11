import {describe,expect,it} from 'vitest';
import {dateTimeInZoneToUtc,formatDateTimeInZone} from './schedule-time';

describe('workspace timezone scheduling',()=>{
  it('converts a workspace local time to UTC and back',()=>{
    const utc=dateTimeInZoneToUtc('2026-02-01T09:30','Asia/Kolkata');
    expect(utc.toISOString()).toBe('2026-02-01T04:00:00.000Z');
    expect(formatDateTimeInZone(utc,'Asia/Kolkata')).toBe('2026-02-01T09:30');
  });
  it('rejects a local time skipped by the spring daylight-saving change',()=>{
    expect(()=>dateTimeInZoneToUtc('2026-03-08T02:30','America/New_York')).toThrow('does not exist');
  });
  it('chooses the earlier instant when a fall daylight-saving time occurs twice',()=>{
    expect(dateTimeInZoneToUtc('2026-11-01T01:30','America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
  it('handles daylight-saving changes that shift the clock by thirty minutes',()=>{
    expect(dateTimeInZoneToUtc('2026-04-05T01:45','Australia/Lord_Howe').toISOString()).toBe('2026-04-04T14:45:00.000Z');
    expect(()=>dateTimeInZoneToUtc('2026-10-04T02:15','Australia/Lord_Howe')).toThrow('does not exist');
  });
  it('rejects invalid wall-clock values and timezones',()=>{
    expect(()=>dateTimeInZoneToUtc('2026-02-30T09:30','UTC')).toThrow('valid date and time');
    expect(()=>dateTimeInZoneToUtc('2026-02-01T09:30','Not/A_Zone')).toThrow();
  });
});

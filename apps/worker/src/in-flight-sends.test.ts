import {describe,expect,it} from 'vitest';
import {abortInFlightSends,withInFlightAbort,type InFlightSend} from './in-flight-sends';

describe('in-flight provider request interruption',()=>{
 it('interrupts all requests for a global pause and only matching requests for a campaign pause',()=>{
  const first=new AbortController(),second=new AbortController(),third=new AbortController();
  const sends=new Map<string,InFlightSend>([
   ['one',{campaignId:'campaign-a',tenantId:'tenant-a',controller:first}],
   ['two',{campaignId:'campaign-b',tenantId:'tenant-a',controller:second}],
   ['three',{campaignId:'campaign-a',tenantId:'tenant-b',controller:third}],
  ]);
  expect(abortInFlightSends(sends,{scope:'campaign',campaignId:'campaign-a'})).toBe(2);
  expect(first.signal.aborted).toBe(true);expect(second.signal.aborted).toBe(false);expect(third.signal.aborted).toBe(true);
  expect(abortInFlightSends(sends,{scope:'all'})).toBe(1);
  expect(second.signal.aborted).toBe(true);
  expect(abortInFlightSends(sends,{scope:'all'})).toBe(0);
 });
 it('passes an abort signal to the provider and removes completed requests from the registry',async()=>{
  const sends=new Map<string,InFlightSend>();let signal:AbortSignal|undefined;
  await expect(withInFlightAbort(sends,'recipient-a','campaign-a','tenant-a',async value=>{signal=value;return 'accepted';})).resolves.toBe('accepted');
  expect(signal).toBeInstanceOf(AbortSignal);expect(sends.size).toBe(0);
 });
 it('interrupts only requests owned by a suspended tenant',()=>{
  const tenantA=new AbortController(),tenantB=new AbortController();
  const sends=new Map<string,InFlightSend>([
   ['a',{campaignId:'campaign-a',tenantId:'tenant-a',controller:tenantA}],
   ['b',{campaignId:'campaign-b',tenantId:'tenant-b',controller:tenantB}],
  ]);
  expect(abortInFlightSends(sends,{scope:'tenant',tenantId:'tenant-a'})).toBe(1);
  expect(tenantA.signal.aborted).toBe(true);expect(tenantB.signal.aborted).toBe(false);
 });
 it('interrupts only the matching recipient for an unsubscribe',()=>{
  const first=new AbortController(),second=new AbortController();
  const sends=new Map<string,InFlightSend>([['recipient-a',{campaignId:'campaign-a',tenantId:'tenant-a',controller:first}],['recipient-b',{campaignId:'campaign-a',tenantId:'tenant-a',controller:second}]]);
  expect(abortInFlightSends(sends,{scope:'recipient',recipientId:'recipient-a'})).toBe(1);
  expect(first.signal.aborted).toBe(true);expect(second.signal.aborted).toBe(false);
 });
});

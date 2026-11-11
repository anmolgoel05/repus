import {afterEach,describe,expect,it,vi} from 'vitest';
import {withVisibilityLease} from './visibility-lease';

describe('SQS event visibility lease',()=>{
 afterEach(()=>vi.useRealTimers());
 it('extends visibility while processing and stops renewing when finished',async()=>{
  vi.useFakeTimers();
  let finish!:()=>void;
  const renew=vi.fn().mockResolvedValue(undefined);
  const work=withVisibilityLease(()=>new Promise<string>(resolve=>{finish=()=>resolve('done')}),renew,vi.fn());
  await vi.advanceTimersByTimeAsync(45_000);
  expect(renew).toHaveBeenCalledOnce();
  finish();
  await expect(work).resolves.toBe('done');
  await vi.advanceTimersByTimeAsync(90_000);
  expect(renew).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
 });
 it('does not replace event processing failure with a visibility timer failure',async()=>{
  vi.useFakeTimers();
  const onFailure=vi.fn();
  const failure=new Error('event processing failed');
  await expect(withVisibilityLease(async()=>{throw failure},async()=>{},onFailure)).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
 });
 it('reports renewal failures while allowing the processing attempt to finish',async()=>{
  vi.useFakeTimers();
  let finish!:()=>void;
  const onFailure=vi.fn();
  const work=withVisibilityLease(()=>new Promise<string>(resolve=>{finish=()=>resolve('processed')}),async()=>{throw new Error('renewal failed')},onFailure);
  await vi.advanceTimersByTimeAsync(45_000);
  expect(onFailure).toHaveBeenCalledOnce();
  finish();
  await expect(work).resolves.toBe('processed');
 });
 it('does not overlap renewals and drains an in-flight renewal before returning',async()=>{
  vi.useFakeTimers();
  let finish!:()=>void;
  let finishRenewal!:()=>void;
  const renew=vi.fn(()=>new Promise<void>(resolve=>{finishRenewal=resolve;}));
  const done=vi.fn();
  const work=withVisibilityLease(()=>new Promise<void>(resolve=>{finish=resolve;}),renew,vi.fn()).then(done);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(renew).toHaveBeenCalledOnce();
  finish();
  await vi.advanceTimersByTimeAsync(45_000);
  expect(done).not.toHaveBeenCalled();
  expect(renew).toHaveBeenCalledOnce();
  finishRenewal();
  await work;
  expect(done).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
 });
});

import {describe,expect,it,vi} from 'vitest';
import {createSesSendSignal} from './send-timeout';

describe('bounded SES requests',()=>{
 it('aborts when the provider request reaches its timeout',()=>{
  const timeout=new AbortController();
  const timeoutFactory=vi.fn().mockReturnValue(timeout.signal);
  const signal=createSesSendSignal(undefined,50,timeoutFactory);
  expect(signal.aborted).toBe(false);
  expect(timeoutFactory).toHaveBeenCalledWith(50);
  timeout.abort(new Error('timeout'));
  expect(signal.aborted).toBe(true);
 });
 it('combines the emergency control signal with the request timeout',()=>{
  const control=new AbortController();
  const signal=createSesSendSignal(control.signal,10_000);
  expect(signal.aborted).toBe(false);
  control.abort();
  expect(signal.aborted).toBe(true);
 });
});

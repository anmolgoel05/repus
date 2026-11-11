import {describe,expect,it} from 'vitest';
import {emailWorkerRateLimit} from './email-rate-limit';

describe('email worker provider rate limit',()=>{
 it('defaults to one message per second for SES sandbox compatibility',()=>{
  expect(emailWorkerRateLimit({})).toEqual({max:1,duration:1000});
 });
 it('allows operators to configure a positive integer provider rate',()=>{
  expect(emailWorkerRateLimit({EMAIL_MAX_SEND_RATE_PER_SECOND:'4'})).toEqual({max:4,duration:1000});
 });
 it('fails closed for zero, fractional, or malformed rates',()=>{
  expect(()=>emailWorkerRateLimit({EMAIL_MAX_SEND_RATE_PER_SECOND:'0'})).toThrow('at least 1');
  expect(()=>emailWorkerRateLimit({EMAIL_MAX_SEND_RATE_PER_SECOND:'1.5'})).toThrow('non-negative whole number');
  expect(()=>emailWorkerRateLimit({EMAIL_MAX_SEND_RATE_PER_SECOND:'fast'})).toThrow('non-negative whole number');
 });
});

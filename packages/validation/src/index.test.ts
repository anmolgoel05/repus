import { describe,expect,it } from 'vitest';
import { canReserve,emailSchema,isMarketingEligible,normalizeEmail,nonNegativeIntegerConfig } from './index';

describe('email normalization and eligibility',()=>{
 it('normalizes before duplicate checks',()=>expect(normalizeEmail('  Alice@Example.com ')).toBe('alice@example.com'));
 it('rejects an invalid email',()=>expect(emailSchema.safeParse('not-an-address').success).toBe(false));
 it('does not silently re-enable a suppressed address',()=>expect(isMarketingEligible({status:'SUBSCRIBED',consentAt:new Date(),consentSource:'signup form',suppressed:true})).toBe(false));
 it('requires explicit consent',()=>expect(isMarketingEligible({status:'SUBSCRIBED',consentAt:null,consentSource:null,suppressed:false})).toBe(false));
});

describe('quota reservation',()=>{
 it('counts both sent and already reserved capacity atomically',()=>{expect(canReserve(4,3,2,10)).toBe(true);expect(canReserve(4,3,4,10)).toBe(false)});
 it('rejects invalid or zero reservations',()=>{expect(canReserve(0,0,0,5)).toBe(false);expect(canReserve(0,-1,1,5)).toBe(false)});
 it('rejects malformed deployment limits instead of allowing quota comparisons to fail open',()=>{expect(nonNegativeIntegerConfig(undefined,2500,'limit')).toBe(2500);expect(nonNegativeIntegerConfig('0',2500,'limit')).toBe(0);expect(()=>nonNegativeIntegerConfig('NaN',2500,'limit')).toThrow('non-negative whole number');expect(()=>nonNegativeIntegerConfig('1.5',2500,'limit')).toThrow('non-negative whole number');expect(()=>nonNegativeIntegerConfig('-1',2500,'limit')).toThrow('non-negative whole number');});
});


import {describe,expect,it} from 'vitest';
import {reputationPauseReason,reputationThresholds} from './reputation-policy';

describe('campaign reputation safeguards',()=>{
 it('uses conservative defaults and supports validated operator overrides',()=>{
  expect(reputationThresholds({})).toEqual({minimumSample:20,maximumBounceRate:0.05,maximumComplaintRate:0.001});
  expect(reputationThresholds({REPUS_REPUTATION_MINIMUM_SAMPLE:'50',REPUS_MAX_BOUNCE_RATE:'0.08',REPUS_MAX_COMPLAINT_RATE:'0.002'})).toEqual({minimumSample:50,maximumBounceRate:0.08,maximumComplaintRate:0.002});
 });
 it('does not trigger below the minimum sample and pauses at configured rate thresholds',()=>{
  const thresholds=reputationThresholds({REPUS_REPUTATION_MINIMUM_SAMPLE:'20',REPUS_MAX_BOUNCE_RATE:'0.05',REPUS_MAX_COMPLAINT_RATE:'0.001'});
  expect(reputationPauseReason({total:19,bounces:2,complaints:1},thresholds)).toBeNull();
  expect(reputationPauseReason({total:20,bounces:1,complaints:0},thresholds)).toMatchObject({reason:'bounce_rate'});
  expect(reputationPauseReason({total:100,bounces:0,complaints:1},thresholds)).toMatchObject({reason:'complaint_rate'});
  expect(reputationPauseReason({total:100,bounces:2,complaints:0},thresholds)).toBeNull();
 });
 it('rejects malformed values instead of silently disabling safeguards',()=>{
  expect(()=>reputationThresholds({REPUS_MAX_BOUNCE_RATE:'0'})).toThrow('REPUS_MAX_BOUNCE_RATE');
  expect(()=>reputationThresholds({REPUS_REPUTATION_MINIMUM_SAMPLE:'-1'})).toThrow('REPUS_REPUTATION_MINIMUM_SAMPLE');
 });
});

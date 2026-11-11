import {afterEach,describe,expect,it,vi} from 'vitest';
import {DelayedError} from 'bullmq';
import {ProviderOutcomeUnknownError} from './provider-failure';
import {handleCampaignSendFailure} from './campaign-send-failure';

afterEach(()=>vi.restoreAllMocks());
const finalAttempt={providerAccepted:false,attemptsMade:4,attempts:5};
function actions(){return {releaseReservation:vi.fn().mockResolvedValue(undefined),markRetry:vi.fn().mockResolvedValue(undefined)};}

describe('campaign send failure accounting',()=>{
 it('preserves a deliberately delayed job and its reservation even on the final retry',async()=>{
  const effects=actions(),delay=new DelayedError();
  await expect(handleCampaignSendFailure(delay,finalAttempt,effects)).rejects.toBe(delay);
  expect(effects.releaseReservation).not.toHaveBeenCalled();expect(effects.markRetry).not.toHaveBeenCalled();
 });
 it('releases the reservation only when a real retryable failure exhausts attempts',async()=>{
  const effects=actions(),failure=new Error('local preparation failed');
  await expect(handleCampaignSendFailure(failure,finalAttempt,effects)).rejects.toBe(failure);
  expect(effects.releaseReservation).toHaveBeenCalledTimes(1);expect(effects.markRetry).not.toHaveBeenCalled();
 });
 it('keeps quota reserved when provider acceptance is uncertain',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});
  const effects=actions();
  await handleCampaignSendFailure(new ProviderOutcomeUnknownError(),finalAttempt,effects);
  expect(effects.releaseReservation).not.toHaveBeenCalled();expect(effects.markRetry).not.toHaveBeenCalled();
 });
 it('marks a retry without releasing capacity before the final attempt',async()=>{
  const effects=actions();
  await expect(handleCampaignSendFailure(new Error('preparation failed'),{...finalAttempt,attemptsMade:0},effects)).rejects.toThrow('preparation failed');
  expect(effects.markRetry).toHaveBeenCalledTimes(1);expect(effects.releaseReservation).not.toHaveBeenCalled();
 });
});

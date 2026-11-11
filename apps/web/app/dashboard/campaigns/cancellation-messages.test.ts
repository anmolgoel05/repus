import {describe,expect,it} from 'vitest';
import {campaignCancellationPrompt,campaignCancellationResultMessage} from './cancellation-messages';

describe('campaign cancellation messages',()=>{
 it('distinguishes a scheduled campaign from one that may have an active provider request',()=>{
  expect(campaignCancellationPrompt('SCHEDULED')).toContain('Cancel this scheduled campaign');
  expect(campaignCancellationPrompt('QUEUED')).toContain('may still be accepted');
 });
 it('explains the worker interruption and uncertain provider outcome',()=>{
  expect(campaignCancellationResultMessage('QUEUED',true)).toContain('SES may already have accepted a message');
  expect(campaignCancellationResultMessage('PAUSED',false)).toContain('could not confirm a worker interruption');
  expect(campaignCancellationResultMessage('SCHEDULED',false)).toContain('quota released');
 });
});

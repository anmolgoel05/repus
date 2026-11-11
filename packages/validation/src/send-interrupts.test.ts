import {describe,expect,it} from 'vitest';
import {SEND_INTERRUPT_CHANNEL,parseSendInterrupt} from './send-interrupts';

describe('provider send interruption messages',()=>{
 it('accepts only a global pause or a campaign-specific UUID signal',()=>{
  expect(SEND_INTERRUPT_CHANNEL).toBe('repus:send-interrupts');
  expect(parseSendInterrupt('{"scope":"all"}')).toEqual({scope:'all'});
  expect(parseSendInterrupt('{"scope":"campaign","campaignId":"123e4567-e89b-42d3-a456-426614174000"}')).toEqual({scope:'campaign',campaignId:'123e4567-e89b-42d3-a456-426614174000'});
  expect(parseSendInterrupt('{"scope":"tenant","tenantId":"123e4567-e89b-42d3-a456-426614174000"}')).toEqual({scope:'tenant',tenantId:'123e4567-e89b-42d3-a456-426614174000'});
  expect(parseSendInterrupt('{"scope":"campaign","campaignId":"not-a-uuid"}')).toBeNull();
  expect(parseSendInterrupt('{"scope":"all","campaignId":"123e4567-e89b-42d3-a456-426614174000"}')).toBeNull();
  expect(parseSendInterrupt('not-json')).toBeNull();
 });
});

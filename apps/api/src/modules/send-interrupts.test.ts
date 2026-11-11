import {afterEach,describe,expect,it,vi} from 'vitest';
import {SEND_INTERRUPT_CHANNEL} from '@repus/validation';
import {publishSendInterrupt} from './send-interrupts';

describe('Redis send-interrupt publishing',()=>{
 afterEach(()=>vi.restoreAllMocks());

 it('publishes the validated signal on the shared channel and closes its connection',async()=>{
  const publisher={publish:vi.fn().mockResolvedValue(2),quit:vi.fn().mockResolvedValue('OK'),disconnect:vi.fn()};
  const factory=vi.fn(()=>publisher as any);
  await expect(publishSendInterrupt({scope:'recipient',recipientId:'123e4567-e89b-42d3-a456-426614174000'},factory)).resolves.toBe(2);
  expect(factory).toHaveBeenCalledWith(expect.any(String),{maxRetriesPerRequest:1,connectTimeout:3000,commandTimeout:5000,lazyConnect:true});
  expect(publisher.publish).toHaveBeenCalledWith(SEND_INTERRUPT_CHANNEL,JSON.stringify({scope:'recipient',recipientId:'123e4567-e89b-42d3-a456-426614174000'}));
  expect(publisher.quit).toHaveBeenCalledOnce();
  expect(publisher.disconnect).not.toHaveBeenCalled();
 });

 it('returns an unavailable result and disconnects when Redis cannot publish',async()=>{
  const publisher={publish:vi.fn().mockRejectedValue(new Error('Redis unavailable')),quit:vi.fn(),disconnect:vi.fn()};
  const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  await expect(publishSendInterrupt({scope:'all'},()=>publisher as any)).resolves.toBeNull();
  expect(publisher.disconnect).toHaveBeenCalledOnce();
  expect(publisher.quit).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledWith('Could not publish provider-send interrupt to Redis.');
 });
});

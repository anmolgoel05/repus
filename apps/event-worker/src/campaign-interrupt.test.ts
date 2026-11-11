import {randomUUID} from 'node:crypto';
import IORedis from 'ioredis';
import {expect, it, vi} from 'vitest';
import {parseSendInterrupt, SEND_INTERRUPT_CHANNEL} from '@repus/validation';
import {publishCampaignInterrupt} from './campaign-interrupt';

const redisUrl = process.env.REDIS_URL;
const localRedis = redisUrl && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(redisUrl).hostname);

it.skipIf(!localRedis)('delivers the campaign pause signal through local Redis', async () => {
  const subscriber = new IORedis(redisUrl!, {lazyConnect: true, connectTimeout: 2000, commandTimeout: 2000, retryStrategy: () => null});
  const campaignId = randomUUID();
  const received = vi.fn();
  subscriber.on('message', (channel, payload) => {
    const signal = parseSendInterrupt(payload);
    if (channel === SEND_INTERRUPT_CHANNEL && signal?.scope === 'campaign' && signal.campaignId === campaignId) received(signal);
  });
  try {
    await subscriber.subscribe(SEND_INTERRUPT_CHANNEL);
    await publishCampaignInterrupt(subscriber, campaignId);
    await vi.waitFor(() => expect(received).toHaveBeenCalledExactlyOnceWith({scope: 'campaign', campaignId}));
  } finally {
    subscriber.disconnect();
  }
});

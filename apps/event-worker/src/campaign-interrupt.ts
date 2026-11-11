import type IORedis from 'ioredis';
import {SEND_INTERRUPT_CHANNEL, type SendInterrupt} from '@repus/validation';

export async function publishCampaignInterrupt(connection: IORedis, campaignId: string) {
  const publisher = connection.duplicate({
    lazyConnect: true, connectTimeout: 3000, commandTimeout: 5000,
    maxRetriesPerRequest: 1, retryStrategy: () => null,
  });
  const interrupt: SendInterrupt = {scope: 'campaign', campaignId};
  try {
    await publisher.publish(SEND_INTERRUPT_CHANNEL, JSON.stringify(interrupt));
  } finally {
    publisher.disconnect();
  }
}

import {expect, it, vi} from 'vitest';
import {createPollHeartbeat} from './poll-heartbeat';

it('limits successful poll heartbeats and identifies the queue without exposing its URL', () => {
  const emit = vi.fn<(line: string) => void>();
  const report = createPollHeartbeat('https://sqs.ap-south-1.amazonaws.com/123456789012/repus-ses-events', emit);
  report(1_000);
  report(60_999);
  report(61_000);

  expect(emit).toHaveBeenCalledTimes(2);
  const line = emit.mock.calls[0][0];
  expect(JSON.parse(line)).toEqual({
    _aws: {
      Timestamp: 1_000,
      CloudWatchMetrics: [{Namespace: 'Repus/Events', Dimensions: [['QueueName']], Metrics: [{Name: 'SqsPollHeartbeat', Unit: 'Count'}]}],
    },
    QueueName: 'repus-ses-events',
    SqsPollHeartbeat: 1,
  });
  expect(line).not.toContain('123456789012');
});

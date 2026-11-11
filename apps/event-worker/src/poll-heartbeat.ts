const heartbeatIntervalMs = 60_000;

export function createPollHeartbeat(queueUrl: string, emit: (line: string) => void) {
  const queueName = new URL(queueUrl).pathname.split('/').at(-1);
  let lastEmission = -Infinity;

  return (timestamp = Date.now()) => {
    if (timestamp - lastEmission < heartbeatIntervalMs) return;
    lastEmission = timestamp;
    emit(JSON.stringify({
      _aws: {
        Timestamp: timestamp,
        CloudWatchMetrics: [{
          Namespace: 'Repus/Events',
          Dimensions: [['QueueName']],
          Metrics: [{Name: 'SqsPollHeartbeat', Unit: 'Count'}],
        }],
      },
      QueueName: queueName,
      SqsPollHeartbeat: 1,
    }));
  };
}

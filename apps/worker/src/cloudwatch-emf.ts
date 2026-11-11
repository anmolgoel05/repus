export type QueueHealthSample={queueName:string;failed:number;waiting:number;active:number;delayed:number;available:boolean};
const queueNames=new Set(['repus-email-sending','repus-scheduled-campaigns','repus-csv-import','repus-provider-events']);

function count(value:number){return Number.isFinite(value)?Math.max(0,Math.floor(value)):0;}

export function createQueueHealthSnapshot(samples:QueueHealthSample[],checkedAt=new Date()){
 const boundedSamples=samples.filter(sample=>queueNames.has(sample.queueName));
 return {
  checkedAt,
  failedJobCount:boundedSamples.filter(sample=>sample.available).reduce((total,sample)=>total+count(sample.failed),0),
  healthCheckFailures:boundedSamples.filter(sample=>!sample.available).length,
  queues:boundedSamples.map(sample=>({
   name:sample.queueName,
   status:sample.available?'available':'unavailable',
   counts:sample.available?{waiting:count(sample.waiting),active:count(sample.active),delayed:count(sample.delayed),failed:count(sample.failed)}:null,
  })),
 };
}

export function queueHealthMetricEvents(samples:QueueHealthSample[],timestamp=Date.now()){
 const boundedSamples=samples.filter(sample=>queueNames.has(sample.queueName));
 const events:Record<string,unknown>[]=boundedSamples.map(sample=>({
  _aws:{Timestamp:timestamp,CloudWatchMetrics:[{Namespace:'Repus/Queues',Dimensions:[['QueueName']],Metrics:[
   {Name:'FailedJobs',Unit:'Count'},{Name:'WaitingJobs',Unit:'Count'},{Name:'ActiveJobs',Unit:'Count'},{Name:'DelayedJobs',Unit:'Count'},{Name:'QueueHealthCheckFailures',Unit:'Count'},
  ]}]},
  QueueName:sample.queueName,
  ...(sample.available?{FailedJobs:count(sample.failed),WaitingJobs:count(sample.waiting),ActiveJobs:count(sample.active),DelayedJobs:count(sample.delayed)}:{}),
  QueueHealthCheckFailures:sample.available?0:1,
 }));
 events.push({
  _aws:{Timestamp:timestamp,CloudWatchMetrics:[{Namespace:'Repus/Queues',Dimensions:[[]],Metrics:[
   {Name:'TotalFailedJobs',Unit:'Count'},{Name:'QueueHealthCheckFailures',Unit:'Count'},{Name:'WorkerMetricsHeartbeat',Unit:'Count'},
  ]}]},
  TotalFailedJobs:boundedSamples.filter(sample=>sample.available).reduce((total,sample)=>total+count(sample.failed),0),
  QueueHealthCheckFailures:boundedSamples.filter(sample=>!sample.available).length,
  WorkerMetricsHeartbeat:1,
 });
 return events;
}

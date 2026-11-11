import {describe,expect,it} from 'vitest';
import {createQueueHealthSnapshot,queueHealthMetricEvents} from './cloudwatch-emf';

describe('queue health embedded metrics',()=>{
 it('emits only bounded queue names and aggregate counts, without tenant data',()=>{
  const events=queueHealthMetricEvents([
   {queueName:'repus-email-sending',failed:12,waiting:5,active:1,delayed:0,available:true},
   {queueName:'repus-provider-events',failed:2,waiting:0,active:1,delayed:0,available:true},
  ],1234);
  expect(events[0]).toMatchObject({QueueName:'repus-email-sending',FailedJobs:12,WaitingJobs:5,QueueHealthCheckFailures:0,_aws:{Timestamp:1234}});
  expect(events[2]).toMatchObject({TotalFailedJobs:14,QueueHealthCheckFailures:0,WorkerMetricsHeartbeat:1,_aws:{CloudWatchMetrics:[{Namespace:'Repus/Queues',Dimensions:[[]]}]}});
  expect(events.some(event=>'tenantId' in event||'recipient' in event||'email' in event)).toBe(false);
  expect(JSON.stringify(events)).not.toContain('@');
 });
 it('reports unavailable queue checks as alarms instead of false zero failure counts',()=>{
  const [queue,aggregate]=queueHealthMetricEvents([{queueName:'repus-email-sending',failed:0,waiting:0,active:0,delayed:0,available:false}],1234);
  expect(queue).toMatchObject({QueueName:'repus-email-sending',QueueHealthCheckFailures:1});
  expect(queue).not.toHaveProperty('FailedJobs');
  expect(aggregate).toMatchObject({TotalFailedJobs:0,QueueHealthCheckFailures:1});
 });
 it('drops unknown queue names so metric dimensions cannot grow without bound',()=>{
  const events=queueHealthMetricEvents([
   {queueName:'tenant-1234-send-queue',failed:500,waiting:0,active:0,delayed:0,available:true},
   {queueName:'repus-email-sending',failed:-1,waiting:0,active:0,delayed:0,available:true},
  ],1234);
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({QueueName:'repus-email-sending',FailedJobs:0});
  expect(events[1]).toMatchObject({TotalFailedJobs:0,QueueHealthCheckFailures:0});
  expect(JSON.stringify(events)).not.toContain('tenant-1234');
 });
 it('builds a bounded persisted health snapshot with unavailable queues represented explicitly',()=>{
  const checkedAt=new Date('2026-10-30T00:00:00.000Z');
  const snapshot=createQueueHealthSnapshot([
   {queueName:'repus-email-sending',failed:3,waiting:4,active:1,delayed:2,available:true},
   {queueName:'repus-provider-events',failed:0,waiting:0,active:0,delayed:0,available:false},
   {queueName:'workspace-secret-queue',failed:100,waiting:0,active:0,delayed:0,available:true},
  ],checkedAt);
  expect(snapshot).toEqual({checkedAt,failedJobCount:3,healthCheckFailures:1,queues:[
   {name:'repus-email-sending',status:'available',counts:{waiting:4,active:1,delayed:2,failed:3}},
   {name:'repus-provider-events',status:'unavailable',counts:null},
  ]});
 });
});

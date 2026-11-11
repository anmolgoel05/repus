import {describe,expect,it} from 'vitest';
import {assertEventWorkerConfig,assertProductionSesQueueUrl,assertProductionSesTopicArn} from './production-preflight';

describe('event worker startup configuration',()=>{
 const production={
  NODE_ENV:'production',
  EMAIL_PROVIDER:'ses',
  DATABASE_URL:'postgresql://worker@db.internal/repus',
  REDIS_URL:'redis://cache.internal:6379',
  AWS_REGION:'ap-south-1',
  AWS_SES_SQS_URL:'https://sqs.ap-south-1.amazonaws.com/123456789012/repus-events',
  AWS_SES_SNS_TOPIC_ARN:'arn:aws:sns:ap-south-1:123456789012:repus-events',
 };

 it('accepts production SES configuration and credential-free development',()=>{
  expect(()=>assertEventWorkerConfig(production)).not.toThrow();
  expect(()=>assertEventWorkerConfig({NODE_ENV:'development'})).not.toThrow();
 });

 it.each([
  ['DATABASE_URL','postgresql://worker@localhost/repus'],
  ['EMAIL_PROVIDER','development'],
  ['AWS_SES_SQS_URL',undefined],
  ['AWS_SES_SQS_URL','https://example.com/123456789012/repus-events'],
  ['AWS_SES_SNS_TOPIC_ARN',undefined],
  ['AWS_SES_SNS_TOPIC_ARN','arn:aws:sns:us-east-1:123456789012:repus-events'],
 ])('rejects invalid production %s', (key,value)=>{
  expect(()=>assertEventWorkerConfig({...production,[key]:value})).toThrow(key);
 });
});

describe('production SES queue URL',()=>{
 it.each([
  'https://sqs.ap-south-1.amazonaws.com/123456789012/repus-events',
  'https://sqs.ap-south-1.amazonaws.com/123456789012/repus-events.fifo',
 ])('accepts %s',url=>expect(()=>assertProductionSesQueueUrl(url,'ap-south-1')).not.toThrow());

 it.each([
  'https://sqs.ap-south-1.amazonaws.com/',
  'https://sqs.ap-south-1.amazonaws.com/123456789012/repus/events',
  'https://sqs.ap-south-1.amazonaws.com/123/repus-events',
  'https://sqs.us-east-1.amazonaws.com/123456789012/repus-events',
 ])('rejects %s',url=>expect(()=>assertProductionSesQueueUrl(url,'ap-south-1')).toThrow('AWS_SES_SQS_URL'));
});

describe('production SES notification topic',()=>{
 it('accepts a concrete topic in the configured region',()=>{
  expect(()=>assertProductionSesTopicArn('arn:aws:sns:ap-south-1:123456789012:repus-events','ap-south-1')).not.toThrow();
 });
 it.each([
  'arn:aws:sns:us-east-1:123456789012:repus-events',
  'arn:aws:sqs:ap-south-1:123456789012:repus-events',
  'arn:aws:sns:ap-south-1:123456789012:repus-*',
  'arn:aws:sns:ap-south-1:123456789012:repus-events:subscription',
 ])('rejects %s',arn=>expect(()=>assertProductionSesTopicArn(arn,'ap-south-1')).toThrow('AWS_SES_SNS_TOPIC_ARN'));
});

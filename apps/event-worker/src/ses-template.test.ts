import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const template=readFileSync(resolve(__dirname,'../../../infrastructure/aws/ses-events.yaml'),'utf8');

describe('SES event destination configuration',()=>{
 it('grants scoped service encryption on a rotating customer-managed SNS key',()=>{
  const key=template.slice(template.indexOf('  RepusNotificationsKey:'),template.indexOf('  SesConfigurationSet:'));
  expect(key).toContain('Type: AWS::KMS::Key');
  expect(key).toContain('EnableKeyRotation: true');
  expect(key).toContain('DeletionPolicy: Retain');
  expect(key).toContain('Service: ses.amazonaws.com');
  expect(key).toContain('Service: cloudwatch.amazonaws.com');
  expect(key.match(/aws:SourceAccount: !Ref AWS::AccountId/g)).toHaveLength(2);
  expect(key).toContain('configuration-set/${ConfigurationSetName}');
  expect(key).toContain('alarm:${ResourcePrefix}-*');
  expect(key.match(/kms:GenerateDataKey\*/g)).toHaveLength(2);
  expect(key.match(/kms:Decrypt/g)).toHaveLength(2);
  expect(template.match(/KmsMasterKeyId: !GetAtt RepusNotificationsKey.Arn/g)).toHaveLength(2);
  expect(template).not.toContain('alias/aws/sns');
 });
 it('uses Repus tracking as the only open and click analytics source',()=>{
  expect(template).toMatch(/SnsDestination:\r?\n\s+TopicARN: !Ref SesEventsTopic/);
  const match=template.match(/MatchingEventTypes:\r?\n((?:\s+-\s+[A-Z_]+\r?\n)+)/);
  expect(match,'CloudFormation SES event types must be present').toBeTruthy();
  const events=match![1].match(/[A-Z_]+/g)??[];
  expect(events).toEqual(['SEND','REJECT','BOUNCE','COMPLAINT','DELIVERY','DELIVERY_DELAY','SUBSCRIPTION','RENDERING_FAILURE']);
  expect(events).not.toContain('OPEN');
  expect(events).not.toContain('CLICK');
 });
 it('limits application SES identity access to the configured explicit ARN list',()=>{
  const worker=template.slice(template.indexOf('  RepusSesApplicationPolicy:'),template.indexOf('  RepusApiSesReadPolicy:'));
  const api=template.slice(template.indexOf('  RepusApiSesReadPolicy:'),template.indexOf('  RepusEventWorkerPolicy:'));
  expect(worker).toContain('ses:SendEmail');
  expect(worker).not.toContain('ses:GetEmailIdentity');
  expect(api).toContain('ses:GetEmailIdentity');
  expect(api).not.toContain('ses:SendEmail');
  for(const policy of [worker,api]){
   expect(policy).toContain('Resource: !Ref SendingIdentityArns');
   expect(policy).toContain('ses:GetAccount');
  }
  expect(template).toContain('ApiSesReadPolicyArn:');
  expect(template).toContain('SendingIdentityArns:');
  expect(template).toMatch(/AllowedPattern: '\^arn:\[A-Za-z0-9-\]\+:ses:/);
  expect(template).toMatch(/identity\/\[A-Za-z0-9\._@\+-\]\+\$'/);
  expect(template).toMatch(/Resource:\s*!Ref SendingIdentityArns/);
  expect(template).not.toContain('ses:CreateEmailIdentity');
  expect(template).not.toMatch(/identity\/\*/);
 });
 it('alerts operations when provider events age in the queue or reach the dead-letter queue',()=>{
  expect(template).toContain('MetricName: ApproximateAgeOfOldestMessage');
  expect(template).toContain('Threshold: 300');
  expect(template).toContain('MetricName: ApproximateNumberOfMessagesVisible');
  expect(template).toContain('SesEventDeadLetterAlarm:');
  expect(template).toContain('AllowScopedCloudWatchAlarms');
  expect(template).toContain('Service: cloudwatch.amazonaws.com');
  expect(template).toContain('OperationsAlertTopicArn:');
  expect(template).toContain('Protocol: email');
  expect(template).toContain('MetricName: Reputation.BounceRate');
  expect(template).toContain('MetricName: Reputation.ComplaintRate');
  expect(template).toContain('BounceRateAlarmThreshold');
  expect(template).toContain('ComplaintRateAlarmThreshold');
 });
 it('routes aggregate queue and sanitized API error metrics to operations alarms',()=>{
  expect(template).toContain('MetricName: TotalFailedJobs');
  expect(template).toContain('MetricName: QueueHealthCheckFailures');
  expect(template).toContain('MetricName: WorkerMetricsHeartbeat');
  expect(template).toContain('MetricName: ServerErrors');
  expect(template).toContain('Namespace: Repus/Queues');
  expect(template).toContain('Namespace: Repus/API');
  expect(template).toContain('AlarmName: !Sub \'${ResourcePrefix}-worker-metrics-missing\'');
  expect(template).toContain('TreatMissingData: breaching');
 });
 it('alarms on a missing successful poll heartbeat for the configured queue',()=>{
  const alarm=template.slice(template.indexOf('  SesEventPollHeartbeatAlarm:'),template.indexOf('  SesEventDeadLetterAlarm:'));
  expect(alarm).toContain('Namespace: Repus/Events');
  expect(alarm).toContain('MetricName: SqsPollHeartbeat');
  expect(alarm).toContain('Name: QueueName');
  expect(alarm).toContain('Value: !GetAtt SesEventsQueue.QueueName');
  expect(alarm).toContain('TreatMissingData: breaching');
  expect(alarm).toContain('AlarmActions: [!Ref RepusOperationsAlertTopic]');
 });
});

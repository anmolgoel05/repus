import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {canonicalSnsMessage,SnsEnvelope,SnsVerificationError,verifySnsNotification} from './sns-verification';

const topicArn='arn:aws:sns:us-east-1:123456789012:repus-ses-events';
function signedNotification(signatureVersion:'1'|'2'='2'){
 const pair=generateKeyPairSync('rsa',{modulusLength:2048});
 const message:SnsEnvelope={Type:'Notification',Message:JSON.stringify({eventType:'Delivery',mail:{messageId:'ses-message'}}),MessageId:randomUUID(),Timestamp:new Date().toISOString(),TopicArn:topicArn,SignatureVersion:signatureVersion,SigningCertURL:`https://sns.us-east-1.amazonaws.com/SimpleNotificationService-${randomUUID()}.pem`};
 const signer=createSign(signatureVersion==='1'?'RSA-SHA1':'RSA-SHA256');signer.update(canonicalSnsMessage(message),'utf8');signer.end();message.Signature=signer.sign(pair.privateKey).toString('base64');
 const publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString();
 const fetcher=async(_url:RequestInfo|URL,init?:RequestInit)=>{if(init?.redirect!=='error')throw new Error('certificate redirects must be disabled');return new Response(publicKey);};
 return {message,fetcher};
}

describe('SES SNS message verification',()=>{
 it('uses the SNS canonical notification field order',()=>{
  expect(canonicalSnsMessage({Type:'Notification',Message:'body',MessageId:'message-id',Subject:'subject',Timestamp:'time',TopicArn:'topic'})).toBe('Message\nbody\nMessageId\nmessage-id\nSubject\nsubject\nTimestamp\ntime\nTopicArn\ntopic\nType\nNotification\n');
 });
 it('verifies an SNS signature before accepting the notification payload',async()=>{
  const {message,fetcher}=signedNotification();
  await expect(verifySnsNotification(message,{topicArn,region:'us-east-1',fetcher})).resolves.toBe(true);
 });
 it('supports the legacy SNS RSA-SHA1 signature version',async()=>{
  const {message,fetcher}=signedNotification('1');
  await expect(verifySnsNotification(message,{topicArn,region:'us-east-1',fetcher})).resolves.toBe(true);
 });
 it('rejects a changed payload, unexpected topic, and non-AWS certificate URL',async()=>{
  const changed=signedNotification();changed.message.Message=JSON.stringify({eventType:'Complaint'});
  await expect(verifySnsNotification(changed.message,{topicArn,region:'us-east-1',fetcher:changed.fetcher})).rejects.toThrow('signature verification failed');
  const wrongTopic=signedNotification();wrongTopic.message.TopicArn='arn:aws:sns:us-east-1:999999999999:other';
  await expect(verifySnsNotification(wrongTopic.message,{topicArn,region:'us-east-1',fetcher:wrongTopic.fetcher})).rejects.toThrow('unexpected topic');
  const badCertificate=signedNotification();badCertificate.message.SigningCertURL='https://example.test/certificate.pem';
  await expect(verifySnsNotification(badCertificate.message,{topicArn,region:'us-east-1',fetcher:badCertificate.fetcher})).rejects.toThrow('approved AWS endpoint');
 });
 it('marks certificate retrieval failures retryable for SQS redelivery',async()=>{
  const {message}=signedNotification();
  const fetcher=async()=>{throw new Error('network unavailable');};
  await expect(verifySnsNotification(message,{topicArn,region:'us-east-1',fetcher})).rejects.toMatchObject({retryable:true});
 });
 it('cancels an oversized certificate stream before it finishes downloading',async()=>{
  const {message}=signedNotification();
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({
   pull(controller){controller.enqueue(new Uint8Array(10_001));},
   cancel(){cancelled=true;},
  });
  await expect(verifySnsNotification(message,{topicArn,region:'us-east-1',fetcher:async()=>new Response(body)})).rejects.toThrow('response is too large');
  expect(cancelled).toBe(true);
 });
 it('rejects a malformed envelope before fetching its certificate',async()=>{
  const {message}=signedNotification();
  delete message.Timestamp;
  let fetched=false;
  const fetcher=async()=>{fetched=true;return new Response('unused');};
  await expect(verifySnsNotification(message,{topicArn,region:'us-east-1',fetcher})).rejects.toThrow('missing Timestamp');
  expect(fetched).toBe(false);
 });
 it('does not auto-confirm SNS subscriptions',async()=>{
  const {message}=signedNotification();message.Type='SubscriptionConfirmation';
  await expect(verifySnsNotification(message,{topicArn,region:'us-east-1',fetcher:async()=>{throw new Error('must not fetch');}})).rejects.toBeInstanceOf(SnsVerificationError);
 });
});

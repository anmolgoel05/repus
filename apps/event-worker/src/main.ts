import {assertEventWorkerConfig} from './production-preflight';
import {Worker} from 'bullmq';
import IORedis from 'ioredis';
import {ChangeMessageVisibilityCommand,DeleteMessageCommand,ReceiveMessageCommand,SQSClient} from '@aws-sdk/client-sqs';
import {processProviderEvent,closeProviderEventDatabase} from './processor';
import {SnsVerificationError,verifySnsNotification} from './sns-verification';
import {withVisibilityLease} from './visibility-lease';
import {createPollHeartbeat} from './poll-heartbeat';
import {publishCampaignInterrupt} from './campaign-interrupt';
assertEventWorkerConfig(process.env);
const sqsUrl=process.env.AWS_SES_SQS_URL;
const sqs=sqsUrl?new SQSClient({region:process.env.AWS_REGION}):undefined;
const reportPollHeartbeat=process.env.NODE_ENV==='production'&&sqsUrl?createPollHeartbeat(sqsUrl,line=>console.info(line)):undefined;
const connection=new IORedis(process.env.REDIS_URL??'redis://localhost:6379',{maxRetriesPerRequest:null});
connection.on('error',()=>console.error('Provider event Redis connection failed.'));
const interruptCampaign=(campaignId:string)=>publishCampaignInterrupt(connection,campaignId);
const worker=new Worker('repus-provider-events',async job=>{
 try{return await processProviderEvent(job.data,interruptCampaign);}
 catch{
  // BullMQ retains the thrown error. Keep payloads and database error details out of Redis.
  throw new Error('Provider event processing failed.');
 }
},{connection,concurrency:4});
worker.on('error',()=>console.error('Provider event queue worker encountered an infrastructure error.'));
let stopping=false;
const pollController=new AbortController();
const pollTimeoutMs=30_000;
const receiptWriteTimeoutMs=15_000;
async function processSqsMessage(message:{Body?:string;ReceiptHandle?:string}){
 if(!sqs||!sqsUrl||!message.Body||!message.ReceiptHandle)return;
 try{
  await withVisibilityLease(async()=>{
   const envelope=JSON.parse(message.Body!);
   await verifySnsNotification(envelope,{topicArn:process.env.AWS_SES_SNS_TOPIC_ARN??'',region:process.env.AWS_REGION??''});
   const payload=JSON.parse(envelope.Message);
   const providerEventId=envelope.MessageId;
   if(typeof providerEventId!=='string'||!providerEventId)throw new Error('Verified SNS notification has no message ID.');
   await processProviderEvent({providerEventId,provider:'ses',eventType:payload.eventType??payload.notificationType,payload},interruptCampaign);
   await sqs!.send(new DeleteMessageCommand({QueueUrl:sqsUrl!,ReceiptHandle:message.ReceiptHandle!}),{abortSignal:AbortSignal.timeout(receiptWriteTimeoutMs)});
  },()=>sqs!.send(new ChangeMessageVisibilityCommand({QueueUrl:sqsUrl!,ReceiptHandle:message.ReceiptHandle!,VisibilityTimeout:120}),{abortSignal:AbortSignal.timeout(receiptWriteTimeoutMs)}),()=>console.error('Could not extend visibility for an SES event message.'));
 }catch(error){
  const stage=error instanceof SnsVerificationError?'SNS verification':error instanceof SyntaxError?'notification parsing':'event processing';
  console.error(`SES ${stage} failed. The message remains available for SQS retry.`);
 }
}
async function pollSqs(){
 if(!sqs||!sqsUrl)return;
 while(!stopping){
  try{
   const abortSignal=AbortSignal.any([pollController.signal,AbortSignal.timeout(pollTimeoutMs)]);
   const response=await sqs.send(new ReceiveMessageCommand({QueueUrl:sqsUrl,WaitTimeSeconds:20,MaxNumberOfMessages:4,VisibilityTimeout:120}),{abortSignal});
   if(!stopping)reportPollHeartbeat?.();
   await Promise.all((response.Messages??[]).map(processSqsMessage));
  }catch{if(stopping)break;console.error('SES SQS poll failed.');await new Promise(resolve=>setTimeout(resolve,5000));}
 }
}
const pollPromise=pollSqs();
console.info(`Repus event worker started.${sqsUrl?' SES SQS polling enabled.':' Configure AWS_SES_SQS_URL to process production SES events.'}`);
let shutdownPromise:Promise<void>|undefined;
function shutdown(){
 if(shutdownPromise)return shutdownPromise;
 shutdownPromise=(async()=>{
  stopping=true;
  pollController.abort();
  const drained=await Promise.allSettled([worker.close(),pollPromise]);
  for(const result of drained)if(result.status==='rejected'){console.error('Event worker did not drain cleanly.');process.exitCode=1;}
  const closed=await Promise.allSettled([connection.quit(),sqs?.destroy(),closeProviderEventDatabase()]);
  for(const result of closed)if(result.status==='rejected'){console.error('Event worker resource did not close cleanly.');process.exitCode=1;}
 })();
 return shutdownPromise;
}
process.on('SIGINT',()=>{void shutdown()});process.on('SIGTERM',()=>{void shutdown()});

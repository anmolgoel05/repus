import {assertProductionInfrastructureConfig} from '@repus/validation';

export function assertEventWorkerConfig(env:Record<string,string|undefined>){
 assertProductionInfrastructureConfig(env);
 const {AWS_SES_SQS_URL:queueUrl,AWS_SES_SNS_TOPIC_ARN:topicArn,AWS_REGION:region}=env;
 const production=env.NODE_ENV==='production';
 if(production&&env.EMAIL_PROVIDER!=='ses')throw new Error('EMAIL_PROVIDER=ses is required in production.');
 if(!queueUrl){
  if(production)throw new Error('AWS_SES_SQS_URL is required for production SES event processing.');
  return;
 }
 if(!region||!topicArn)throw new Error('AWS_REGION and AWS_SES_SNS_TOPIC_ARN are required when AWS_SES_SQS_URL is configured.');
 if(production){
  assertProductionSesQueueUrl(queueUrl,region);
  assertProductionSesTopicArn(topicArn,region);
 }
}

export function assertProductionSesQueueUrl(value:string,region:string){
 const suffix=region.startsWith('cn-')?'amazonaws.com.cn':'amazonaws.com';
 let queueUrl:URL;
 try{queueUrl=new URL(value);}catch{throw new Error('AWS_SES_SQS_URL must be a valid SQS queue URL.');}
 if(queueUrl.protocol!=='https:'||queueUrl.hostname!==`sqs.${region}.${suffix}`||queueUrl.port||queueUrl.username||queueUrl.password||queueUrl.search||queueUrl.hash){
  throw new Error('AWS_SES_SQS_URL must use the HTTPS SQS endpoint for AWS_REGION.');
 }
 if(!/^\/\d{12}\/[A-Za-z0-9_-]{1,80}(?:\.fifo)?$/.test(queueUrl.pathname)||queueUrl.pathname.split('/')[2].length>80){
  throw new Error('AWS_SES_SQS_URL must include an AWS account ID and queue name.');
 }
}

export function assertProductionSesTopicArn(value:string,region:string){
 const partition=region.startsWith('cn-')?'aws-cn':region.startsWith('us-gov-')?'aws-us-gov':'aws';
 const [prefix,arnPartition,service,arnRegion,account,topic,...extra]=value.split(':');
 if(prefix!=='arn'||arnPartition!==partition||service!=='sns'||arnRegion!==region||
    !/^\d{12}$/.test(account??'')||!topic||topic.length>256||!/^[A-Za-z0-9_-]+(?:\.fifo)?$/.test(topic)||extra.length){
  throw new Error('AWS_SES_SNS_TOPIC_ARN must identify a concrete SNS topic in AWS_REGION.');
 }
}

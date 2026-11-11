import {createVerify,X509Certificate} from 'node:crypto';

export type SnsEnvelope={
 Type?:string;Message?:string;MessageId?:string;Subject?:string;Timestamp?:string;TopicArn?:string;
 Signature?:string;SignatureVersion?:string;SigningCertURL?:string;
 SubscribeURL?:string;Token?:string;
};

export class SnsVerificationError extends Error{
 readonly retryable:boolean;
 constructor(message:string,retryable=false){super(message);this.name='SnsVerificationError';this.retryable=retryable;}
}

const certificates=new Map<string,{pem:string;expiresAt:number}>();
const MAX_CERTIFICATE_BYTES=20_000;
const MAX_CACHED_CERTIFICATES=32;

export function canonicalSnsMessage(message:SnsEnvelope){
 const fields=message.Type==='Notification'
  ?['Message','MessageId',...(message.Subject===undefined?[]:['Subject']),'Timestamp','TopicArn','Type']
  :message.Type==='SubscriptionConfirmation'||message.Type==='UnsubscribeConfirmation'
   ?['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type']
   :[];
 if(!fields.length)throw new SnsVerificationError('Unsupported SNS message type.');
 let canonical='';
 for(const field of fields){const value=message[field as keyof SnsEnvelope];if(typeof value!=='string')throw new SnsVerificationError(`SNS message is missing ${field}.`);canonical+=`${field}\n${value}\n`;}
 return canonical;
}

function validateCertificateUrl(raw:string,region:string){
 let url:URL;try{url=new URL(raw);}catch{throw new SnsVerificationError('SNS signing certificate URL is invalid.');}
 const suffix=region.startsWith('cn-')?'amazonaws.com.cn':'amazonaws.com';
 if(url.protocol!=='https:'||url.hostname!==`sns.${region}.${suffix}`||url.port||url.username||url.password||url.search||url.hash||!/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname))throw new SnsVerificationError('SNS signing certificate URL is not an approved AWS endpoint.');
 return url;
}

async function signingCertificate(rawUrl:string,region:string,fetcher:typeof fetch){
 const url=validateCertificateUrl(rawUrl,region).toString();const cached=certificates.get(url);if(cached&&cached.expiresAt>Date.now())return cached.pem;
 let response:Response;try{response=await fetcher(url,{signal:AbortSignal.timeout(5000),redirect:'error'});}catch{throw new SnsVerificationError('Could not retrieve the SNS signing certificate.',true);}
 if(!response.ok){
  void response.body?.cancel().catch(()=>{});
  throw new SnsVerificationError(`SNS signing certificate request failed (${response.status}).`,true);
 }
 const reader=response.body?.getReader();
 if(!reader)throw new SnsVerificationError('SNS signing certificate response is empty.');
 const chunks:Uint8Array[]=[];
 let bytes=0;
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   bytes+=value.byteLength;
   if(bytes>MAX_CERTIFICATE_BYTES)throw new SnsVerificationError('SNS signing certificate response is too large.');
   chunks.push(value);
  }
 }catch(error){
  void reader.cancel().catch(()=>{});
  if(error instanceof SnsVerificationError)throw error;
  throw new SnsVerificationError('Could not read the SNS signing certificate.',true);
 }finally{reader.releaseLock();}
 const pem=Buffer.concat(chunks,bytes).toString('utf8');
 if(!pem.includes('-----BEGIN CERTIFICATE-----')&&!pem.includes('-----BEGIN PUBLIC KEY-----'))throw new SnsVerificationError('SNS signing certificate response is invalid.');
 const now=Date.now();
 let expiresAt=now+6*60*60*1000;
 if(pem.includes('-----BEGIN CERTIFICATE-----')){
  try{
   const certificate=new X509Certificate(pem);
   expiresAt=Math.min(expiresAt,Date.parse(certificate.validTo));
   if(Date.parse(certificate.validFrom)>now||expiresAt<=now)throw new Error('expired');
  }catch{throw new SnsVerificationError('SNS signing certificate is invalid or outside its validity period.');}
 }
 certificates.delete(url);
 if(certificates.size>=MAX_CACHED_CERTIFICATES){
  const oldest=certificates.keys().next().value;
  if(oldest)certificates.delete(oldest);
 }
 certificates.set(url,{pem,expiresAt});
 return pem;
}

export async function verifySnsNotification(message:SnsEnvelope,options:{topicArn:string;region:string;fetcher?:typeof fetch}){
 if(message.Type!=='Notification')throw new SnsVerificationError('Only SNS notifications are accepted; confirm subscriptions outside the event worker.');
 if(!options.topicArn||!options.region)throw new SnsVerificationError('Configure AWS_SES_SNS_TOPIC_ARN and AWS_REGION before processing SES notifications.');
 if(message.TopicArn!==options.topicArn)throw new SnsVerificationError('SNS notification came from an unexpected topic.');
 const arnParts=message.TopicArn.split(':');
 if(arnParts.length!==6||arnParts[2]!=='sns'||arnParts[3]!==options.region)throw new SnsVerificationError('SNS notification came from an unexpected topic.');
 if(!message.Signature||!message.SigningCertURL||!['1','2'].includes(message.SignatureVersion??''))throw new SnsVerificationError('SNS signature fields are missing or unsupported.');
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(message.Signature))throw new SnsVerificationError('SNS signature encoding is invalid.');
 const canonical=canonicalSnsMessage(message);
 const certificate=await signingCertificate(message.SigningCertURL,options.region,options.fetcher??fetch);
 let valid:boolean;try{const verifier=createVerify(message.SignatureVersion==='1'?'RSA-SHA1':'RSA-SHA256');verifier.update(canonical,'utf8');verifier.end();valid=verifier.verify(certificate,Buffer.from(message.Signature,'base64'));}catch{valid=false;}
 if(!valid)throw new SnsVerificationError('SNS notification signature verification failed.');
 return true;
}

import { SESv2Client, SendEmailCommand, GetAccountCommand } from '@aws-sdk/client-sesv2';
import {nonNegativeIntegerConfig} from '@repus/validation';
import {ProviderOutcomeUnknownError,ProviderSubmissionError,providerResponseIsAmbiguous,providerSendFailureDisposition} from './provider-failure';
import {createSesSendSignal} from './send-timeout';
export {ProviderOutcomeUnknownError,providerResponseIsAmbiguous,providerSendFailureDisposition,shouldRetryProviderSend} from './provider-failure';

export interface SendEmailInput { to: string; from: string; fromName?: string; replyTo?: string; subject: string; html: string; text: string; tags: Record<string,string>; headers?: {name:string;value:string}[]; }
export interface SendEmailOptions { signal?:AbortSignal; }
export interface SendEmailResult { messageId: string; acceptedAt: Date; }
export interface SendingQuota { max24HourSend: number; sentLast24Hours: number; maxSendRate: number; productionAccess: boolean; }
export interface EmailProvider {
  sendEmail(input: SendEmailInput, options?:SendEmailOptions): Promise<SendEmailResult>;
  getSendingQuota(): Promise<SendingQuota>;
}

export class DevelopmentEmailProvider implements EmailProvider {
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    if (process.env.NODE_ENV === 'production') throw new Error('Development email adapter is disabled in production.');
    const messageId = `dev-${crypto.randomUUID()}`;
    console.info(JSON.stringify({ type:'development_email_accepted', messageId, tags:input.tags, note:'No email was sent. Configure SES for delivery.' }));
    return { messageId, acceptedAt:new Date() };
  }
  async getSendingQuota() { return { max24HourSend:nonNegativeIntegerConfig(process.env.PLATFORM_DAILY_SEND_LIMIT,2500,'PLATFORM_DAILY_SEND_LIMIT'), sentLast24Hours:0, maxSendRate:1, productionAccess:false }; }
}

export class AmazonSesProvider implements EmailProvider {
  private client = new SESv2Client({ region:process.env.AWS_REGION,maxAttempts:1 });
  async sendEmail(input:SendEmailInput,options:SendEmailOptions={}):Promise<SendEmailResult>{
    let messageId:string|undefined;const signal=createSesSendSignal(options.signal);
    try{const result=await this.client.send(new SendEmailCommand({
      FromEmailAddress: input.fromName ? `${input.fromName.replace(/[\r\n<>]/g,'')} <${input.from}>` : input.from,
      Destination:{ToAddresses:[input.to]}, ReplyToAddresses:input.replyTo?[input.replyTo]:undefined,
      Content:{Simple:{Subject:{Data:input.subject,Charset:'UTF-8'},Body:{Html:{Data:input.html,Charset:'UTF-8'},Text:{Data:input.text,Charset:'UTF-8'}},Headers:input.headers?.map(h=>({Name:h.name,Value:h.value}))}},
      ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,
      EmailTags:Object.entries(input.tags).map(([Name,Value])=>({Name,Value})),
    }),{abortSignal:signal});messageId=result.MessageId;}catch(error){
      // SDK errors can include recipient data and must not reach logs or stored job errors.
      if(signal.aborted)throw new ProviderOutcomeUnknownError('The SES request timed out or was interrupted. Provider acceptance cannot be confirmed.');
      const disposition=providerSendFailureDisposition(error);
      if(disposition==='ambiguous'||providerResponseIsAmbiguous(error))throw new ProviderOutcomeUnknownError();
      throw new ProviderSubmissionError(disposition);
    }
    if(!messageId) throw new ProviderOutcomeUnknownError('SES returned success without a message ID.');
    return {messageId,acceptedAt:new Date()};
  }
  async getSendingQuota():Promise<SendingQuota>{
    const result=await this.client.send(new GetAccountCommand({})); const q=result.SendQuota;
    return {max24HourSend:q?.Max24HourSend??0,sentLast24Hours:q?.SentLast24Hours??0,maxSendRate:q?.MaxSendRate??0,productionAccess:result.ProductionAccessEnabled??false};
  }
}

export function createEmailProvider():EmailProvider {
  if(process.env.EMAIL_PROVIDER==='ses') return new AmazonSesProvider();
  if(process.env.NODE_ENV==='production') throw new Error('EMAIL_PROVIDER=ses is required in production.');
  return new DevelopmentEmailProvider();
}

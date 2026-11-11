import { afterEach, describe,expect,it,vi } from 'vitest';
import { SESv2Client,SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DevelopmentEmailProvider,ProviderOutcomeUnknownError,providerResponseIsAmbiguous,providerSendFailureDisposition,shouldRetryProviderSend } from './email-provider';

afterEach(()=>vi.unstubAllEnvs());

it('prevents deployment retry defaults from silently resubmitting ambiguous SES sends',async()=>{
 vi.stubEnv('AWS_MAX_ATTEMPTS','8');
 const provider=new (await import('./email-provider')).AmazonSesProvider();
 const client=(provider as unknown as {client:SESv2Client}).client;
 try{expect(await client.config.maxAttempts()).toBe(1);}finally{client.destroy();}
});

describe('DevelopmentEmailProvider',()=>{
  it('returns a clearly marked local acceptance without requiring AWS',async()=>{
    vi.stubEnv('NODE_ENV','development');
    const result=await new DevelopmentEmailProvider().sendEmail({to:'test@example.com',from:'sender@example.com',subject:'Test',html:'<p>Hello</p>',text:'Hello',tags:{tenant_id:'tenant'}});
    expect(result.messageId).toMatch(/^dev-/); expect(result.acceptedAt).toBeInstanceOf(Date);
  });
  it('does not write recipient addresses or subject content to application logs',async()=>{
    vi.stubEnv('NODE_ENV','development');
    const log=vi.spyOn(console,'info').mockImplementation(()=>{});
    try{
      await new DevelopmentEmailProvider().sendEmail({to:'private.person@example.com',from:'sender@example.com',subject:'Sensitive campaign subject',html:'',text:'',tags:{tenant_id:'tenant'}});
      expect(JSON.stringify(log.mock.calls)).not.toContain('private.person@example.com');
      expect(JSON.stringify(log.mock.calls)).not.toContain('Sensitive campaign subject');
    }finally{log.mockRestore();}
  });
  it('refuses to simulate delivery in production',async()=>{
    vi.stubEnv('NODE_ENV','production');
    await expect(new DevelopmentEmailProvider().sendEmail({to:'test@example.com',from:'sender@example.com',subject:'Test',html:'',text:'',tags:{}})).rejects.toThrow('disabled in production');
  });
});
describe('provider response ambiguity',()=>{
  it('retries only explicit throttling responses and leaves permanent or uncertain outcomes for reconciliation',()=>{
    expect(providerResponseIsAmbiguous({$metadata:{httpStatusCode:400}})).toBe(false);
    expect(providerResponseIsAmbiguous({name:'CredentialsProviderError'})).toBe(false);
    expect(providerResponseIsAmbiguous({$metadata:{httpStatusCode:503}})).toBe(true);
    expect(providerResponseIsAmbiguous(new Error('socket timeout'))).toBe(true);
    expect(shouldRetryProviderSend({$metadata:{httpStatusCode:400}})).toBe(false);
    expect(shouldRetryProviderSend({$metadata:{httpStatusCode:503}})).toBe(false);
    expect(shouldRetryProviderSend({name:'TooManyRequestsException'})).toBe(true);
    expect(shouldRetryProviderSend({name:'ThrottlingException',$metadata:{httpStatusCode:400}})).toBe(true);
    expect(shouldRetryProviderSend({$metadata:{httpStatusCode:429}})).toBe(true);
    expect(shouldRetryProviderSend(new Error('database connection interrupted'))).toBe(true);
    expect(shouldRetryProviderSend({name:'CredentialsProviderError'})).toBe(false);
    expect(shouldRetryProviderSend(new ProviderOutcomeUnknownError())).toBe(false);
    expect(shouldRetryProviderSend(new Error('persistence failed'),true)).toBe(false);
    expect(providerSendFailureDisposition({$metadata:{httpStatusCode:400}})).toBe('rejected');
    expect(providerSendFailureDisposition({name:'ConfigError'})).toBe('rejected');
    expect(providerSendFailureDisposition({$metadata:{httpStatusCode:503}})).toBe('ambiguous');
    expect(providerSendFailureDisposition(new Error('database connection interrupted'))).toBe('retryable');
  });
 it('passes an abort signal to SES and classifies an interrupted request as uncertain',async()=>{
  const send=vi.spyOn(SESv2Client.prototype,'send').mockRejectedValue(new Error('aborted'));
  const controller=new AbortController();controller.abort();
  const provider=new (await import('./email-provider')).AmazonSesProvider();
  await expect(provider.sendEmail({to:'test@example.com',from:'sender@example.com',subject:'Test',html:'',text:'',tags:{}},{signal:controller.signal})).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);
  const [command,options]=send.mock.calls[0] as unknown as [SendEmailCommand,{abortSignal:AbortSignal}];
  expect(command).toBeInstanceOf(SendEmailCommand);
  expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  expect(options.abortSignal.aborted).toBe(true);
  expect(options.abortSignal).not.toBe(controller.signal);
  send.mockRestore();
 });
 it.each([[400,'rejected'],[429,'retryable'],[503,'ambiguous']] as const)('keeps SES HTTP %s disposition without exposing the SDK error',async(status,disposition)=>{
  const address='private-recipient@example.test';
  const error=Object.assign(new Error(`Could not send to ${address}`),{$metadata:{httpStatusCode:status}});
  const send=vi.spyOn(SESv2Client.prototype,'send').mockRejectedValue(error);
  try{
   const provider=new (await import('./email-provider')).AmazonSesProvider();
   const rejection=await provider.sendEmail({to:address,from:'sender@example.test',subject:'Test',html:'',text:'',tags:{}}).catch(failure=>failure);
   expect(providerSendFailureDisposition(rejection)).toBe(disposition);
   expect(rejection).toBeInstanceOf(Error);
   expect(rejection).not.toBe(error);
   expect(rejection).not.toHaveProperty('cause');
   expect(rejection.stack).not.toContain(address);
   expect(JSON.stringify(rejection)).not.toContain(address);
  }finally{send.mockRestore();}
 });
});

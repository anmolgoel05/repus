export class ProviderOutcomeUnknownError extends Error {
  constructor(message='The provider may have accepted this email, but Repus did not receive a definite response.'){super(message);this.name='ProviderOutcomeUnknownError';}
}

export function providerResponseIsAmbiguous(error:unknown){
  const details=error as {$metadata?:{httpStatusCode?:number};name?:string}|null;
  if(['CredentialsProviderError','ConfigError','InvalidParameterError','EndpointError'].includes(details?.name??''))return false;
  const status=details?.$metadata?.httpStatusCode;
  if(typeof status!=='number'||!Number.isInteger(status))return true;
  return status<400||status>=500;
}

export type ProviderSendFailureDisposition='ambiguous'|'retryable'|'rejected';
export class ProviderSubmissionError extends Error {
  constructor(readonly disposition: 'retryable' | 'rejected') {
    super(disposition === 'retryable' ? 'SES temporarily refused the email submission.' : 'SES rejected the email submission.');
    this.name = 'ProviderSubmissionError';
  }
}

export function providerSendFailureDisposition(error:unknown):ProviderSendFailureDisposition{
  if(error instanceof ProviderOutcomeUnknownError)return 'ambiguous';
  if(error instanceof ProviderSubmissionError)return error.disposition;
  const details=error as {$metadata?:{httpStatusCode?:number};name?:string}|null;
  if(['CredentialsProviderError','ConfigError','InvalidParameterError','EndpointError'].includes(details?.name??''))return 'rejected';
  if(['TooManyRequestsException','ThrottlingException'].includes(details?.name??''))return 'retryable';
  const status=details?.$metadata?.httpStatusCode;
  if(typeof status==='number'&&Number.isInteger(status)){
    if(status===429)return 'retryable';
    if(status>=400&&status<500)return 'rejected';
    return 'ambiguous';
  }
  return 'retryable';
}

export function shouldRetryProviderSend(error:unknown,providerAccepted=false){
  return !providerAccepted&&providerSendFailureDisposition(error)==='retryable';
}

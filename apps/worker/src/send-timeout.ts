export const SES_SEND_TIMEOUT_MS=30_000;

export function createSesSendSignal(controlSignal?:AbortSignal,timeoutMs=SES_SEND_TIMEOUT_MS,timeoutFactory=(milliseconds:number)=>AbortSignal.timeout(milliseconds)){
 const timeoutSignal=timeoutFactory(timeoutMs);
 return controlSignal?AbortSignal.any([controlSignal,timeoutSignal]):timeoutSignal;
}

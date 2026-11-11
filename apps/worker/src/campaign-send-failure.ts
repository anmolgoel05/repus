import {DelayedError} from 'bullmq';
import {providerSendFailureDisposition} from './provider-failure';

type FailureContext={providerAccepted:boolean;attemptsMade:number;attempts:number};
type FailureActions={releaseReservation:()=>Promise<unknown>;markRetry:()=>Promise<unknown>};

export async function handleCampaignSendFailure(error:unknown,context:FailureContext,actions:FailureActions):Promise<void>{
 // BullMQ control flow must not consume attempts or change durable recipient/quota state.
 if(error instanceof DelayedError)throw error;
 const disposition=providerSendFailureDisposition(error);
 if(context.providerAccepted||disposition==='ambiguous'){
  console.error(context.providerAccepted?'SES accepted this email, but post-send processing failed; automatic retry was suppressed to avoid duplicate delivery.':'Email provider outcome is uncertain; automatic retry was suppressed to avoid duplicate delivery. An authenticated SES event can reconcile the recipient.',error);
  return;
 }
 if(disposition==='rejected'){
  await actions.releaseReservation();
  console.error('Email provider definitively rejected this recipient; the reservation was released without retry.',error);
  return;
 }
 if(context.attemptsMade+1>=context.attempts)await actions.releaseReservation();
 else await actions.markRetry();
 throw error;
}

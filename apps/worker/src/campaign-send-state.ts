import {sendingDomainSendBlock} from '@repus/validation';

export type ProviderBoundaryCampaignStatus = 'DRAFT' | 'SCHEDULED' | 'PREPARING' | 'QUEUED' | 'SENDING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'FAILED' | null;

export function campaignSendActionAtProviderBoundary(status: ProviderBoundaryCampaignStatus): 'submit' | 'requeue' | 'suppress' {
  if (status === 'PAUSED') return 'requeue';
  if (status === 'QUEUED' || status === 'SENDING') return 'submit';
  return 'suppress';
}

export function campaignSenderDomainBlock(fromEmail:string|null|undefined,domainRecord:{verificationStatus:string;dkimStatus:string}|null,provider:string){
  const sender=fromEmail?.trim()??'';
  const at=sender.lastIndexOf('@');
  if(at<=0||at===sender.length-1)return 'Add a valid sender email address before sending.';
  return sendingDomainSendBlock(domainRecord,provider);
}

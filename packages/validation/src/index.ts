import { z } from 'zod';
export const EMAIL_JOB_PRIORITIES={account:1,confirmation:2,test:5,campaign:10} as const;
export const PROVIDER_TERMINAL_FAILURE_EVENTS=['reject','rendering_failure'];
export { assertProductionEmailConfig,assertProductionInfrastructureConfig,trustedProxyHops } from './production-config';
export { SEND_INTERRUPT_CHANNEL,parseSendInterrupt } from './send-interrupts';
export type { SendInterrupt } from './send-interrupts';
export { effectivePlatformSendLimits,nonNegativeIntegerConfig,platformQuotaDate,nextPlatformQuotaBoundary } from './quota-limits';

export const normalizeEmail=(email:string)=>email.trim().toLowerCase();
export const emailSchema=z.string().trim().email().max(254).transform(normalizeEmail);
export const consentSchema=z.object({consentSource:z.string().trim().min(1).max(240),consentAt:z.coerce.date().max(new Date())});
export const canReserve=(used:number,reserved:number,requested:number,limit:number)=>Number.isSafeInteger(requested)&&requested>0&&used>=0&&reserved>=0&&limit>=0&&used+reserved+requested<=limit;
export const isMarketingEligible=(input:{status:string;consentAt:Date|null;consentSource:string|null;suppressed:boolean})=>input.status==='SUBSCRIBED'&&input.consentAt!==null&&Boolean(input.consentSource?.trim())&&!input.suppressed;
export type SendingDomainState={verificationStatus:string;dkimStatus:string}|null;
export function workspaceSendBlock(status:string|null,enabled:boolean|null):string|null{if(status!=='active'||!enabled)return 'Sending is paused for this workspace.';return null;}
export function sendingDomainSendBlock(domain:SendingDomainState,provider:string):string|null{if(!domain||domain.verificationStatus!=='verified')return 'Verify your sender domain before sending.';if(provider==='ses'&&domain.dkimStatus!=='verified')return 'Finish DKIM setup and check your domain again before sending.';return null;}
export const campaignSendSchema=z.object({subject:z.string().trim().min(1).max(255),fromEmail:emailSchema,htmlContent:z.string().trim().min(1).max(500_000),listId:z.string().uuid()}).superRefine((campaign,ctx)=>{if(!/unsubscribe/i.test(campaign.htmlContent))ctx.addIssue({code:'custom',path:['htmlContent'],message:'Campaign must contain an unsubscribe link.'})});

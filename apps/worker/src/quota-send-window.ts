import {nextPlatformQuotaBoundary} from '@repus/validation';

/** Keep an acceptance that begins before midnight from being recorded in the next day's quota ledger. */
export function campaignSendDeferralBoundary(
 now:Date,
 timezone:string,
 providerTimeoutMs:number,
 safetyMarginMs=1_000,
):Date|null{
 const boundary=nextPlatformQuotaBoundary(now,timezone);
 return now.getTime()+providerTimeoutMs+safetyMarginMs>=boundary.getTime()?boundary:null;
}

export interface ReputationCounts{total:number;bounces:number;complaints:number;}
export interface ReputationThresholds{minimumSample:number;maximumBounceRate:number;maximumComplaintRate:number;}
function boundedRate(value:string|undefined,fallback:number,name:string){
 if(value===undefined||value.trim()==='')return fallback;
 const parsed=Number(value);
 if(!Number.isFinite(parsed)||parsed<=0||parsed>1)throw new Error(`${name} must be a number greater than 0 and at most 1.`);
 return parsed;
}
export function reputationThresholds(env:Record<string,string|undefined>=process.env):ReputationThresholds{
 const minimumSample=Number(env.REPUS_REPUTATION_MINIMUM_SAMPLE??'20');
 if(!Number.isInteger(minimumSample)||minimumSample<1)throw new Error('REPUS_REPUTATION_MINIMUM_SAMPLE must be a positive integer.');
 return {minimumSample,maximumBounceRate:boundedRate(env.REPUS_MAX_BOUNCE_RATE,0.05,'REPUS_MAX_BOUNCE_RATE'),maximumComplaintRate:boundedRate(env.REPUS_MAX_COMPLAINT_RATE,0.001,'REPUS_MAX_COMPLAINT_RATE')};
}
export function reputationPauseReason(counts:ReputationCounts,thresholds:ReputationThresholds){
 if(counts.total<thresholds.minimumSample)return null;
 const bounceRate=counts.bounces/counts.total,complaintRate=counts.complaints/counts.total;
 if(bounceRate>=thresholds.maximumBounceRate)return {reason:'bounce_rate',bounceRate,complaintRate};
 if(complaintRate>=thresholds.maximumComplaintRate)return {reason:'complaint_rate',bounceRate,complaintRate};
 return null;
}

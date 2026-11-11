import {nonNegativeIntegerConfig} from '@repus/validation';

export function emailWorkerRateLimit(env:Record<string,string|undefined>=process.env){
 const max=nonNegativeIntegerConfig(env.EMAIL_MAX_SEND_RATE_PER_SECOND,1,'EMAIL_MAX_SEND_RATE_PER_SECOND');
 if(max<1)throw new Error('EMAIL_MAX_SEND_RATE_PER_SECOND must be at least 1.');
 return {max,duration:1000};
}

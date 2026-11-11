export function nonNegativeIntegerConfig(value:string|undefined,fallback:number,name:string){
 if(value===undefined||value.trim()==='')return fallback;
 const parsed=Number(value);
 if(!Number.isSafeInteger(parsed)||parsed<0)throw new Error(`${name} must be a non-negative whole number.`);
 return parsed;
}

export function effectivePlatformSendLimits(
 control:{dailySendLimit:number|null;monthlySendLimit:number|null},
 env:Record<string,string|undefined>,
){
 return {
  daily:control.dailySendLimit??nonNegativeIntegerConfig(env.PLATFORM_DAILY_SEND_LIMIT,2500,'PLATFORM_DAILY_SEND_LIMIT'),
  monthly:control.monthlySendLimit??nonNegativeIntegerConfig(env.PLATFORM_MONTHLY_SEND_LIMIT,75000,'PLATFORM_MONTHLY_SEND_LIMIT'),
 };
}

/** Return the platform-local calendar day as a UTC-midnight date-only value. */
export function platformQuotaDate(value:Date,timezone:string){
 if(Number.isNaN(value.getTime()))throw new Error('Quota date must be a valid timestamp.');
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
 const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value;
 const year=get('year'),month=get('month'),day=get('day');
 if(!year||!month||!day)throw new Error('Could not determine the platform quota date.');
 return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}

/** Resolve the next platform-local midnight to its UTC instant. */
export function nextPlatformQuotaBoundary(value:Date,timezone:string){
 const nextDay=new Date(platformQuotaDate(value,timezone).getTime()+86_400_000);
 const targetKey=nextDay.toISOString().slice(0,10);
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const dateKeyAt=(instant:number)=>{
  const parts=formatter.formatToParts(new Date(instant));
  const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??'';
  return `${get('year')}-${get('month')}-${get('day')}`;
 };
 let low=nextDay.getTime()-36*60*60_000,high=nextDay.getTime()+36*60*60_000;
 if(dateKeyAt(low)>=targetKey||dateKeyAt(high)<targetKey)throw new Error('Could not resolve the next platform quota boundary.');
 while(high-low>1){
  const middle=low+Math.floor((high-low)/2);
  if(dateKeyAt(middle)>=targetKey)high=middle;
  else low=middle;
 }
 return new Date(high);
}

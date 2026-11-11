type ZonedParts={year:number;month:number;day:number;hour:number;minute:number};

const formatterCache=new Map<string,Intl.DateTimeFormat>();
function formatter(timeZone:string){
  let value=formatterCache.get(timeZone);
  if(!value){value=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatterCache.set(timeZone,value);}
  return value;
}
function partsAt(date:Date,timeZone:string):ZonedParts{
  const values=Object.fromEntries(formatter(timeZone).formatToParts(date).map(part=>[part.type,part.value]));
  return {year:Number(values.year),month:Number(values.month),day:Number(values.day),hour:Number(values.hour),minute:Number(values.minute)};
}
function wallMilliseconds(parts:ZonedParts){return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);}
function sameWallClock(a:ZonedParts,b:ZonedParts){return a.year===b.year&&a.month===b.month&&a.day===b.day&&a.hour===b.hour&&a.minute===b.minute;}
function parseWallClock(value:string):ZonedParts{
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)throw new Error('Choose a valid date and time.');
  const parts={year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour:Number(match[4]),minute:Number(match[5])};
  const check=new Date(wallMilliseconds(parts));
  if(check.getUTCFullYear()!==parts.year||check.getUTCMonth()+1!==parts.month||check.getUTCDate()!==parts.day||parts.hour>23||parts.minute>59)throw new Error('Choose a valid date and time.');
  return parts;
}

export function formatDateTimeInZone(value:string|Date,timeZone:string){
  const parts=partsAt(new Date(value),timeZone);
  return `${String(parts.year).padStart(4,'0')}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}T${String(parts.hour).padStart(2,'0')}:${String(parts.minute).padStart(2,'0')}`;
}

/** Resolve an HTML datetime-local value in an IANA zone. Repeated times choose the earlier instant; skipped DST times are rejected. */
export function dateTimeInZoneToUtc(value:string,timeZone:string){
  const wall=parseWallClock(value);
  const wallMs=wallMilliseconds(wall);
  const offsets=new Set<number>();
  for(let hours=-36;hours<=36;hours+=6){
    const sample=new Date(wallMs+hours*60*60*1000);
    offsets.add(wallMilliseconds(partsAt(sample,timeZone))-sample.getTime());
  }
  const candidates=[...offsets].map(offset=>new Date(wallMs-offset)).filter(candidate=>sameWallClock(partsAt(candidate,timeZone),wall)).sort((a,b)=>a.getTime()-b.getTime());
  if(!candidates.length)throw new Error('That local time does not exist because the clocks move forward. Choose a later time.');
  return candidates[0];
}

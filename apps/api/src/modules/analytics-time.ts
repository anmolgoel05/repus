export function localDateKey(value:Date,timezone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
 const get=(type:string)=>parts.find(x=>x.type===type)?.value??'';
 return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localMidnight(key:string,timezone:string){
 const [year,month,day]=key.split('-').map(Number);const target=Date.UTC(year,month-1,day);let guess=target;
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<4;i++){const parts=formatter.formatToParts(new Date(guess));const get=(type:string)=>Number(parts.find(x=>x.type===type)?.value??0);const localAsUtc=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'));const correction=target-localAsUtc;guess+=correction;if(!correction)break;}
 return new Date(guess);
}

export function addLocalDays(key:string,count:number){const [year,month,day]=key.split('-').map(Number);const next=new Date(Date.UTC(year,month-1,day+count));return next.toISOString().slice(0,10);}

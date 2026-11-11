import {addLocalDays,localDateKey} from './analytics-time';

export type DailyAnalyticsCounts={day:string;sent?:number;delivered?:number;bounces?:number;complaints?:number;opens?:number;clicks?:number;uniqueOpens?:number;uniqueClicks?:number};

export function buildDailyAnalytics(now:Date,timezone:string,sends:DailyAnalyticsCounts[],events:DailyAnalyticsCounts[]){
 const sendByDay=new Map(sends.map(item=>[item.day,item.sent??0]));
 const eventsByDay=new Map(events.map(item=>[item.day,item]));
 const today=localDateKey(now,timezone);
 return Array.from({length:14},(_,i)=>{
  const date=addLocalDays(today,i-13),day=eventsByDay.get(date);
  return {date,sent:sendByDay.get(date)??0,delivered:day?.delivered??0,bounces:day?.bounces??0,complaints:day?.complaints??0,opens:day?.opens??0,clicks:day?.clicks??0,uniqueOpens:day?.uniqueOpens??0,uniqueClicks:day?.uniqueClicks??0};
 });
}

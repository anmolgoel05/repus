import { Controller,Get,Req,Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { prisma } from '@repus/database';
import { AuthService } from './auth';
import {addLocalDays,localDateKey,localMidnight} from './analytics-time';
import {buildDailyAnalytics} from './analytics-series';
import type {DailyAnalyticsCounts} from './analytics-series';
import {percentageOfAccepted} from './campaign-report-math';

@Injectable()
export class AnalyticsService {
 constructor(private auth:AuthService){}
 async daily(req:Request){
  const user=await this.auth.authenticate(req.cookies?.repus_session as string|undefined),tenantId=user.tenantId;
  const tenant=await prisma.tenant.findFirst({where:{id:tenantId},select:{timezone:true}});let timezone=tenant?.timezone??'UTC';try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{timezone='UTC';}
  const now=new Date(),fourteen=localMidnight(addLocalDays(localDateKey(now,timezone),-13),timezone);
  const dailySent=await prisma.$queryRaw<Array<{day:string;sent:number}>>`SELECT to_char(date_trunc('day', sent_at AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day, count(*)::int AS sent FROM campaign_recipients WHERE tenant_id = ${tenantId}::uuid AND sent_at >= ${fourteen} GROUP BY 1`;
  const dailyEvents=await prisma.$queryRaw<DailyAnalyticsCounts[]>`SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day, count(DISTINCT recipient_id) FILTER (WHERE event_type = 'delivered')::int AS delivered, count(DISTINCT recipient_id) FILTER (WHERE event_type = 'bounce')::int AS bounces, count(DISTINCT recipient_id) FILTER (WHERE event_type = 'complaint')::int AS complaints, count(*) FILTER (WHERE event_type = 'open')::int AS opens, count(*) FILTER (WHERE event_type = 'click')::int AS clicks, count(*) FILTER (WHERE event_type = 'open' AND event_data->>'unique' = 'true')::int AS "uniqueOpens", count(*) FILTER (WHERE event_type = 'click' AND event_data->>'unique' = 'true')::int AS "uniqueClicks" FROM email_events WHERE tenant_id = ${tenantId}::uuid AND occurred_at >= ${fourteen} GROUP BY 1`;
  return buildDailyAnalytics(now,timezone,dailySent,dailyEvents);
 }
 async overview(req:Request){
  const user=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);const tenantId=user.tenantId;
  const tenant=await prisma.tenant.findFirst({where:{id:tenantId},select:{timezone:true}});let timezone=tenant?.timezone??'UTC';try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{timezone='UTC';}
  const now=new Date(),today=localMidnight(localDateKey(now,timezone),timezone),fourteen=localMidnight(addLocalDays(localDateKey(now,timezone),-13),timezone);
  const contacts=await prisma.contact.count({where:{tenantId,deletedAt:null}});
  const subscribers=await prisma.contact.count({where:{tenantId,deletedAt:null,status:'SUBSCRIBED'}});
  const unsubscribed=await prisma.contact.count({where:{tenantId,deletedAt:null,status:'UNSUBSCRIBED'}});
  const campaigns=await prisma.campaign.count({where:{tenantId}});
  const [totals]=await prisma.$queryRaw<Array<Record<'sentToday'|'accepted'|'delivered'|'totalOpens'|'totalClicks'|'uniqueOpens'|'uniqueClicks'|'bounces'|'complaints',number>>>`
    WITH recipient_totals AS (
      SELECT count(sent_at)::int AS accepted,
        count(*) FILTER (WHERE sent_at >= ${today})::int AS "sentToday"
      FROM campaign_recipients WHERE tenant_id = ${tenantId}::uuid
    ), event_totals AS (
      SELECT count(DISTINCT r.id) FILTER (WHERE r.sent_at IS NOT NULL AND e.event_type = 'delivered')::int AS delivered,
        count(DISTINCT r.id) FILTER (WHERE r.sent_at IS NOT NULL AND e.event_type = 'bounce')::int AS bounces,
        count(DISTINCT r.id) FILTER (WHERE r.sent_at IS NOT NULL AND e.event_type = 'complaint')::int AS complaints,
        count(*) FILTER (WHERE e.event_type = 'open')::int AS "totalOpens",
        count(*) FILTER (WHERE e.event_type = 'click')::int AS "totalClicks",
        count(*) FILTER (WHERE e.event_type = 'open' AND e.event_data->'unique' = 'true'::jsonb)::int AS "uniqueOpens",
        count(*) FILTER (WHERE e.event_type = 'click' AND e.event_data->'unique' = 'true'::jsonb)::int AS "uniqueClicks"
      FROM email_events e
      JOIN campaign_recipients r ON r.id = e.recipient_id AND r.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${tenantId}::uuid AND e.event_type IN ('delivered','bounce','complaint','open','click')
    )
    SELECT * FROM recipient_totals CROSS JOIN event_totals
   `;
  const dailySent=await prisma.$queryRaw<Array<{day:string;sent:number}>>`
    SELECT to_char(date_trunc('day', sent_at AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day,
      count(*)::int AS sent
    FROM campaign_recipients WHERE tenant_id = ${tenantId}::uuid AND sent_at >= ${fourteen}
    GROUP BY 1
   `;
  const dailyEvents=await prisma.$queryRaw<DailyAnalyticsCounts[]>`
    SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day,
      count(DISTINCT recipient_id) FILTER (WHERE event_type = 'delivered')::int AS delivered,
      count(DISTINCT recipient_id) FILTER (WHERE event_type = 'bounce')::int AS bounces,
      count(DISTINCT recipient_id) FILTER (WHERE event_type = 'complaint')::int AS complaints,
      count(*) FILTER (WHERE event_type = 'open')::int AS opens,
      count(*) FILTER (WHERE event_type = 'click')::int AS clicks,
      count(*) FILTER (WHERE event_type = 'open' AND event_data->>'unique' = 'true')::int AS "uniqueOpens",
      count(*) FILTER (WHERE event_type = 'click' AND event_data->>'unique' = 'true')::int AS "uniqueClicks"
    FROM email_events WHERE tenant_id = ${tenantId}::uuid AND occurred_at >= ${fourteen}
    GROUP BY 1
   `;
  const recentCampaigns=await prisma.campaign.findMany({where:{tenantId},orderBy:{createdAt:'desc'},take:5,select:{id:true,name:true,status:true,createdAt:true,_count:{select:{recipients:true}}}});
  const recentEvents=await prisma.emailEvent.findMany({where:{tenantId},orderBy:{occurredAt:'desc'},take:8,select:{id:true,eventType:true,occurredAt:true,recipient:{select:{campaign:{select:{id:true,name:true}}}}}});
  const contactAdds=await prisma.$queryRaw<Array<{day:string;added:number}>>`SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day, count(*)::int AS added FROM contacts WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND created_at >= ${fourteen} AND created_at <= ${now} GROUP BY 1`;
  const {accepted,delivered,bounces,complaints,uniqueOpens,uniqueClicks}=totals;
  const daily=buildDailyAnalytics(now,timezone,dailySent,dailyEvents);
  const additions=new Map(contactAdds.map(row=>[row.day,row.added]));
  const contactGrowth=daily.map(day=>({date:day.date,added:additions.get(day.date)??0}));
  return {contacts,activeSubscribers:subscribers,unsubscribed,campaigns,...totals,deliveryRate:percentageOfAccepted(delivered,accepted),bounceRate:percentageOfAccepted(bounces,accepted),complaintRate:percentageOfAccepted(complaints,accepted),uniqueOpenRate:percentageOfAccepted(uniqueOpens,accepted),uniqueClickRate:percentageOfAccepted(uniqueClicks,accepted),daily,contactGrowth,recentCampaigns,recentEvents:recentEvents.map(event=>({id:event.id,eventType:event.eventType,occurredAt:event.occurredAt,campaignId:event.recipient.campaign.id,campaignName:event.recipient.campaign.name}))};
 }
}
@ApiTags('analytics') @Controller('analytics')
export class AnalyticsController {constructor(private service:AnalyticsService){} @Get('overview') async overview(@Req()r:Request){return {data:await this.service.overview(r)};} @Get('daily') async daily(@Req()r:Request){return {data:await this.service.daily(r)};}}

import { BadRequestException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { prisma } from '@repus/database';
import { PROVIDER_TERMINAL_FAILURE_EVENTS } from '@repus/validation';
import { AuthService } from './auth';
import { percentageOfAccepted } from './campaign-report-math';

const EVENT_TYPES = new Set(['accepted','delivered','open','click','bounce','complaint','reject','rendering_failure','delivery_delay','unsubscribe','suppress']);
const RECIPIENT_STATUSES = new Set(['PENDING','QUEUED','SENDING','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED','SUPPRESSED']);
const pageValue = (value: string | undefined) => Math.max(1, Math.min(1_000, Number.parseInt(value ?? '1', 10) || 1));
const pageSizeValue = (value: string | undefined) => Math.max(1, Math.min(100, Number.parseInt(value ?? '25', 10) || 25));

@Injectable()
export class CampaignReportsService {
  constructor(private auth: AuthService) {}

  private async tenantCampaign(req: Request, id: string) {
    const actor = await this.auth.authenticate(req.cookies?.repus_session as string | undefined);
    const campaign = await prisma.campaign.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true } });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    return actor.tenantId;
  }

  async stats(req: Request, id: string) {
    const tenantId = await this.tenantCampaign(req, id);
    const uncertainBefore=new Date(Date.now()-15*60*1000);
    // One statement uses one PostgreSQL snapshot even while sends are committing.
    const [counts] = await prisma.$queryRaw<Array<Record<
      'recipients'|'accepted'|'delivered'|'opens'|'clicks'|'uniqueOpens'|'uniqueClicks'|'bounces'|'complaints'|'unsubscribes'|'failed'|'suppressed'|'uncertainSends', number
    >>>`
      WITH audience AS (
        SELECT id, sent_at, status, send_started_at
        FROM campaign_recipients
        WHERE tenant_id = ${tenantId}::uuid AND campaign_id = ${id}::uuid
      ), recipient_totals AS (
        SELECT count(*)::int AS recipients,
          count(sent_at)::int AS accepted,
          count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
          count(*) FILTER (WHERE status = 'SUPPRESSED')::int AS suppressed,
          count(*) FILTER (WHERE status = 'SENDING' AND send_started_at < ${uncertainBefore})::int AS "uncertainSends"
        FROM audience
      ), event_totals AS (
        SELECT count(DISTINCT a.id) FILTER (WHERE a.sent_at IS NOT NULL AND e.event_type = 'delivered')::int AS delivered,
          count(DISTINCT a.id) FILTER (WHERE a.sent_at IS NOT NULL AND e.event_type = 'bounce')::int AS bounces,
          count(DISTINCT a.id) FILTER (WHERE a.sent_at IS NOT NULL AND e.event_type = 'complaint')::int AS complaints,
          count(*) FILTER (WHERE e.event_type = 'open')::int AS opens,
          count(*) FILTER (WHERE e.event_type = 'click')::int AS clicks,
          count(*) FILTER (WHERE e.event_type = 'open' AND e.event_data->'unique' = 'true'::jsonb)::int AS "uniqueOpens",
          count(*) FILTER (WHERE e.event_type = 'click' AND e.event_data->'unique' = 'true'::jsonb)::int AS "uniqueClicks",
          count(*) FILTER (WHERE e.event_type = 'unsubscribe')::int AS unsubscribes
        FROM audience a
        JOIN email_events e ON e.recipient_id = a.id AND e.tenant_id = ${tenantId}::uuid
      )
      SELECT * FROM recipient_totals CROSS JOIN event_totals`;
    const {accepted,delivered,bounces,complaints,uniqueOpens,uniqueClicks}=counts;
    const pause = await prisma.auditLog.findFirst({
      where: {tenantId, entityType: 'campaign', entityId: id, action: 'campaign.auto_paused.reputation_threshold'},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      select: {createdAt: true, metadata: true},
    });
    const reason = pause?.metadata && typeof pause.metadata === 'object' && !Array.isArray(pause.metadata) ? pause.metadata.reason : null;
    const lastReputationPause = pause && (reason === 'bounce_rate' || reason === 'complaint_rate')
      ? {reason, occurredAt: pause.createdAt}
      : null;
    return { ...counts, lastReputationPause,
      deliveryRate: percentageOfAccepted(delivered,accepted), bounceRate: percentageOfAccepted(bounces,accepted), complaintRate: percentageOfAccepted(complaints,accepted), uniqueOpenRate: percentageOfAccepted(uniqueOpens,accepted), uniqueClickRate: percentageOfAccepted(uniqueClicks,accepted) };
  }

  async events(req: Request, id: string, rawPage?: string, rawPageSize?: string, rawType?: string) {
    const tenantId = await this.tenantCampaign(req, id);
    const page = pageValue(rawPage), pageSize = pageSizeValue(rawPageSize);
    if (rawType && !EVENT_TYPES.has(rawType)) throw new BadRequestException('Choose a supported campaign event type.');
    const eventType = rawType;
    const where = { tenantId, ...(eventType ? { eventType } : {}), recipient: { is: { tenantId, campaignId: id } } };
    const [items,total] = await prisma.$transaction([
      prisma.emailEvent.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, eventType: true, url: true, occurredAt: true, eventData: true, recipient: { select: { email: true } } } }),
      prisma.emailEvent.count({ where }),
    ]);
    return { items: items.map(event => ({ id: event.id, type: event.eventType, url: event.url, occurredAt: event.occurredAt, email: event.recipient.email, unique: (event.eventData as any)?.unique === true })), page, pageSize, total };
  }

  async recipients(req: Request, id: string, rawPage?: string, rawPageSize?: string, rawStatus?: string, rawSearch?: string) {
    const tenantId = await this.tenantCampaign(req, id);
    const page = pageValue(rawPage), pageSize = pageSizeValue(rawPageSize);
    if (rawStatus && !RECIPIENT_STATUSES.has(rawStatus)) throw new BadRequestException('Choose a supported recipient status.');
    const status = rawStatus as any;
    const search = rawSearch?.trim().slice(0, 150);
    const where = { tenantId, campaignId: id, ...(status ? { status } : {}), ...(search ? { email: { contains: search, mode: 'insensitive' as const } } : {}) };
    const [items,total] = await prisma.$transaction([
      prisma.campaignRecipient.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, email: true, status: true, sentAt: true, deliveredAt: true, sendStartedAt: true,
          _count: { select: { events: true } },
          events: {
            where: { tenantId, eventType: { in: PROVIDER_TERMINAL_FAILURE_EVENTS } },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 1, select: { eventType: true },
          },
        },
      }),
      prisma.campaignRecipient.count({ where }),
    ]);
    return {
      items: items.map(({events, ...recipient}) => ({
        ...recipient,
        failureType: recipient.status === 'FAILED' ? events[0]?.eventType ?? null : null,
      })),
      page, pageSize, total,
    };
  }
}

@ApiTags('campaign reports')
@Controller('campaigns/:id')
export class CampaignReportsController {
  constructor(private reports: CampaignReportsService) {}
  @Get('stats') stats(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.reports.stats(req,id).then(data => ({ data })); }
  @Get('events') events(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('type') type?: string) { return this.reports.events(req,id,page,pageSize,type).then(data => ({ data })); }
  @Get('recipients') recipients(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string, @Query('q') search?: string) { return this.reports.recipients(req,id,page,pageSize,status,search).then(data => ({ data })); }
}

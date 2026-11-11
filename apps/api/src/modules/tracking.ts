import { Controller, Get, Injectable, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { withTenant, prisma } from '@repus/database';
import { decryptToken } from '@repus/token-security';
import {setSensitiveResponseHeaders} from './sensitive-response';

type TrackingCapability = { v: 1; kind: 'open' | 'click'; tenantId: string; recipientId: string; target?: string };
const PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');

function decodeHtml(value: string) {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function campaignLinks(html: string) {
  const links: string[] = [];
  for (const match of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) links.push(decodeHtml(match[2]));
  return links;
}

@Injectable()
export class TrackingService {
  private decode(token: string, expected: 'open' | 'click'): TrackingCapability {
    try {
      const parsed = JSON.parse(decryptToken(token, process.env.SESSION_SECRET ?? '')) as TrackingCapability;
      if (parsed.v !== 1 || parsed.kind !== expected || !parsed.tenantId || !parsed.recipientId) throw new Error('Invalid capability');
      return parsed;
    } catch {
      throw new NotFoundException('This tracking link is invalid.');
    }
  }

  async recordOpen(token: string) {
    const capability = this.decode(token, 'open');
    await withTenant(capability.tenantId, async () => {
      const recipient = await prisma.campaignRecipient.findFirst({ where: { id: capability.recipientId, tenantId: capability.tenantId }, select: { id: true } });
      if (!recipient) return;
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recipient.id}, 7719))`;
        const prior = await tx.emailEvent.findFirst({ where: { tenantId: capability.tenantId, recipientId: recipient.id, eventType: 'open', eventData: { path: ['unique'], equals: true } }, select: { id: true } });
        await tx.emailEvent.create({ data: { tenantId: capability.tenantId, recipientId: recipient.id, eventType: 'open', eventData: { unique: !prior } } });
      });
    });
  }

  async clickDestination(token: string) {
    const capability = this.decode(token, 'click');
    if (!capability.target) throw new NotFoundException('This tracking link is invalid.');
    let target: URL;
    try { target = new URL(capability.target); } catch { throw new NotFoundException('This tracking link is invalid.'); }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new NotFoundException('This tracking link is invalid.');

    const allowed = await withTenant(capability.tenantId, async () => {
      const recipient = await prisma.campaignRecipient.findFirst({
        where: { id: capability.recipientId, tenantId: capability.tenantId },
        include: { campaign: { select: { htmlContent: true, textContent: true } } },
      });
      if (!recipient) return false;
      const textLinks = (recipient.campaign.textContent ?? '').match(/https?:\/\/[^\s<>"']+/gi) ?? [];
      const presentInCampaign = campaignLinks(recipient.campaign.htmlContent ?? '').includes(capability.target!) || textLinks.some(link => link.replace(/[),.!?;:]+$/, '') === capability.target);
      if (!presentInCampaign) return false;
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recipient.id}, 7719))`;
        const prior = await tx.emailEvent.findFirst({ where: { tenantId: capability.tenantId, recipientId: recipient.id, eventType: 'click', url: capability.target, eventData: { path: ['unique'], equals: true } }, select: { id: true } });
        await tx.emailEvent.create({ data: { tenantId: capability.tenantId, recipientId: recipient.id, eventType: 'click', url: capability.target, eventData: { unique: !prior } } });
      });
      return true;
    });
    if (!allowed) throw new NotFoundException('This tracking link is invalid.');
    return target.toString();
  }
}

@ApiExcludeController()
@Controller('t')
export class TrackingController {
  constructor(private tracking: TrackingService) {}

  @Get('open/:token')
  async open(@Param('token') token: string, @Res() response: Response) {
    try { await this.tracking.recordOpen(token); } catch (error) { console.error('Open tracking event could not be recorded.', error); /* Return the pixel even for invalid tokens to avoid exposing recipient validity. */ }
    setSensitiveResponseHeaders(response);
    response.type('gif').send(PIXEL);
  }

  @Get('click/:token')
  async click(@Param('token') token: string, @Res() response: Response) {
    setSensitiveResponseHeaders(response);
    const destination = await this.tracking.clickDestination(token);
    response.redirect(302, destination);
  }
}

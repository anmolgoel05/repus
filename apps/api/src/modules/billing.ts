import { Controller, Get, Injectable, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { prisma } from '@repus/database';
import { AuthService } from './auth';
import { platformQuotaDate } from '@repus/validation';

const quotaDate = platformQuotaDate;

@Injectable()
export class BillingService {
  constructor(private auth: AuthService) {}

  async overview(req: Request) {
    const actor = await this.auth.authenticate(req.cookies?.repus_session as string | undefined);
    const timezone = process.env.PLATFORM_TIMEZONE ?? 'Asia/Kolkata';
    const today = quotaDate(new Date(), timezone);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const [limits, subscription, todayUsage, monthUsage, contacts, assets, tenant] = await Promise.all([
      prisma.tenantSendingLimit.findUnique({ where: { tenantId: actor.tenantId } }),
      prisma.billingSubscription.findFirst({ where: { tenantId: actor.tenantId }, orderBy: { updatedAt: 'desc' }, select: { provider: true, plan: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } }),
      prisma.dailyUsage.findUnique({ where: { tenantId_usageDate: { tenantId: actor.tenantId, usageDate: today } } }),
      prisma.dailyUsage.aggregate({ where: { tenantId: actor.tenantId, usageDate: { gte: monthStart, lt: monthEnd } }, _sum: { sentCount: true, reservedCount: true } }),
      prisma.contact.count({ where: { tenantId: actor.tenantId, deletedAt: null } }),
      prisma.imageAsset.aggregate({ where: { tenantId: actor.tenantId }, _sum: { byteSize: true } }),
      prisma.tenant.findUnique({where:{id:actor.tenantId},select:{plan:true}}),
    ]);
    const workspacePlan=tenant?.plan.trim()||'free';
    return {
      subscription: subscription ?? { provider: null, plan: workspacePlan, status: workspacePlan==='free'?'free':'managed', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
      usage: {
        today: { sent: todayUsage?.sentCount ?? 0, reserved: todayUsage?.reservedCount ?? 0, limit: limits?.dailyLimit ?? 0 },
        month: { sent: monthUsage._sum.sentCount ?? 0, reserved: monthUsage._sum.reservedCount ?? 0, limit: limits?.monthlyLimit ?? 0 },
        contacts: { used: contacts, limit: limits?.contactLimit ?? null },
        media: { usedBytes: assets._sum.byteSize ?? 0, limitBytes: limits?.mediaStorageLimitBytes ?? 104_857_600 },
      },
      sendingEnabled: limits?.enabled ?? false,
      billingEnabled: false,
      timezone,
    };
  }
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private service: BillingService) {}
  @Get('overview') async overview(@Req() req: Request) { return { data: await this.service.overview(req) }; }
}

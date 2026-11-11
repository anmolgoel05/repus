import { Controller, ForbiddenException, Get, Injectable, OnModuleDestroy, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { GetAccountCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { prisma, withPlatformAdmin } from '@repus/database';
import { AuthService } from './auth';
import { isSesSandbox, nonNegativeCounts } from './platform-health-summary';

function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Health check timed out.')), milliseconds); })]).finally(() => clearTimeout(timer!));
}

const queueNames = ['repus-email-sending', 'repus-scheduled-campaigns', 'repus-csv-import', 'repus-provider-events'] as const;

@Injectable()
export class PlatformHealthService implements OnModuleDestroy {
  private queues: Queue[] = [];
  constructor(private auth: AuthService) {}

  private getQueues() {
    if (!this.queues.length) this.queues = queueNames.map(name => new Queue(name, { connection: new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null, connectTimeout: 5000 }) }));
    return this.queues;
  }

  async get(req: Request) {
    const actor = await this.auth.authenticate(req.cookies?.repus_session as string | undefined);
    if (!actor.platformAdmin) throw new ForbiddenException('Platform administrator access is required.');
    const [database, queueResults, provider, events] = await Promise.all([
      this.databaseHealth(),
      Promise.all(this.getQueues().map(async (queue, index) => {
        try { return { name: queueNames[index], status: 'available', counts: nonNegativeCounts(await deadline(queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'paused'), 5000)) }; }
        catch { return { name: queueNames[index], status: 'unavailable', counts: null }; }
      })),
      this.providerHealth(),
      this.eventHealth(),
    ]);
    return { checkedAt: new Date().toISOString(), database, queues: queueResults, provider, events };
  }

  async history(req: Request) {
    const actor = await this.auth.authenticate(req.cookies?.repus_session as string | undefined);
    if (!actor.platformAdmin) throw new ForbiddenException('Platform administrator access is required.');
    return withPlatformAdmin(async () => prisma.platformQueueHealthSample.findMany({
      orderBy: { checkedAt: 'desc' },
      take: 100,
      select: { checkedAt: true, queues: true, failedJobCount: true, healthCheckFailures: true },
    }), { maxWait: 5000, timeout: 8000 });
  }

  private async databaseHealth() {
    try {
      const result = await withPlatformAdmin(async () => {
        await prisma.$queryRaw`SELECT 1`;
        return 'available';
      }, { maxWait: 5000, timeout: 8000 });
      return { status: result };
    } catch { return { status: 'unavailable' }; }
  }

  private async eventHealth() {
    try {
      return await withPlatformAdmin(async () => {
        const [failed, pending, oldest] = await Promise.all([
          prisma.webhookDelivery.count({ where: { status: 'failed' } }),
          prisma.webhookDelivery.count({ where: { status: { in: ['received', 'processing'] } } }),
          prisma.webhookDelivery.findFirst({ where: { status: { in: ['received', 'processing'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        ]);
        return { status: 'available', failed, pending, oldestPendingAt: oldest?.createdAt ?? null, oldestPendingAgeSeconds: oldest ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000)) : 0 };
      }, { maxWait: 5000, timeout: 8000 });
    } catch { return { status: 'unavailable', failed: null, pending: null, oldestPendingAt: null, oldestPendingAgeSeconds: null }; }
  }

  private async providerHealth() {
    if (process.env.EMAIL_PROVIDER !== 'ses') return { status: 'development', productionAccess: false, sandbox: false, quota: null };
    try {
      const client = new SESv2Client({ region: process.env.AWS_REGION, maxAttempts: 1 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let account;
      try { account = await client.send(new GetAccountCommand({}), { abortSignal: controller.signal }); }
      finally { clearTimeout(timer); client.destroy(); }
      const productionAccess=account.ProductionAccessEnabled??false;
      return { status: 'available', productionAccess, sandbox:isSesSandbox({status:'available',productionAccess}), quota: account.SendQuota ? { max24HourSend: account.SendQuota.Max24HourSend ?? 0, sentLast24Hours: account.SendQuota.SentLast24Hours ?? 0, maxSendRate: account.SendQuota.MaxSendRate ?? 0 } : null };
    } catch { return { status: 'unavailable', productionAccess: null, sandbox: null, quota: null }; }
  }

  async onModuleDestroy() {
    await Promise.allSettled(this.queues.map(queue => queue.close()));
  }
}

@ApiTags('platform administration')
@Controller('admin')
export class PlatformHealthController {
  constructor(private service: PlatformHealthService) {}
  @Get('health') async get(@Req() req: Request) { return { data: await this.service.get(req) }; }
  @Get('health/history') async history(@Req() req: Request) { return { data: await this.service.history(req) }; }
}

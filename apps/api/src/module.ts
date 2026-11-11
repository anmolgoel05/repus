import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD,APP_INTERCEPTOR } from '@nestjs/core';
import IORedis from 'ioredis';
import { AuthController, AuthService } from './modules/auth';
import { ContactsController, ContactsService } from './modules/contacts';
import { HealthController } from './modules/health';
import { CampaignsController, CampaignsService } from './modules/campaigns';
import { AnalyticsController, AnalyticsService } from './modules/analytics';
import { ListsController, ListsService } from './modules/lists';
import { TemplatesController, TemplatesService } from './modules/templates';
import { UnsubscribeController, UnsubscribeService } from './modules/unsubscribe';
import { TenantContextInterceptor } from './modules/tenant-context';
import { DomainsController,DomainsService } from './modules/domains';
import { OrganizationsController,OrganizationsService } from './modules/organizations';
import { ContactImportsController,ContactImportsService } from './modules/contact-imports';
import { TrackingController,TrackingService } from './modules/tracking';
import { CampaignReportsController,CampaignReportsService } from './modules/campaign-reports';
import { CustomFieldsController,CustomFieldsService } from './modules/custom-fields';
import { ApiKeysController,ApiKeysService } from './modules/api-keys';
import { PlatformAdminController,PlatformAdminService } from './modules/platform-admin';
import { ImageAssetsController,ImageAssetsService } from './modules/image-assets';
import { PlatformHealthController,PlatformHealthService } from './modules/platform-health';
import { AbuseReportsController,AbuseReportsService } from './modules/abuse-reports';
import { SubscriptionConfirmationController,SubscriptionConfirmationService } from './modules/subscription-confirmation';
import { BillingController, BillingService } from './modules/billing';
import { RedisThrottlerStorage } from './modules/redis-throttler-storage';

const throttlerRedis=new IORedis(process.env.REDIS_URL??'redis://localhost:6379',{
  maxRetriesPerRequest:1,
  connectTimeout:5000,
  commandTimeout:2000,
  enableOfflineQueue:false,
  autoResendUnfulfilledCommands:false,
});
throttlerRedis.on('error',()=>console.error('API rate limiter Redis connection failed.'));
const redisThrottlerStorage=new RedisThrottlerStorage(throttlerRedis);

@Module({
  imports: [ThrottlerModule.forRoot({throttlers:[{ttl:60_000,limit:60}],storage:redisThrottlerStorage})],
  controllers: [HealthController, AuthController, ContactsController, ContactImportsController, CampaignsController, CampaignReportsController, AnalyticsController, ListsController, TemplatesController, UnsubscribeController, TrackingController, DomainsController,OrganizationsController,CustomFieldsController,ApiKeysController,PlatformAdminController,PlatformHealthController,ImageAssetsController,AbuseReportsController,SubscriptionConfirmationController,BillingController],
  providers: [AuthService, ContactsService, ContactImportsService, CampaignsService, CampaignReportsService, AnalyticsService, ListsService, TemplatesService, UnsubscribeService,TrackingService,DomainsService,OrganizationsService,CustomFieldsService,ApiKeysService,PlatformAdminService,PlatformHealthService,ImageAssetsService,AbuseReportsService,SubscriptionConfirmationService,BillingService,{provide:RedisThrottlerStorage,useValue:redisThrottlerStorage},{ provide: APP_GUARD, useClass: ThrottlerGuard },{provide:APP_INTERCEPTOR,useClass:TenantContextInterceptor}],
})
export class AppModule {}

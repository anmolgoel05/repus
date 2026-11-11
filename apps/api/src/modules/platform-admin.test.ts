import {beforeEach,describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>({tenant:{findUnique:vi.fn(),findMany:vi.fn(),count:vi.fn(),update:vi.fn()},contact:{count:vi.fn()},tenantSendingLimit:{findUnique:vi.fn(),upsert:vi.fn()},billingSubscription:{findFirst:vi.fn()},platformControl:{update:vi.fn(),findUniqueOrThrow:vi.fn()},platformAuditLog:{create:vi.fn()},abuseReport:{findMany:vi.fn(),count:vi.fn(),update:vi.fn()},campaignRecipient:{findMany:vi.fn(),findFirst:vi.fn(),findUnique:vi.fn(),updateMany:vi.fn(),count:vi.fn()},dailyUsage:{updateMany:vi.fn()},platformDailyUsage:{updateMany:vi.fn(),findUnique:vi.fn(),aggregate:vi.fn()},campaign:{updateMany:vi.fn(),count:vi.fn()},emailEvent:{createMany:vi.fn()},$queryRaw:vi.fn(),$executeRaw:vi.fn(),$transaction:vi.fn()}));
const recordAcceptance=vi.hoisted(()=>vi.fn());
const publishSendInterrupt=vi.hoisted(()=>vi.fn().mockResolvedValue(2));
vi.mock('@repus/database',()=>({prisma:db,recordProviderAcceptance:recordAcceptance,withPlatformAdmin:async(fn:()=>Promise<unknown>)=>fn()}));
vi.mock('./send-interrupts',()=>({publishSendInterrupt}));
import {PlatformAdminService} from './platform-admin';

const req={cookies:{repus_session:'session'}} as any;
const auth=(platformAdmin:boolean)=>({authenticate:vi.fn().mockResolvedValue({id:'admin-a',email:'ops@example.test',role:'OWNER',platformAdmin})});

describe('platform administration',()=>{
 it('audits new-workspace defaults without modifying existing tenant limits',async()=>{
  db.platformControl.update.mockResolvedValue({id:1,defaultTenantDailyLimit:0,defaultTenantMonthlyLimit:250});db.platformAuditLog.create.mockResolvedValue({});
  const result=await new PlatformAdminService(auth(true) as any).updatePlatformSettings(req,{defaultTenantDailyLimit:0,defaultTenantMonthlyLimit:250} as any);
  expect(result.tenantDefaults).toEqual({dailyLimit:0,monthlyLimit:250});
  expect(db.platformControl.update).toHaveBeenCalledWith({where:{id:1},data:{updatedByUserId:'admin-a',defaultTenantDailyLimit:0,defaultTenantMonthlyLimit:250}});
  expect(db.tenantSendingLimit.upsert).not.toHaveBeenCalled();
  expect(db.platformAuditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'platform.sending_limits.updated',metadata:{limits:{defaultTenantDailyLimit:0,defaultTenantMonthlyLimit:250}}})});
 });
 beforeEach(()=>{vi.clearAllMocks();});
 it('rejects organization owners who are not configured platform admins',async()=>{
  const service=new PlatformAdminService(auth(false) as any);
  await expect(service.overview(req)).rejects.toThrow('Platform administrator access is required.');
  expect(db.tenant.findUnique).not.toHaveBeenCalled();
 });
 it('computes platform delivery rates from tenant-scoped accepted-recipient cohorts',async()=>{
  db.tenant.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
  db.tenant.findMany.mockResolvedValueOnce([{id:'tenant-a',name:'A',slug:'a',plan:'free',status:'active',createdAt:new Date(),_count:{users:1},sendingLimit:null}]).mockResolvedValueOnce([{id:'tenant-a'}]);
  db.platformDailyUsage.findUnique.mockResolvedValue({sentCount:4,reservedCount:0});db.platformDailyUsage.aggregate.mockResolvedValue({_sum:{sentCount:4,reservedCount:0}});db.platformControl.findUniqueOrThrow.mockResolvedValue({dailySendLimit:2500,monthlySendLimit:75000});
  db.$executeRaw.mockResolvedValue(1);db.$queryRaw.mockResolvedValue([{contacts:20n,accepted:10n,delivered:8n,bounces:1n,complaints:1n}]);db.contact.count.mockResolvedValue(20);db.campaign.count.mockResolvedValue(2);db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  const result=await service.overview(req);
  expect(result.summary).toMatchObject({totalContacts:20,acceptedLast30Days:10,deliveredLast30Days:8,deliveryRateLast30Days:0.8,bounceRateLast30Days:0.1,complaintRateLast30Days:0.1});
  expect(db.$executeRaw.mock.calls[0][1]).toBe('tenant-a');
 });
 it('audits cross-tenant status and quota changes',async()=>{
  db.tenant.findUnique.mockResolvedValueOnce({id:'tenant-a'}).mockResolvedValueOnce({id:'tenant-a',status:'paused'});
  db.tenantSendingLimit.findUnique.mockResolvedValue({tenantId:'tenant-a',quotaOverrides:['monthlyLimit']});
  db.tenant.update.mockResolvedValue({});db.tenantSendingLimit.upsert.mockResolvedValue({});db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  const result=await service.updateTenant(req,'tenant-a',{status:'paused',dailyLimit:25,mediaStorageLimitBytes:52428800,enabled:false} as any);
  expect(result).toMatchObject({status:'paused',inFlightInterruptionPublished:true});
  expect(publishSendInterrupt).toHaveBeenCalledWith({scope:'tenant',tenantId:'tenant-a'});
  expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  expect(db.tenant.update).toHaveBeenCalledWith({where:{id:'tenant-a'},data:{status:'paused'}});
  expect(db.tenantSendingLimit.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a'},update:expect.objectContaining({dailyLimit:25,mediaStorageLimitBytes:52428800,enabled:false,quotaOverrides:['monthlyLimit','dailyLimit','mediaStorageLimitBytes']})}));
  expect(db.tenantSendingLimit.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({mediaStorageLimitBytes:52428800,quotaOverrides:['monthlyLimit','dailyLimit','mediaStorageLimitBytes']})}));
  expect(db.platformAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({actorUserId:'admin-a',action:'platform.tenant.updated',tenantId:'tenant-a',metadata:{changes:{status:'paused',dailyLimit:25,mediaStorageLimitBytes:52428800,enabled:false}}})}));
 });
 it('does not alter quota limits or overrides for a status-only change',async()=>{
  db.tenant.findUnique.mockResolvedValueOnce({id:'tenant-a'}).mockResolvedValueOnce({id:'tenant-a',status:'paused'});
  db.tenantSendingLimit.findUnique.mockResolvedValue({quotaOverrides:[]});db.tenant.update.mockResolvedValue({});db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  await service.updateTenant(req,'tenant-a',{status:'paused'} as any);
  expect(db.tenantSendingLimit.upsert).not.toHaveBeenCalled();
  expect(db.platformAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({metadata:{changes:{status:'paused'}}})}));
 });
 it('audits the global emergency sending pause and resume',async()=>{
  db.platformControl.update.mockResolvedValue({id:1,sendingPaused:true});db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  const result=await service.updatePlatformSettings(req,{sendingPaused:true} as any);
  expect(result).toMatchObject({sendingPaused:true});
  expect(result).toMatchObject({inFlightInterruptionPublished:true});
  expect(publishSendInterrupt).toHaveBeenCalledWith({scope:'all'});
  expect(db.platformControl.update).toHaveBeenCalledWith({where:{id:1},data:{sendingPaused:true,updatedByUserId:'admin-a'}});
  expect(db.platformAuditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({actorUserId:'admin-a',action:'platform.sending.paused',metadata:{sendingPaused:true}})});
 });
 it('scans stale provider outcomes under each tenant RLS claim',async()=>{
  db.tenant.findMany.mockResolvedValue([{id:'tenant-a'},{id:'tenant-b'}]);db.$executeRaw.mockResolvedValue(1);
  const a={id:'recipient-a',tenantId:'tenant-a',sendStartedAt:new Date('2026-10-30T08:00:00Z')};const b={id:'recipient-b',tenantId:'tenant-b',sendStartedAt:new Date('2026-10-30T07:00:00Z')};
  db.campaignRecipient.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);db.campaignRecipient.findMany.mockResolvedValueOnce([a]).mockResolvedValueOnce([b]);db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  await expect(service.uncertainSends(req)).resolves.toMatchObject({total:2,items:[b,a]});
  expect(db.campaignRecipient.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-a');
  expect(db.campaignRecipient.findMany.mock.calls[1][0].where.tenantId).toBe('tenant-b');
 });
 it('persists and audits global send limits, with null restoring environment defaults',async()=>{
  db.platformControl.update.mockResolvedValue({id:1,sendingPaused:false,dailySendLimit:1200,monthlySendLimit:null});db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  await expect(service.updatePlatformSettings(req,{dailySendLimit:1200,monthlySendLimit:null} as any)).resolves.toMatchObject({dailySendLimit:1200,monthlySendLimit:null});
  expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  expect(db.platformControl.update).toHaveBeenCalledWith({where:{id:1},data:{dailySendLimit:1200,monthlySendLimit:null,updatedByUserId:'admin-a'}});
  expect(db.platformAuditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'platform.sending_limits.updated',metadata:{limits:{dailySendLimit:1200,monthlySendLimit:null}}})});
 });
 it('lists abuse reports only for platform admins and audits status changes',async()=>{
  db.abuseReport.findMany.mockResolvedValue([{id:'report-a',status:'open'}]);db.abuseReport.count.mockResolvedValue(61);db.abuseReport.update.mockResolvedValue({id:'report-a',status:'resolved'});db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  await expect(service.abuseReports(req,'2','25')).resolves.toEqual({items:[{id:'report-a',status:'open'}],page:2,pageSize:25,total:61,status:'active'});
  expect(db.abuseReport.findMany).toHaveBeenCalledWith({where:{status:{in:['open','in_review']}},orderBy:[{createdAt:'asc'},{id:'asc'}],skip:25,take:25});
  await expect(service.abuseReports(req,'1','25','resolved')).resolves.toMatchObject({status:'resolved',total:61});
  expect(db.abuseReport.findMany).toHaveBeenLastCalledWith({where:{status:{in:['resolved']}},orderBy:[{createdAt:'asc'},{id:'asc'}],skip:0,take:25});
  await expect(service.abuseReports(req,'1','25','invalid')).rejects.toThrow('Choose active, resolved, rejected, or all reports.');
  await expect(service.updateAbuseReport(req,'report-a',{status:'resolved'} as any)).resolves.toMatchObject({status:'resolved'});
  expect(db.platformAuditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'platform.abuse_report.updated',metadata:{reportId:'report-a',status:'resolved'}})});
 });
 it('releases reserved quota and audits a confirmed non-acceptance resolution',async()=>{
  const sendStartedAt=new Date(Date.now()-20*60_000);const quotaDate=new Date('2026-10-30T00:00:00.000Z');
  db.$transaction.mockImplementation(async(fn:any)=>fn(db));db.$executeRaw.mockResolvedValue(1);
  db.tenant.findMany.mockResolvedValue([{id:'tenant-a'}]);db.campaignRecipient.findFirst.mockResolvedValue({id:'recipient-a',tenantId:'tenant-a',campaignId:'campaign-a',status:'SENDING',sendStartedAt,quotaReserved:true,quotaDate});
  db.campaignRecipient.updateMany.mockResolvedValue({count:1});db.campaignRecipient.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
  db.dailyUsage.updateMany.mockResolvedValue({count:1});db.platformDailyUsage.updateMany.mockResolvedValue({count:1});db.campaign.updateMany.mockResolvedValue({count:1});db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  await expect(service.resolveUncertainSend(req,'recipient-a',{outcome:'not_accepted',evidence:'SES event history confirms no accepted message.'} as any)).resolves.toEqual({success:true,status:'FAILED'});
  expect(db.campaignRecipient.updateMany).toHaveBeenCalledWith({where:{id:'recipient-a',status:'SENDING'},data:{status:'FAILED',quotaReserved:false,sendStartedAt:null}});
  expect(db.dailyUsage.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',usageDate:quotaDate,reservedCount:{gt:0}},data:{reservedCount:{decrement:1}}});
  expect(db.platformDailyUsage.updateMany).toHaveBeenCalledWith({where:{usageDate:quotaDate,reservedCount:{gt:0}},data:{reservedCount:{decrement:1}}});
  expect(db.platformAuditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'platform.uncertain_send.resolved',metadata:expect.objectContaining({outcome:'not_accepted',evidence:'SES event history confirms no accepted message.'})})});
 });
 it('requires a provider message ID when an operator confirms acceptance',async()=>{
  const service=new PlatformAdminService(auth(true) as any);
  await expect(service.resolveUncertainSend(req,'recipient-a',{outcome:'accepted',evidence:'Provider response checked'} as any)).rejects.toThrow('A provider message ID is required');
  expect(db.$transaction).not.toHaveBeenCalled();
 });
 it('records an audited provider acceptance and settles the campaign',async()=>{
  db.$transaction.mockImplementation(async(fn:any)=>fn(db));db.$executeRaw.mockResolvedValue(1);
  db.tenant.findMany.mockResolvedValue([{id:'tenant-a'}]);db.campaignRecipient.findFirst.mockResolvedValue({id:'recipient-a',tenantId:'tenant-a',campaignId:'campaign-a',status:'SENDING',sendStartedAt:new Date(Date.now()-25*60_000),quotaReserved:true,quotaDate:new Date('2026-10-30T00:00:00.000Z')});
  recordAcceptance.mockResolvedValue({recorded:true});db.campaignRecipient.updateMany.mockResolvedValue({count:1});db.campaignRecipient.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);db.campaign.updateMany.mockResolvedValue({count:1});db.platformAuditLog.create.mockResolvedValue({});
  const service=new PlatformAdminService(auth(true) as any);
  await expect(service.resolveUncertainSend(req,'recipient-a',{outcome:'accepted',messageId:'ses-message-a',evidence:'SES message history confirms acceptance.'} as any)).resolves.toEqual({success:true,status:'SENT'});
  expect(recordAcceptance).toHaveBeenCalledWith(db,expect.objectContaining({recipientId:'recipient-a',messageId:'ses-message-a',source:'operator_review'}));
  expect(db.emailEvent.createMany).not.toHaveBeenCalled();
  expect(db.campaign.updateMany).toHaveBeenCalledWith({where:{id:'campaign-a',status:{in:['QUEUED','SENDING','FAILED']}},data:expect.objectContaining({status:'COMPLETED'})});
 });
});


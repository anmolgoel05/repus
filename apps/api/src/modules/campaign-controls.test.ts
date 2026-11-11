import {beforeEach,describe,expect,it,vi} from 'vitest';

const {db,tx,addBulk,addQueue,deferred,publishSendInterrupt,redisState}=vi.hoisted(()=>({
 redisState:{status:'ready'},
 db:{
  $queryRaw:vi.fn(),$executeRaw:vi.fn(),$transaction:vi.fn(),
  campaign:{findMany:vi.fn(),findFirst:vi.fn(),update:vi.fn(),updateMany:vi.fn(),deleteMany:vi.fn()},
  campaignRecipient:{count:vi.fn(),findMany:vi.fn()},
  tenant:{findUnique:vi.fn().mockResolvedValue({status:'active',timezone:'UTC'})},
  tenantSendingLimit:{findUnique:vi.fn().mockResolvedValue({enabled:true})},
  sendingDomain:{findFirst:vi.fn().mockResolvedValue({verificationStatus:'verified',dkimStatus:'verified'})},
 },
 tx:{
  $executeRaw:vi.fn(),$queryRaw:vi.fn(),campaign:{findFirst:vi.fn(),update:vi.fn(),updateMany:vi.fn()},
  campaignRecipient:{count:vi.fn(),findMany:vi.fn(),updateMany:vi.fn()},tenant:{findUnique:vi.fn()},tenantSendingLimit:{findUnique:vi.fn()},
  platformControl:{findUniqueOrThrow:vi.fn()},dailyUsage:{findUnique:vi.fn(),aggregate:vi.fn(),updateMany:vi.fn(),update:vi.fn()},
  platformDailyUsage:{upsert:vi.fn(),findUnique:vi.fn(),aggregate:vi.fn(),updateMany:vi.fn(),update:vi.fn()},
 },
 addBulk:vi.fn().mockResolvedValue([]),addQueue:vi.fn().mockResolvedValue({}),deferred:[] as Array<()=>Promise<unknown>>,
 publishSendInterrupt:vi.fn().mockResolvedValue(1),
}));
vi.mock('@repus/database',()=>({prisma:db,afterTenantCommit:(action:()=>Promise<unknown>)=>{deferred.push(action);},withTenant:(_tenant:string,fn:()=>Promise<unknown>)=>fn(),isPlatformSendingPaused:vi.fn().mockResolvedValue(false)}));
vi.mock('bullmq',()=>({Queue:class{addBulk=addBulk;add=addQueue;}}));
vi.mock('ioredis',()=>({default:class{get status(){return redisState.status;}}}));
vi.mock('./send-interrupts',()=>({publishSendInterrupt}));
import {CampaignsService} from './campaigns';

const request={cookies:{repus_session:'session'}} as any;
const auth={authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a',role:'OWNER'})};

describe('campaign pause and resume',()=>{
 beforeEach(()=>{vi.clearAllMocks();deferred.length=0;redisState.status='ready';});
 it('bounds campaign summary pages and uses a stable order within the tenant',async()=>{
  const items=Array.from({length:26},(_,index)=>({id:String(index)}));
  db.campaign.findMany.mockResolvedValueOnce(items);
  const service=new CampaignsService(auth as any);
  await expect(service.summaryPage(request,'2')).resolves.toEqual({data:items.slice(0,25),page:2,hasNext:true});
  expect(db.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a'},skip:25,take:26,orderBy:[{createdAt:'desc'},{id:'desc'}]}));
  await expect(service.summaryPage(request,'10001')).rejects.toThrow('valid campaign page');
 });
 it('selects only summary fields and scopes both list modes to the authenticated workspace',async()=>{
  const service=new CampaignsService(auth as any);
  await service.list(request,'summary');
  await service.list(request);
  const options={where:{tenantId:'tenant-a'},orderBy:{createdAt:'desc'}};
  const recipients={select:{recipients:true}};
  expect(db.campaign.findMany).toHaveBeenNthCalledWith(1,{...options,select:{id:true,name:true,subject:true,status:true,updatedAt:true,_count:recipients}});
  expect(db.campaign.findMany).toHaveBeenNthCalledWith(2,{...options,include:{_count:recipients}});
 });
 it.each(['Hello {{first_name}}',null])('renders a tenant-owned sample preview with custom text %s',async textContent=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',tenantId:'tenant-a',name:'Welcome',subject:'Hello {{first_name}}',previewText:'A quick hello',fromName:'Repus',fromEmail:'hello@example.com',htmlContent:'<p>Hello {{first_name}}</p>',textContent});
  const result=await new CampaignsService(auth as any).preview(request,'campaign-a');
  expect(result).toMatchObject({subject:'Hello Avery',htmlContent:expect.stringContaining('Hello Avery')});
  expect(result.textContent).toContain('Hello Avery');
  expect(result.textContent).toContain('#unsubscribe-preview');
  expect(result.textContent).not.toContain('A quick hello');
  expect(db.campaign.findFirst).toHaveBeenCalledWith({where:{id:'campaign-a',tenantId:'tenant-a'},include:{_count:{select:{recipients:true}}}});
  expect(deferred).toHaveLength(0);
 });
 it('queues test emails with the same safe personalization used by preview and delivery',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',subject:'Hi {{first_name}}',htmlContent:'<p>{{email}}</p>',textContent:'To {{email}}',fromEmail:'sender@example.com'});
  const result=await new CampaignsService(auth as any).testSend(request,'campaign-a','recipient@example.com');
  expect(result).toEqual({queued:true});expect(deferred).toHaveLength(1);
  await deferred[0]();
  const job=addQueue.mock.calls[0][1];
  expect(job).toMatchObject({email:'recipient@example.com',subject:'[Test] Hi there',html:expect.stringContaining('recipient@example.com'),text:'To recipient@example.com\n\nUnsubscribe: #unsubscribe-preview'});
 });
 it('rejects a test send when Redis is disconnected before publication',async()=>{
  redisState.status='reconnecting';
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',subject:'Hi',htmlContent:'<p>Hi</p>',fromEmail:'sender@example.com'});
  await expect(new CampaignsService(auth as any).testSend(request,'campaign-a','recipient@example.com')).rejects.toMatchObject({status:503});
  expect(deferred).toHaveLength(0);
  expect(addQueue).not.toHaveBeenCalled();
 });
 it('reports test-send queue publication failure without exposing Redis errors',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',subject:'Hi',htmlContent:'<p>Hi</p>',fromEmail:'sender@example.com'});
  addQueue.mockRejectedValueOnce(new Error('private.redis.test'));
  await new CampaignsService(auth as any).testSend(request,'campaign-a','recipient@example.com');
  await expect(deferred[0]()).rejects.toMatchObject({status:503,message:'Service Unavailable'});
 });
 it('counts consented list recipients and filters suppressions in PostgreSQL',async()=>{
  db.$queryRaw.mockResolvedValue([{count:2n}]);
  const service=new CampaignsService(auth as any);
  const count=await (service as any).validateAudience('tenant-a',{subject:'Update',htmlContent:'<p>Hi</p>',fromEmail:'hello@EXAMPLE.COM',listId:'list-a'});
  expect(count).toBe(2);
  expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  const query=db.$queryRaw.mock.calls[0][0].join('?');
  expect(query).toContain('NOT EXISTS');
  expect(query).toContain('s.normalized_email = c.normalized_email');
  expect(db.sendingDomain.findFirst).toHaveBeenCalledWith({where:{tenantId:'tenant-a',domain:'example.com'}});
  expect('suppression' in db).toBe(false);
 });
 it('inserts the audience in PostgreSQL and rejects a reservation count mismatch',async()=>{
  const execute=vi.fn().mockResolvedValue(2);const tx={$executeRaw:execute};
  const service=new CampaignsService(auth as any);
  await (service as any).createRecipients(tx,'tenant-a','campaign-a','list-a','QUEUED',2);
  const query=execute.mock.calls[0][0].join('?');
  expect(query).toContain('INSERT INTO campaign_recipients');
  expect(query).toContain('NOT EXISTS');
  expect(query).toContain('campaign.quota_date');expect(db.$executeRaw).not.toHaveBeenCalled();
  execute.mockResolvedValue(1);
  await expect((service as any).createRecipients(tx,'tenant-a','campaign-a','list-a','QUEUED',2)).rejects.toThrow('eligible audience changed');
 });
 it('reads current workspace and platform limits only after acquiring the shared quota lock',async()=>{
  const order:string[]=[];
  db.$transaction.mockImplementation(async(work:any)=>work(tx));
  tx.$executeRaw.mockImplementation(async()=>{order.push('quota lock');return 1;});
  tx.tenant.findUnique.mockImplementation(async()=>{order.push('tenant status');return {status:'active'};});
  tx.tenantSendingLimit.findUnique.mockImplementation(async()=>{order.push('tenant limits');return {enabled:true,dailyLimit:10,monthlyLimit:100};});
  tx.platformControl.findUniqueOrThrow.mockImplementation(async()=>{order.push('platform limits');return {dailySendLimit:20,monthlySendLimit:200};});
  tx.dailyUsage.findUnique.mockResolvedValue({sentCount:0,reservedCount:0});
  tx.platformDailyUsage.findUnique.mockResolvedValue({sentCount:0,reservedCount:0});
  tx.dailyUsage.aggregate.mockResolvedValue({_sum:{sentCount:0,reservedCount:0}});
  tx.platformDailyUsage.aggregate.mockResolvedValue({_sum:{sentCount:0,reservedCount:0}});
  tx.dailyUsage.update.mockResolvedValue({});tx.platformDailyUsage.update.mockResolvedValue({});

  await (new CampaignsService(auth as any) as any).reserve('tenant-a',2,new Date());

  expect(order.slice(0,4)).toEqual(['quota lock','tenant status','tenant limits','platform limits']);
  expect(db.$transaction.mock.calls[0][1]).toEqual({isolationLevel:'ReadCommitted'});
  expect(tx.dailyUsage.update).toHaveBeenCalledWith(expect.objectContaining({data:{reservedCount:{increment:2}}}));
  expect(tx.platformDailyUsage.update).toHaveBeenCalledWith(expect.objectContaining({data:{reservedCount:{increment:2}}}));
 });
 it('pauses only a tenant-owned active campaign using a conditional update',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'123e4567-e89b-42d3-a456-426614174000',status:'SENDING'});
  db.campaign.updateMany.mockResolvedValue({count:1});
  const result=await new CampaignsService(auth as any).pause(request,'123e4567-e89b-42d3-a456-426614174000');
  expect(result).toMatchObject({status:'PAUSED',inFlightMayComplete:true});
  expect(result).toMatchObject({inFlightInterruptionPublished:true});
  expect(publishSendInterrupt).toHaveBeenCalledWith({scope:'campaign',campaignId:'123e4567-e89b-42d3-a456-426614174000'});
  expect(db.campaign.updateMany).toHaveBeenCalledWith({where:{id:'123e4567-e89b-42d3-a456-426614174000',tenantId:'tenant-a',status:{in:['QUEUED','SENDING']}},data:{status:'PAUSED'}});
 });
 it('restores queued recipients when a paused campaign resumes',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'PAUSED'});
  db.campaign.updateMany.mockResolvedValue({count:1});
  db.campaignRecipient.count.mockResolvedValue(2);
  const result=await new CampaignsService(auth as any).resume(request,'campaign-a');
  expect(result).toEqual({status:'QUEUED',queued:2});
  expect(deferred).toHaveLength(1);
 });
 it('publishes queued campaign recipients in bounded pages',async()=>{
  const first=Array.from({length:500},(_,i)=>({id:`id-${String(i).padStart(3,'0')}`}));
  db.campaignRecipient.findMany.mockResolvedValueOnce(first).mockResolvedValueOnce([{id:'id-500'}]).mockResolvedValueOnce([]);
  const queued=await (new CampaignsService(auth as any) as any).publishCampaignRecipients('tenant-a','campaign-a');
  expect(queued).toBe(501);
  expect(addBulk).toHaveBeenCalledTimes(2);
  expect(addBulk.mock.calls[0][0]).toHaveLength(500);
  expect(addBulk.mock.calls[1][0]).toHaveLength(1);
  expect(db.campaignRecipient.findMany.mock.calls[1][0]).toMatchObject({take:500,where:{campaignId:'campaign-a',status:'QUEUED',id:{gt:'id-499'}}});
 });
 it('leaves committed queued recipients for reconciliation when Redis disconnects',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'PAUSED'});
  db.campaign.updateMany.mockResolvedValue({count:1});
  db.campaignRecipient.count.mockResolvedValue(2);
  await expect(new CampaignsService(auth as any).resume(request,'campaign-a')).resolves.toEqual({status:'QUEUED',queued:2});
  redisState.status='reconnecting';
  await expect(deferred[0]()).resolves.toBeUndefined();
  expect(db.campaignRecipient.findMany).not.toHaveBeenCalled();
  expect(addBulk).not.toHaveBeenCalled();
 });
 it('does not resume a campaign that is not paused',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'COMPLETED'});
  await expect(new CampaignsService(auth as any).resume(request,'campaign-a')).rejects.toThrow('Only a paused campaign can be resumed.');
  expect(db.campaign.updateMany).not.toHaveBeenCalled();
 });
 it('deletes only a tenant-owned campaign that remains a draft at the write',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'DRAFT'});
  db.campaign.deleteMany.mockResolvedValue({count:1});
  await expect(new CampaignsService(auth as any).remove(request,'campaign-a')).resolves.toEqual({success:true});
  expect(db.campaign.deleteMany).toHaveBeenCalledWith({where:{id:'campaign-a',tenantId:'tenant-a',status:'DRAFT'}});
 });
 it('keeps a campaign and its reservations when a concurrent launch wins the draft claim',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'DRAFT'});
  db.campaign.deleteMany.mockResolvedValue({count:0});
  await expect(new CampaignsService(auth as any).remove(request,'campaign-a')).rejects.toThrow('changed state before deletion');
  expect(tx.dailyUsage.updateMany).not.toHaveBeenCalled();
  expect(tx.platformDailyUsage.updateMany).not.toHaveBeenCalled();
 });
 it('releases only reservations actually claimed for cancellation, grouped by their returned quota dates',async()=>{
  const oldDay=new Date('2026-10-30T00:00:00.000Z'),newDay=new Date('2026-10-31T00:00:00.000Z');
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'QUEUED'});
  db.$transaction.mockImplementation((work:any)=>work(tx));
  tx.$executeRaw.mockResolvedValue(1);
  tx.campaign.updateMany.mockResolvedValue({count:1});
  tx.$queryRaw.mockResolvedValue([{quotaDate:oldDay},{quotaDate:newDay},{quotaDate:newDay}]);
  tx.dailyUsage.updateMany.mockResolvedValue({count:1});tx.platformDailyUsage.updateMany.mockResolvedValue({count:1});
  tx.campaign.update.mockResolvedValue({status:'CANCELLED'});

  await expect(new CampaignsService(auth as any).cancel(request,'campaign-a')).resolves.toEqual({success:true,inFlightMayComplete:true,inFlightInterruptionPublished:true});

  const update=tx.$queryRaw.mock.calls[0][0].join('?');
  expect(update).toContain('tenant_id=?::uuid AND campaign_id=?::uuid');
  expect(update).toContain('quota_reserved=true');
  expect(update).toContain('RETURNING quota_date AS "quotaDate"');
  expect(tx.campaign.updateMany).toHaveBeenCalledWith({where:{id:'campaign-a',tenantId:'tenant-a',status:{in:['SCHEDULED','QUEUED','PAUSED']}},data:{status:'CANCELLED'}});
  expect(publishSendInterrupt).toHaveBeenCalledWith({scope:'campaign',campaignId:'campaign-a'});
  expect(tx.dailyUsage.updateMany.mock.calls.map(([input]:any[])=>input)).toEqual([
   {where:{tenantId:'tenant-a',usageDate:oldDay,reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}},
   {where:{tenantId:'tenant-a',usageDate:newDay,reservedCount:{gte:2}},data:{reservedCount:{decrement:2}}},
  ]);
  expect(tx.platformDailyUsage.updateMany.mock.calls.map(([input]:any[])=>input)).toEqual([
   {where:{usageDate:oldDay,reservedCount:{gte:1}},data:{reservedCount:{decrement:1}}},
   {where:{usageDate:newDay,reservedCount:{gte:2}},data:{reservedCount:{decrement:2}}},
  ]);
  expect(tx.campaign.update).not.toHaveBeenCalled();
 });
 it('does not cancel or release quota after the campaign changes state concurrently',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'QUEUED'});
  db.$transaction.mockImplementation((work:any)=>work(tx));
  tx.$executeRaw.mockResolvedValue(1);tx.campaign.updateMany.mockResolvedValue({count:0});

  await expect(new CampaignsService(auth as any).cancel(request,'campaign-a')).rejects.toThrow('changed state and can no longer be cancelled');
  expect(tx.$queryRaw).not.toHaveBeenCalled();
  expect(tx.dailyUsage.updateMany).not.toHaveBeenCalled();
  expect(publishSendInterrupt).not.toHaveBeenCalled();
 });
 it('normalizes sender addresses when updating a campaign',async()=>{
  db.campaign.findFirst.mockResolvedValueOnce({id:'campaign-a',status:'DRAFT'}).mockResolvedValueOnce({id:'campaign-a',fromEmail:'sender@example.com',replyTo:'team@example.com'});
  db.campaign.updateMany.mockResolvedValue({count:1});
  await expect(new CampaignsService(auth as any).update(request,'campaign-a',{fromEmail:'Sender@EXAMPLE.COM',replyTo:'Team@EXAMPLE.COM'})).resolves.toMatchObject({fromEmail:'sender@example.com',replyTo:'team@example.com'});
  expect(db.campaign.updateMany).toHaveBeenCalledWith({where:{id:'campaign-a',tenantId:'tenant-a',status:'DRAFT'},data:expect.objectContaining({fromEmail:'sender@example.com',replyTo:'team@example.com'})});
 });
 it('never mass-assigns protected campaign fields even for an internal unvalidated caller',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'DRAFT'});
  db.campaign.updateMany.mockResolvedValue({count:1});
  await new CampaignsService(auth as any).update(request,'campaign-a',{name:'  Updated  ',tenantId:'foreign',status:'SENT',quotaDate:new Date()} as any);
  const data=db.campaign.updateMany.mock.calls[0][0].data;
  expect(data.name).toBe('Updated');
  for(const protectedField of ['tenantId','status','quotaDate'])expect(data).not.toHaveProperty(protectedField);
 });
 it('normalizes saved campaign editor state and allows clearing an optional reply-to address',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'DRAFT'});
  db.campaign.updateMany.mockResolvedValue({count:1});
  await new CampaignsService(auth as any).update(request,'campaign-a',{replyTo:null,editorJson:{version:2,backgroundColor:'#ffffff',blocks:[{id:99,kind:'paragraph',text:'Saved draft',extra:'discard'}]}} as any);
  const data=db.campaign.updateMany.mock.calls[0][0].data;
  expect(data.replyTo).toBeNull();
  expect(data.editorJson).toEqual({version:2,backgroundColor:'#ffffff',blocks:[{id:1,kind:'paragraph',text:'Saved draft'}]});
 });
 it('does not overwrite campaign data after a concurrent scheduler changes its state',async()=>{
  db.campaign.findFirst.mockResolvedValueOnce({id:'campaign-a',status:'SCHEDULED',listId:'list-a'});
  db.campaign.updateMany.mockResolvedValue({count:0});
  await expect(new CampaignsService(auth as any).update(request,'campaign-a',{fromEmail:'sender@example.com'})).rejects.toThrow('changed state before the edit was saved');
  expect(db.campaign.updateMany).toHaveBeenCalledWith({where:{id:'campaign-a',tenantId:'tenant-a',status:'SCHEDULED',listId:'list-a'},data:expect.objectContaining({fromEmail:'sender@example.com'})});
  expect(db.campaign.findFirst).toHaveBeenCalledTimes(1);
 });
 it('prevents changing the snapshotted audience on a scheduled campaign',async()=>{
  db.campaign.findFirst.mockResolvedValue({id:'campaign-a',status:'SCHEDULED',listId:'list-a'});
  await expect(new CampaignsService(auth as any).update(request,'campaign-a',{listId:'list-b'})).rejects.toThrow('Cancel this scheduled campaign');
  expect(db.campaign.update).not.toHaveBeenCalled();
 });
 it('rebases scheduled reservations when the new date falls in a different month',async()=>{
  const scheduledAt=new Date(Date.now()+45*24*60*60*1000);
  const timezone=process.env.PLATFORM_TIMEZONE??'Asia/Kolkata';
  const dayString=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const targetDay=new Date(`${dayString(scheduledAt)}T00:00:00.000Z`);
  const oldDay=new Date(targetDay.getTime()-45*24*60*60*1000);
  const targetUsage={sentCount:0,reservedCount:0};
  const oldUsage={sentCount:0,reservedCount:2};
  tx.$executeRaw.mockResolvedValue(1);
  tx.campaign.findFirst.mockResolvedValue({id:'campaign-a',tenantId:'tenant-a',status:'SCHEDULED',quotaDate:oldDay});
  tx.campaignRecipient.count.mockResolvedValue(2);
  tx.tenant.findUnique.mockResolvedValue({status:'active'});
  tx.tenantSendingLimit.findUnique.mockResolvedValue({enabled:true,dailyLimit:10,monthlyLimit:10});
  tx.platformControl.findUniqueOrThrow.mockResolvedValue({dailySendLimit:10,monthlySendLimit:10});
  tx.dailyUsage.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.tenantId_usageDate.usageDate.getTime()===targetDay.getTime()?targetUsage:oldUsage));
  tx.platformDailyUsage.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.usageDate.getTime()===targetDay.getTime()?targetUsage:oldUsage));
  tx.dailyUsage.aggregate.mockResolvedValue({_sum:{sentCount:0,reservedCount:0}});
  tx.platformDailyUsage.aggregate.mockResolvedValue({_sum:{sentCount:0,reservedCount:0}});
  tx.dailyUsage.updateMany.mockResolvedValue({count:1});
  tx.platformDailyUsage.updateMany.mockResolvedValue({count:1});
  tx.dailyUsage.update.mockResolvedValue({});
  tx.platformDailyUsage.update.mockResolvedValue({});
  tx.campaignRecipient.updateMany.mockResolvedValue({count:2});
  tx.campaign.updateMany.mockResolvedValue({count:1});
  db.$transaction.mockImplementation((work:any)=>work(tx));

  const result=await new CampaignsService(auth as any).reschedule(request,'campaign-a',scheduledAt.toISOString());

  expect(result).toMatchObject({quotaDate:targetDay,recipients:2});
  expect(tx.dailyUsage.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({usageDate:oldDay}),data:{reservedCount:{decrement:2}}}));
  expect(tx.dailyUsage.update).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId_usageDate:expect.objectContaining({usageDate:targetDay})}),data:{reservedCount:{increment:2}}}));
  expect(tx.campaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({quotaDate:targetDay,scheduledAt})}));
 });
 it('keeps the old reservation when the new month has insufficient tenant quota',async()=>{
  const scheduledAt=new Date(Date.now()+45*24*60*60*1000);
  const timezone=process.env.PLATFORM_TIMEZONE??'Asia/Kolkata';
  const dayString=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const targetDay=new Date(`${dayString(scheduledAt)}T00:00:00.000Z`);
  const oldDay=new Date(targetDay.getTime()-45*24*60*60*1000);
  tx.$executeRaw.mockResolvedValue(1);
  tx.campaign.findFirst.mockResolvedValue({id:'campaign-a',tenantId:'tenant-a',status:'SCHEDULED',quotaDate:oldDay});
  tx.campaignRecipient.count.mockResolvedValue(2);
  tx.tenant.findUnique.mockResolvedValue({status:'active'});
  tx.tenantSendingLimit.findUnique.mockResolvedValue({enabled:true,dailyLimit:10,monthlyLimit:1});
  tx.platformControl.findUniqueOrThrow.mockResolvedValue({dailySendLimit:10,monthlySendLimit:10});
  tx.dailyUsage.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.tenantId_usageDate.usageDate.getTime()===targetDay.getTime()?{sentCount:0,reservedCount:0}:{sentCount:0,reservedCount:2}));
  tx.platformDailyUsage.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.usageDate.getTime()===targetDay.getTime()?{sentCount:0,reservedCount:0}:{sentCount:0,reservedCount:2}));
  tx.dailyUsage.aggregate.mockResolvedValue({_sum:{sentCount:0,reservedCount:0}});
  tx.platformDailyUsage.aggregate.mockResolvedValue({_sum:{sentCount:0,reservedCount:0}});
  db.$transaction.mockImplementation((work:any)=>work(tx));

  await expect(new CampaignsService(auth as any).reschedule(request,'campaign-a',scheduledAt.toISOString())).rejects.toThrow('workspace sending quota');
  expect(tx.dailyUsage.updateMany).not.toHaveBeenCalled();
  expect(tx.platformDailyUsage.updateMany).not.toHaveBeenCalled();
  expect(tx.campaign.updateMany).not.toHaveBeenCalled();
 });
});

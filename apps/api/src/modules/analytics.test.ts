import {beforeEach,describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>({
 tenant:{findFirst:vi.fn()},contact:{count:vi.fn()},campaign:{count:vi.fn(),findMany:vi.fn()},
 campaignRecipient:{count:vi.fn()},emailEvent:{count:vi.fn(),findMany:vi.fn()},$queryRaw:vi.fn(),
}));
vi.mock('@repus/database',()=>({prisma:db}));
import {AnalyticsService} from './analytics';

describe('tenant analytics overview',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  db.tenant.findFirst.mockResolvedValue({timezone:'UTC'});
  db.contact.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
  db.campaign.count.mockResolvedValue(1);
  db.$queryRaw.mockResolvedValueOnce([{sentToday:1,accepted:1,delivered:1,totalOpens:2,totalClicks:3,uniqueOpens:1,uniqueClicks:1,bounces:1,complaints:0}]);
  db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  db.campaign.findMany.mockResolvedValue([{id:'campaign-1',name:'Welcome',status:'COMPLETED',createdAt:new Date('2026-10-30T00:00:00Z'),_count:{recipients:1}}]);
  db.emailEvent.findMany.mockResolvedValue([{id:'event-1',eventType:'delivered',occurredAt:new Date('2026-10-30T00:00:00Z'),recipient:{campaign:{id:'campaign-1',name:'Welcome'}}}]);
 });

 it('returns click metrics plus tenant-scoped recent campaigns and events',async()=>{
  const auth={authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a'})};
  const result=await new AnalyticsService(auth as any).overview({cookies:{repus_session:'session'}} as any);
  expect(result).toMatchObject({contacts:3,activeSubscribers:2,unsubscribed:1,campaigns:1,uniqueClickRate:100});
  expect(result.recentCampaigns).toEqual([{id:'campaign-1',name:'Welcome',status:'COMPLETED',createdAt:new Date('2026-10-30T00:00:00Z'),_count:{recipients:1}}]);
  expect(result.recentEvents).toEqual([{id:'event-1',eventType:'delivered',occurredAt:new Date('2026-10-30T00:00:00Z'),campaignId:'campaign-1',campaignName:'Welcome'}]);
  expect(db.campaign.findMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a'},orderBy:{createdAt:'desc'},take:5,select:{id:true,name:true,status:true,createdAt:true,_count:{select:{recipients:true}}}});
  expect(db.emailEvent.findMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a'},orderBy:{occurredAt:'desc'},take:8,select:{id:true,eventType:true,occurredAt:true,recipient:{select:{campaign:{select:{id:true,name:true}}}}}});
 });
 it('loads only the daily series for the authenticated tenant',async()=>{
  vi.clearAllMocks();db.tenant.findFirst.mockResolvedValue({timezone:'Asia/Kolkata'});db.$queryRaw.mockResolvedValue([]);
  const auth={authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-b'})};
  const result=await new AnalyticsService(auth as any).daily({cookies:{repus_session:'session'}} as any);
  expect(result).toHaveLength(14);
  expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  for(const query of db.$queryRaw.mock.calls){expect(query.slice(1)).toContain('tenant-b');expect(query[0].join(' ')).toContain('WHERE tenant_id =');}
  expect(db.contact.count).not.toHaveBeenCalled();expect(db.campaign.findMany).not.toHaveBeenCalled();expect(db.emailEvent.findMany).not.toHaveBeenCalled();
 });
});

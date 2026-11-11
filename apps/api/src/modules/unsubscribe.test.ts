import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>{
  const tx={
    $executeRaw:vi.fn(),
    contact:{findFirst:vi.fn(),updateMany:vi.fn()},
    suppression:{upsert:vi.fn()},
    unsubscribe:{findFirst:vi.fn(),create:vi.fn()},
    emailEvent:{createMany:vi.fn()},
    campaignRecipient:{findMany:vi.fn().mockResolvedValue([]),updateMany:vi.fn(),count:vi.fn().mockResolvedValue(0)},
    campaign:{updateMany:vi.fn()},
    dailyUsage:{updateMany:vi.fn()},
    platformDailyUsage:{updateMany:vi.fn()},
  };
  return {
    tx,
    prisma:{campaignRecipient:{findUnique:vi.fn()},$transaction:vi.fn()},
    withUnsubscribeToken:vi.fn(),
    publishSendInterrupt:vi.fn().mockResolvedValue(1),
    tokenHash:vi.fn((value:string)=>`hash:${value}`),
  };
});

vi.mock('@repus/database',()=>({prisma:mocks.prisma,withUnsubscribeToken:mocks.withUnsubscribeToken}));
vi.mock('@repus/token-security',()=>({tokenHash:mocks.tokenHash}));
vi.mock('./send-interrupts',()=>({publishSendInterrupt:mocks.publishSendInterrupt}));
import {UnsubscribeService} from './unsubscribe';

describe('public unsubscribe capability',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    mocks.withUnsubscribeToken.mockImplementation(async(_hash:string,run:(recipient:{id:string;tenantId:string})=>Promise<unknown>)=>run({id:'recipient-1',tenantId:'tenant-1'}));
    mocks.prisma.$transaction.mockImplementation(async(run:(tx:typeof mocks.tx)=>Promise<unknown>)=>run(mocks.tx));
    mocks.prisma.campaignRecipient.findUnique.mockResolvedValue({id:'recipient-1',tenantId:'tenant-1',email:'Alice@Example.test',contactId:'contact-1',contact:{deletedAt:null}});
    mocks.tx.contact.findFirst.mockResolvedValue({deletedAt:null,normalizedEmail:'alice@example.test'});
    mocks.tx.emailEvent.createMany.mockResolvedValue({count:1});
    mocks.tx.unsubscribe.findFirst.mockResolvedValue(null);
    mocks.tx.campaignRecipient.findMany.mockResolvedValue([]);
    mocks.tx.campaignRecipient.count.mockResolvedValue(0);
  });

  it('validates a capability using only its hash',async()=>{
    await expect(new UnsubscribeService().validate('opaque-token')).resolves.toEqual({valid:true});
    expect(mocks.tokenHash).toHaveBeenCalledWith('opaque-token');
    expect(mocks.withUnsubscribeToken).toHaveBeenCalledWith('hash:opaque-token',expect.any(Function));
  });

  it('records suppression and history and updates contact status in one tenant transaction',async()=>{
    await expect(new UnsubscribeService().unsubscribe('opaque-token','not interested')).resolves.toEqual({success:true});
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.tx.contact.findFirst).toHaveBeenCalledWith({where:{id:'contact-1',tenantId:'tenant-1'},select:{deletedAt:true,normalizedEmail:true}});
    expect(mocks.tx.contact.updateMany).toHaveBeenCalledWith({where:{id:'contact-1',tenantId:'tenant-1',normalizedEmail:'alice@example.test',deletedAt:null},data:{status:'UNSUBSCRIBED'}});
    expect(mocks.tx.suppression.upsert).toHaveBeenCalledWith({where:{tenantId_normalizedEmail:{tenantId:'tenant-1',normalizedEmail:'alice@example.test'}},create:{tenantId:'tenant-1',email:'Alice@Example.test',normalizedEmail:'alice@example.test',reason:'unsubscribe',source:'email_link'},update:{}});
    expect(mocks.tx.emailEvent.createMany).toHaveBeenCalledWith({data:[{tenantId:'tenant-1',recipientId:'recipient-1',eventType:'unsubscribe',eventKey:'unsubscribe:recipient-1'}],skipDuplicates:true});
    expect(mocks.tx.unsubscribe.create).toHaveBeenCalledWith({data:{tenantId:'tenant-1',contactId:'contact-1',email:'Alice@Example.test',reason:'not interested'}});
    expect(mocks.publishSendInterrupt).toHaveBeenCalledWith({scope:'recipient',recipientId:'recipient-1'});
  });

  it('suppresses queued recipients and releases daily and platform reservations',async()=>{
    const quotaDate=new Date('2026-10-31T00:00:00Z');
    mocks.tx.campaignRecipient.findMany.mockResolvedValue([{id:'queued-1',campaignId:'campaign-1',quotaDate,status:'QUEUED',quotaReserved:true}]);
    mocks.tx.campaignRecipient.updateMany.mockResolvedValue({count:1});
    await new UnsubscribeService().unsubscribe('opaque-token');
    expect(mocks.tx.campaignRecipient.updateMany).toHaveBeenCalledWith({where:{id:{in:['queued-1']},quotaReserved:true,status:{in:['PENDING','QUEUED']}},data:{status:'SUPPRESSED',quotaReserved:false}});
    expect(mocks.tx.dailyUsage.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-1',usageDate:quotaDate},data:{reservedCount:{decrement:1}}});
    expect(mocks.tx.platformDailyUsage.updateMany).toHaveBeenCalledWith({where:{usageDate:quotaDate},data:{reservedCount:{decrement:1}}});
  });

  it('keeps suppression and event history without relinking a concurrently deleted contact',async()=>{
    mocks.prisma.campaignRecipient.findUnique.mockResolvedValue({id:'recipient-1',tenantId:'tenant-1',email:'alice@example.test',contactId:'contact-1',contact:{deletedAt:null}});
    mocks.tx.contact.findFirst.mockResolvedValue({deletedAt:new Date()});
    await new UnsubscribeService().unsubscribe('opaque-token');
    expect(mocks.tx.contact.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.unsubscribe.create).toHaveBeenCalledWith({data:{tenantId:'tenant-1',contactId:null,email:'alice@example.test',reason:undefined}});
    expect(mocks.tx.suppression.upsert).toHaveBeenCalledOnce();
    expect(mocks.tx.emailEvent.createMany).toHaveBeenCalledOnce();
  });
  it('interrupts every matching in-flight recipient across campaigns without targeting queued or replacement-address sends',async()=>{
    const quotaDate=new Date('2026-11-02T00:00:00Z');
    mocks.tx.campaignRecipient.findMany.mockResolvedValue([
      {id:'recipient-1',campaignId:'campaign-1',quotaDate,status:'SENDING',quotaReserved:true},
      {id:'other-in-flight',campaignId:'campaign-2',quotaDate,status:'SENDING',quotaReserved:true},
      {id:'queued-1',campaignId:'campaign-3',quotaDate,status:'QUEUED',quotaReserved:true},
    ]);
    mocks.tx.campaignRecipient.updateMany.mockResolvedValue({count:1});
    await new UnsubscribeService().unsubscribe('opaque-token');
    expect(mocks.tx.campaignRecipient.findMany).toHaveBeenCalledWith({where:{tenantId:'tenant-1',email:{equals:'alice@example.test',mode:'insensitive'},status:{in:['PENDING','QUEUED','SENDING']}},select:{id:true,campaignId:true,quotaDate:true,quotaReserved:true,status:true}});
    expect(mocks.publishSendInterrupt.mock.calls.map(([interrupt])=>interrupt)).toEqual([
      {scope:'recipient',recipientId:'recipient-1'},
      {scope:'recipient',recipientId:'other-in-flight'},
    ]);
  });

  it('does not append another history row when the same recipient token is retried',async()=>{
    mocks.tx.emailEvent.createMany.mockResolvedValue({count:0});
    await new UnsubscribeService().unsubscribe('opaque-token','duplicate request');
    expect(mocks.tx.unsubscribe.create).not.toHaveBeenCalled();
    expect(mocks.tx.suppression.upsert).toHaveBeenCalledOnce();
  });
  it('suppresses the original address without unsubscribing a newly consented replacement address',async()=>{
    mocks.tx.contact.findFirst.mockResolvedValue({deletedAt:null,normalizedEmail:'new@example.test'});
    await new UnsubscribeService().unsubscribe('opaque-token');
    expect(mocks.tx.contact.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.suppression.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId_normalizedEmail:{tenantId:'tenant-1',normalizedEmail:'alice@example.test'}}}));
    expect(mocks.tx.unsubscribe.create).toHaveBeenCalledWith({data:{tenantId:'tenant-1',contactId:'contact-1',email:'Alice@Example.test',reason:undefined}});
  });

  it('rejects an invalid or expired capability without writing',async()=>{
    mocks.withUnsubscribeToken.mockResolvedValue(null);
    await expect(new UnsubscribeService().unsubscribe('invalid-token')).rejects.toThrow('This unsubscribe link is invalid or has expired.');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

import {beforeEach,describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>{
 const tx={
  $executeRaw:vi.fn(),
  contact:{findFirst:vi.fn(),update:vi.fn()},
  suppression:{findUnique:vi.fn()},
  tenant:{findUnique:vi.fn()},
  contactConfirmationToken:{updateMany:vi.fn()},
  campaignRecipient:{findMany:vi.fn(),updateMany:vi.fn(),count:vi.fn()},
  campaign:{updateMany:vi.fn()},
  dailyUsage:{updateMany:vi.fn()},
  platformDailyUsage:{updateMany:vi.fn()},
 };
 return {tx,prisma:{contact:{findFirst:vi.fn()},customFieldDefinition:{findMany:vi.fn()},$transaction:vi.fn()},createContactConfirmation:vi.fn(),publishSendInterrupt:vi.fn().mockResolvedValue(1)};
});
vi.mock('@repus/database',()=>({prisma:db.prisma}));
vi.mock('./confirmation-mail',()=>({createContactConfirmation:db.createContactConfirmation}));
vi.mock('./send-interrupts',()=>({publishSendInterrupt:db.publishSendInterrupt}));
import {ContactsService} from './contacts';

const request={cookies:{repus_session:'session'}} as any;
const auth={authenticate:vi.fn().mockResolvedValue({id:'user-a',tenantId:'tenant-a',role:'OWNER'})};
const original={id:'contact-a',tenantId:'tenant-a',email:'old@example.test',normalizedEmail:'old@example.test',firstName:'Ari',lastName:'Rao',status:'SUBSCRIBED',customFields:{},deletedAt:null};

describe('contact email changes and consent',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  auth.authenticate.mockResolvedValue({id:'user-a',tenantId:'tenant-a',role:'OWNER'});
  db.prisma.contact.findFirst.mockResolvedValue(original);
  db.prisma.customFieldDefinition.findMany.mockResolvedValue([]);
  db.prisma.$transaction.mockImplementation(async(fn:any)=>fn(db.tx));
  db.tx.contact.findFirst.mockReset().mockResolvedValueOnce({normalizedEmail:original.normalizedEmail}).mockResolvedValue(null);
  db.tx.suppression.findUnique.mockResolvedValue(null);
  db.tx.contactConfirmationToken.updateMany.mockResolvedValue({count:0});
  db.tx.tenant.findUnique.mockResolvedValue({doubleOptInEnabled:false});
  db.tx.campaignRecipient.findMany.mockResolvedValue([]);
  db.tx.campaignRecipient.count.mockResolvedValue(0);
  db.tx.contact.update.mockImplementation(async({data}:any)=>({...original,...data}));
 });

 it('requires fresh permission evidence before changing a subscriber address',async()=>{
  const service=new ContactsService(auth as any);
  await expect(service.update(request,'contact-a',{email:'new@example.test'} as any)).rejects.toThrow('Confirm documented permission');
  expect(db.prisma.$transaction).not.toHaveBeenCalled();
  expect(db.tx.contact.update).not.toHaveBeenCalled();
 });

 it('records fresh consent and reactivates only the newly confirmed address',async()=>{
  const service=new ContactsService(auth as any);
  const result=await service.update(request,'contact-a',{email:'New@Example.test',consentConfirmed:true,consentSource:'Website signup form',consentAt:'2026-10-30'} as any);
  expect(db.tx.$executeRaw).toHaveBeenCalledTimes(2);
  expect(db.tx.suppression.findUnique).toHaveBeenCalledWith({where:{tenantId_normalizedEmail:{tenantId:'tenant-a',normalizedEmail:'new@example.test'}},select:{id:true}});
  expect(db.tx.contact.update).toHaveBeenCalledWith({where:{id:'contact-a'},data:expect.objectContaining({email:'new@example.test',normalizedEmail:'new@example.test',status:'SUBSCRIBED',consentSource:'Website signup form',consentAt:new Date('2026-10-30')})});
  expect(result).toMatchObject({email:'new@example.test',status:'SUBSCRIBED',confirmationRequired:false});
 });

 it('requires double opt-in confirmation when the workspace has it enabled',async()=>{
  db.tx.tenant.findUnique.mockResolvedValue({doubleOptInEnabled:true});
  const service=new ContactsService(auth as any);
  const result=await service.update(request,'contact-a',{email:'new@example.test',consentConfirmed:true,consentSource:'Website signup form',consentAt:'2026-10-30'} as any);
  expect(db.tx.contactConfirmationToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',contactId:'contact-a',confirmedAt:null,expiresAt:{gt:expect.any(Date)}},data:{expiresAt:expect.any(Date)}}));
  expect(db.createContactConfirmation).toHaveBeenCalledWith(db.tx,'tenant-a','contact-a');
  expect(db.tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'PENDING_CONFIRMATION'})}));
  expect(result).toMatchObject({status:'PENDING_CONFIRMATION',confirmationRequired:true});
 });

 it('suppresses old queued recipient snapshots, releases quota and interrupts in-flight sends',async()=>{
  const quotaDate=new Date('2026-10-30T00:00:00.000Z');
  db.tx.campaignRecipient.findMany.mockResolvedValue([
   {id:'queued-a',campaignId:'campaign-a',status:'QUEUED',quotaReserved:true,quotaDate},
   {id:'sending-a',campaignId:'campaign-a',status:'SENDING',quotaReserved:true,quotaDate},
  ]);
  db.tx.campaignRecipient.count.mockResolvedValue(1);
  const service=new ContactsService(auth as any);
  await service.update(request,'contact-a',{email:'new@example.test',consentConfirmed:true,consentSource:'Website signup form',consentAt:'2026-10-30'} as any);
  expect(db.tx.$executeRaw).toHaveBeenCalledTimes(2);
  expect(db.tx.campaignRecipient.updateMany).toHaveBeenCalledWith({where:{id:{in:['queued-a']},status:{in:['PENDING','QUEUED']}},data:{status:'SUPPRESSED',quotaReserved:false}});
  expect(db.tx.dailyUsage.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',usageDate:quotaDate},data:{reservedCount:{decrement:1}}});
  expect(db.tx.platformDailyUsage.updateMany).toHaveBeenCalledWith({where:{usageDate:quotaDate},data:{reservedCount:{decrement:1}}});
  expect(db.publishSendInterrupt).toHaveBeenCalledWith({scope:'recipient',recipientId:'sending-a'});
 });

 it('does not change to an address already on the workspace suppression list',async()=>{
  db.tx.suppression.findUnique.mockResolvedValue({id:'suppression-a'});
  const service=new ContactsService(auth as any);
  await expect(service.update(request,'contact-a',{email:'blocked@example.test',consentConfirmed:true,consentSource:'Signup',consentAt:'2026-10-30'} as any)).rejects.toThrow('suppressed');
  expect(db.tx.contact.update).not.toHaveBeenCalled();
 });

 it('rejects an address already assigned to another workspace contact',async()=>{
  db.tx.contact.findFirst.mockReset().mockResolvedValueOnce({normalizedEmail:original.normalizedEmail}).mockResolvedValueOnce({id:'contact-b'});
  const service=new ContactsService(auth as any);
  await expect(service.update(request,'contact-a',{email:'taken@example.test',consentConfirmed:true,consentSource:'Signup',consentAt:'2026-10-30'} as any)).rejects.toThrow('already exists');
  expect(db.tx.contact.update).not.toHaveBeenCalled();
 });
});

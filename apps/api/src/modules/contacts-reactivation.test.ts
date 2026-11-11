import {beforeEach,describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>{
 const tx={
  $executeRaw:vi.fn(),
  contact:{findFirst:vi.fn(),update:vi.fn()},
  suppression:{findUnique:vi.fn(),deleteMany:vi.fn()},
  tenant:{findUnique:vi.fn()},
  contactConfirmationToken:{updateMany:vi.fn()},
  auditLog:{create:vi.fn()},
 };
 return {tx,prisma:{$transaction:vi.fn()},createContactConfirmation:vi.fn()};
});
vi.mock('@repus/database',()=>({prisma:db.prisma}));
vi.mock('./confirmation-mail',()=>({createContactConfirmation:db.createContactConfirmation}));
vi.mock('./send-interrupts',()=>({publishSendInterrupt:vi.fn()}));
import {ContactsService} from './contacts';

const request={cookies:{repus_session:'session'}} as any;
const auth={authenticate:vi.fn().mockResolvedValue({id:'user-a',tenantId:'tenant-a',role:'OWNER'})};
const evidence={consentConfirmed:true,consentSource:'Fresh event signup',consentAt:'2026-10-30'};

describe('contact reactivation with fresh permission',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  auth.authenticate.mockResolvedValue({id:'user-a',tenantId:'tenant-a',role:'OWNER'});
  db.prisma.$transaction.mockImplementation(async(fn:any)=>fn(db.tx));
  db.tx.contact.findFirst.mockResolvedValue({id:'contact-a',normalizedEmail:'alice@example.test',status:'UNSUBSCRIBED'});
  db.tx.suppression.findUnique.mockResolvedValue({id:'suppression-a',reason:'unsubscribe'});
  db.tx.tenant.findUnique.mockResolvedValue({doubleOptInEnabled:false});
  db.tx.contact.update.mockImplementation(async({data}:any)=>({id:'contact-a',email:'alice@example.test',...data}));
 });

 it('requires affirmative fresh-permission evidence before writing',async()=>{
  await expect(new ContactsService(auth as any).reactivate(request,'contact-a',{...evidence,consentConfirmed:false} as any)).rejects.toThrow('fresh documented permission');
  expect(db.prisma.$transaction).not.toHaveBeenCalled();
 });

 it('removes only unsubscribe suppression and records documented consent',async()=>{
  const result=await new ContactsService(auth as any).reactivate(request,'contact-a',evidence as any);
  expect(db.tx.$executeRaw).toHaveBeenCalledTimes(2);
  expect(db.tx.contact.update).toHaveBeenCalledWith({where:{id:'contact-a'},data:{status:'SUBSCRIBED',consentSource:'Fresh event signup',consentAt:new Date('2026-10-30')}});
  expect(db.tx.suppression.deleteMany).toHaveBeenCalledWith({where:{id:'suppression-a',tenantId:'tenant-a',reason:'unsubscribe'}});
  expect(db.tx.auditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({tenantId:'tenant-a',action:'contact.reactivated_with_fresh_permission',entityId:'contact-a'})});
  expect(result).toMatchObject({status:'SUBSCRIBED',confirmationRequired:false});
 });

 it('keeps unsubscribe suppression until double opt-in is confirmed',async()=>{
  db.tx.tenant.findUnique.mockResolvedValue({doubleOptInEnabled:true});
  db.tx.contactConfirmationToken.updateMany.mockResolvedValue({count:1});
  const result=await new ContactsService(auth as any).reactivate(request,'contact-a',evidence as any);
  expect(db.tx.contact.update).toHaveBeenCalledWith({where:{id:'contact-a'},data:{status:'PENDING_CONFIRMATION',consentSource:'Fresh event signup',consentAt:new Date('2026-10-30')}});
  expect(db.createContactConfirmation).toHaveBeenCalledWith(db.tx,'tenant-a','contact-a');
  expect(db.tx.suppression.deleteMany).not.toHaveBeenCalled();
  expect(result).toMatchObject({status:'PENDING_CONFIRMATION',confirmationRequired:true});
 });

 it.each(['hard_bounce','complaint'])('preserves %s suppressions',async reason=>{
  db.tx.suppression.findUnique.mockResolvedValue({id:'suppression-a',reason});
  await expect(new ContactsService(auth as any).reactivate(request,'contact-a',evidence as any)).rejects.toThrow('bounce or complaint suppression');
  expect(db.tx.contact.update).not.toHaveBeenCalled();
  expect(db.tx.suppression.deleteMany).not.toHaveBeenCalled();
 });
});

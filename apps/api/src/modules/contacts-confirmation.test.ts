import {beforeEach,describe,expect,it,vi} from 'vitest';

const {db,createConfirmation}=vi.hoisted(()=>({
 db:{
  $transaction:vi.fn(),$executeRaw:vi.fn(),
  contact:{findFirst:vi.fn()},
  contactConfirmationToken:{updateMany:vi.fn()},
  auditLog:{create:vi.fn()},
 },
 createConfirmation:vi.fn(),
}));
vi.mock('@repus/database',()=>({prisma:db}));
vi.mock('./confirmation-mail',()=>({createContactConfirmation:createConfirmation}));

import {ContactsService} from './contacts';

const req={cookies:{repus_session:'session'}} as any;
const auth=(role='OWNER')=>({authenticate:vi.fn().mockResolvedValue({id:'user-a',tenantId:'tenant-a',role})});

describe('resending a double opt-in confirmation',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async(work:any)=>work(db));
 });

 it('expires prior links and creates a fresh tenant-scoped capability with an audit record',async()=>{
  db.contact.findFirst.mockResolvedValue({id:'contact-a',status:'PENDING_CONFIRMATION',consentAt:new Date(),consentSource:'signup form'});
  db.contactConfirmationToken.updateMany.mockResolvedValue({count:2});
  db.auditLog.create.mockResolvedValue({});
  const result=await new ContactsService(auth() as any).resendConfirmation(req,'contact-a');
  expect(result).toEqual({confirmationRequired:true});
  expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  expect(db.contact.findFirst).toHaveBeenCalledWith({where:{id:'contact-a',tenantId:'tenant-a',deletedAt:null},select:{id:true,status:true,consentAt:true,consentSource:true}});
  expect(db.contactConfirmationToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',contactId:'contact-a',confirmedAt:null,expiresAt:{gt:expect.any(Date)}},data:{expiresAt:expect.any(Date)}}));
  expect(createConfirmation).toHaveBeenCalledWith(db,'tenant-a','contact-a');
  expect(db.auditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({tenantId:'tenant-a',userId:'user-a',action:'contact.double_opt_in.resent',entityId:'contact-a',metadata:{invalidatedTokens:2}})});
 });

 it('does not reveal or mutate a contact from another workspace',async()=>{
  db.contact.findFirst.mockResolvedValue(null);
  await expect(new ContactsService(auth() as any).resendConfirmation(req,'foreign-contact')).rejects.toThrow('Contact not found.');
  expect(db.contactConfirmationToken.updateMany).not.toHaveBeenCalled();
  expect(createConfirmation).not.toHaveBeenCalled();
 });

 it('requires a pending, permission-backed contact and a writable role',async()=>{
  db.contact.findFirst.mockResolvedValue({id:'contact-a',status:'SUBSCRIBED',consentAt:new Date(),consentSource:'form'});
  await expect(new ContactsService(auth() as any).resendConfirmation(req,'contact-a')).rejects.toThrow('Only a contact awaiting confirmation');
  await expect(new ContactsService(auth('VIEWER') as any).resendConfirmation(req,'contact-a')).rejects.toThrow('read-only');
  expect(db.contactConfirmationToken.updateMany).not.toHaveBeenCalled();
 });
});

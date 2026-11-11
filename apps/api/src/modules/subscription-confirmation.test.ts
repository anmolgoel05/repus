import {beforeEach,describe,expect,it,vi} from 'vitest';

const {db,capability}=vi.hoisted(()=>({db:{contact:{findFirst:vi.fn(),updateMany:vi.fn()},contactConfirmationToken:{updateMany:vi.fn()},suppression:{findUnique:vi.fn(),deleteMany:vi.fn()},auditLog:{create:vi.fn()}},capability:{id:'confirmation-a',tenantId:'tenant-a',contactId:'contact-a',expiresAt:new Date(Date.now()+60_000),confirmedAt:null}}));
vi.mock('@repus/database',()=>({prisma:db,withContactConfirmationToken:async(_hash:string,fn:(value:typeof capability)=>Promise<unknown>)=>fn(capability)}));
import {SubscriptionConfirmationController,SubscriptionConfirmationService} from './subscription-confirmation';

describe('confirmation response formats',()=>{
 it('returns JSON to the web confirmation page without sending an HTML document',async()=>{
  const service={confirm:vi.fn().mockResolvedValue({confirmed:true})};
  const response={setHeader:vi.fn(),json:vi.fn(),type:vi.fn(),send:vi.fn()};
  await new SubscriptionConfirmationController(service as any).submit('opaque-token',response as any,'application/json');
  expect(service.confirm).toHaveBeenCalledWith('opaque-token');
  expect(response.json).toHaveBeenCalledWith({data:{confirmed:true}});
  expect(response.send).not.toHaveBeenCalled();
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
 });
 it('keeps the server-rendered confirmation result for native HTML forms',async()=>{
  const response={setHeader:vi.fn(),json:vi.fn(),type:vi.fn(),send:vi.fn()};
  response.type.mockReturnValue(response);
  await new SubscriptionConfirmationController({confirm:vi.fn().mockResolvedValue({confirmed:true})} as any).submit('opaque-token',response as any,'text/html');
  expect(response.type).toHaveBeenCalledWith('html');
  expect(response.send).toHaveBeenCalledWith(expect.stringContaining('<h1>Subscription confirmed</h1>'));
  expect(response.json).not.toHaveBeenCalled();
 });
});

describe('double opt-in confirmation',()=>{
 beforeEach(()=>{vi.clearAllMocks();capability.expiresAt=new Date(Date.now()+60_000);capability.confirmedAt=null;});
 it('activates only a pending contact and records the confirmation audit event',async()=>{
  db.contact.findFirst.mockResolvedValue({id:'contact-a',normalizedEmail:'alice@example.test',consentAt:new Date('2026-10-01T00:00:00Z'),consentSource:'event signup'});
  db.contactConfirmationToken.updateMany.mockResolvedValue({count:1});db.contact.updateMany.mockResolvedValue({count:1});db.auditLog.create.mockResolvedValue({});
  await expect(new SubscriptionConfirmationService().confirm('opaque-token')).resolves.toEqual({confirmed:true});
  expect(db.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'contact-a',tenantId:'tenant-a',status:'PENDING_CONFIRMATION',deletedAt:null},data:{status:'SUBSCRIBED'}}));
  expect(db.suppression.findUnique).toHaveBeenCalledWith({where:{tenantId_normalizedEmail:{tenantId:'tenant-a',normalizedEmail:'alice@example.test'}},select:{id:true,reason:true}});
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-a',action:'contact.double_opt_in.confirmed',entityId:'contact-a'})}));
 });
 it('rejects expired or already-used tokens without activating contacts',async()=>{
  capability.expiresAt=new Date(Date.now()-1000);
  await expect(new SubscriptionConfirmationService().confirm('expired-token')).rejects.toThrow('invalid or has expired');
  expect(db.contact.updateMany).not.toHaveBeenCalled();
 });
 it('does not activate a contact when another confirmation request already claimed the token',async()=>{
  db.contact.findFirst.mockResolvedValue({id:'contact-a',consentAt:new Date(),consentSource:'signup form'});
  db.contactConfirmationToken.updateMany.mockResolvedValue({count:0});
  await expect(new SubscriptionConfirmationService().confirm('raced-token')).rejects.toThrow('invalid or has expired');
  expect(db.contact.updateMany).not.toHaveBeenCalled();
  expect(db.auditLog.create).not.toHaveBeenCalled();
 });
 it('clears only the unsubscribe suppression after fresh double opt-in confirmation',async()=>{
  db.contact.findFirst.mockResolvedValue({id:'contact-a',normalizedEmail:'alice@example.test',consentAt:new Date(),consentSource:'new event signup'});
  db.contactConfirmationToken.updateMany.mockResolvedValue({count:1});db.contact.updateMany.mockResolvedValue({count:1});db.suppression.findUnique.mockResolvedValue({id:'suppression-a',reason:'unsubscribe'});
  await expect(new SubscriptionConfirmationService().confirm('fresh-token')).resolves.toEqual({confirmed:true});
  expect(db.suppression.deleteMany).toHaveBeenCalledWith({where:{id:'suppression-a',tenantId:'tenant-a',reason:'unsubscribe'}});
 });
 it('refuses to clear a hard-bounce suppression during confirmation',async()=>{
  db.contact.findFirst.mockResolvedValue({id:'contact-a',normalizedEmail:'alice@example.test',consentAt:new Date(),consentSource:'new event signup'});
  db.contactConfirmationToken.updateMany.mockResolvedValue({count:1});db.contact.updateMany.mockResolvedValue({count:1});db.suppression.findUnique.mockResolvedValue({id:'suppression-a',reason:'hard_bounce'});
  await expect(new SubscriptionConfirmationService().confirm('fresh-token')).rejects.toThrow('remains suppressed');
  expect(db.suppression.deleteMany).not.toHaveBeenCalled();
  expect(db.auditLog.create).not.toHaveBeenCalled();
 });
});

import {beforeEach,describe,expect,it,vi} from 'vitest';
import {parseContactConsentEvidence} from './contact-consent';

const db=vi.hoisted(()=>{
 const tx={
  $executeRaw:vi.fn(),
  customFieldDefinition:{findMany:vi.fn()},
  suppression:{findUnique:vi.fn()},
  contact:{findFirst:vi.fn(),count:vi.fn(),upsert:vi.fn()},
  tenantSendingLimit:{findUnique:vi.fn()},
  tenant:{findUnique:vi.fn()},
 };
 return {tx,prisma:{$transaction:vi.fn()},};
});
vi.mock('@repus/database',()=>({prisma:db.prisma}));
vi.mock('./confirmation-mail',()=>({createContactConfirmation:vi.fn()}));
vi.mock('./send-interrupts',()=>({publishSendInterrupt:vi.fn()}));
import {ContactsService} from './contacts';

const request={cookies:{repus_session:'session'}} as any;
const auth={authenticate:vi.fn().mockResolvedValue({id:'user-a',tenantId:'tenant-a',role:'OWNER'})};

describe('contact consent evidence parser',()=>{
 const now=new Date('2026-10-31T12:00:00.000Z');
 it('accepts and trims bounded evidence collected on or before now',()=>{
  expect(parseContactConsentEvidence(' Website signup ','2026-10-31T12:00:00.000Z',now)).toEqual({consentSource:'Website signup',consentAt:now});
 });
 it('rejects missing, unsafe, oversized, malformed, and future evidence',()=>{
  expect(parseContactConsentEvidence('  ','2026-10-30',now)).toBeNull();
  expect(parseContactConsentEvidence('signup\u0000form','2026-10-30',now)).toBeNull();
  expect(parseContactConsentEvidence('x'.repeat(241),'2026-10-30',now)).toBeNull();
  expect(parseContactConsentEvidence('Signup','not-a-date',now)).toBeNull();
  expect(parseContactConsentEvidence('Signup','2026-10-31T12:00:01.000Z',now)).toBeNull();
 });
});

describe('manual contact consent validation',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  auth.authenticate.mockResolvedValue({id:'user-a',tenantId:'tenant-a',role:'OWNER'});
  db.prisma.$transaction.mockImplementation(async(action:any)=>action(db.tx));
  db.tx.customFieldDefinition.findMany.mockResolvedValue([]);
  db.tx.suppression.findUnique.mockResolvedValue(null);
  db.tx.contact.findFirst.mockResolvedValue(null);
  db.tx.contact.count.mockResolvedValue(0);
  db.tx.tenantSendingLimit.findUnique.mockResolvedValue({contactLimit:100});
  db.tx.tenant.findUnique.mockResolvedValue({doubleOptInEnabled:false});
  db.tx.contact.upsert.mockImplementation(async({create}:any)=>({id:'contact-a',...create}));
 });

 it('rejects permission dates in the future before writing',async()=>{
  const service=new ContactsService(auth as any);
  await expect(service.create(request,{email:'new@example.test',consentSource:'Signup form',consentAt:new Date(Date.now()+60_000).toISOString()} as any)).rejects.toThrow('not in the future');
  await expect(service.create(request,{email:'new@example.test',consentSource:'Signup form',consentAt:'not-a-date'} as any)).rejects.toThrow('not in the future');
  expect(db.prisma.$transaction).not.toHaveBeenCalled();
 });

 it('rejects empty, oversized, or NUL-containing permission sources',async()=>{
  const service=new ContactsService(auth as any);
  const valid={email:'new@example.test',consentAt:new Date(Date.now()-60_000).toISOString()};
  await expect(service.create(request,{...valid,consentSource:'   '} as any)).rejects.toThrow('Record when and how');
  await expect(service.create(request,{...valid,consentSource:`x${'x'.repeat(240)}`} as any)).rejects.toThrow('Record when and how');
  await expect(service.create(request,{...valid,consentSource:'signup\u0000form'} as any)).rejects.toThrow('Record when and how');
  expect(db.prisma.$transaction).not.toHaveBeenCalled();
 });

 it('stores trimmed evidence with a valid past permission timestamp',async()=>{
  const service=new ContactsService(auth as any);
  const consentAt=new Date(Date.now()-24*60*60_000).toISOString();
  await service.create(request,{email:'NEW@example.test',consentSource:'  Website signup  ',consentAt} as any);
  expect(db.tx.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
   where:{tenantId_normalizedEmail:{tenantId:'tenant-a',normalizedEmail:'new@example.test'}},
   create:expect.objectContaining({email:'new@example.test',normalizedEmail:'new@example.test',consentSource:'Website signup',consentAt:new Date(consentAt),status:'SUBSCRIBED'}),
  }));
 });
});

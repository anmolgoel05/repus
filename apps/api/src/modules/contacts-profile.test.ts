import {describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>({contact:{findFirst:vi.fn()},customFieldDefinition:{findMany:vi.fn()},unsubscribe:{findMany:vi.fn()}}));
vi.mock('@repus/database',()=>({prisma:db}));
import {ContactsService} from './contacts';

describe('contact profile history',()=>{
 it('returns tenant-scoped timestamped unsubscribe history newest first',async()=>{
  const contact={id:'contact-a',tenantId:'tenant-a',email:'alice@example.test',deletedAt:null};
  const history=[{email:contact.email,reason:'not interested',createdAt:new Date('2026-10-30T10:00:00Z')}];
  db.contact.findFirst.mockResolvedValue(contact);db.customFieldDefinition.findMany.mockResolvedValue([]);db.unsubscribe.findMany.mockResolvedValue(history);
  const result=await new ContactsService({authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a'})} as any).get({cookies:{repus_session:'session'}} as any,'contact-a');
  expect(db.unsubscribe.findMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',contactId:'contact-a'},orderBy:{createdAt:'desc'},select:{email:true,reason:true,createdAt:true}});
  expect(result.unsubscribeHistory).toEqual(history);
 });
});

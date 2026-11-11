import {beforeEach,describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>({contactList:{findFirst:vi.fn()}}));
vi.mock('@repus/database',()=>({prisma:db}));
import {ListsService} from './lists';

describe('tenant-scoped list detail',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('returns a list and membership count only from the current tenant',async()=>{
  db.contactList.findFirst.mockResolvedValue({id:'list-a',tenantId:'tenant-a',_count:{contacts:3}});
  const auth={authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a'})};
  await expect(new ListsService(auth as any).get({cookies:{repus_session:'session'}} as any,'list-a')).resolves.toMatchObject({_count:{contacts:3}});
  expect(db.contactList.findFirst).toHaveBeenCalledWith({where:{id:'list-a',tenantId:'tenant-a'},include:{_count:{select:{contacts:true}}}});
 });
 it('returns not found for an id that is outside the current tenant',async()=>{
  db.contactList.findFirst.mockResolvedValue(null);
  const auth={authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a'})};
  await expect(new ListsService(auth as any).get({cookies:{repus_session:'session'}} as any,'list-b')).rejects.toThrow('List not found.');
  expect(db.contactList.findFirst).toHaveBeenCalledWith({where:{id:'list-b',tenantId:'tenant-a'},include:{_count:{select:{contacts:true}}}});
 });
});

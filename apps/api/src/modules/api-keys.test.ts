import {beforeEach,describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>({apiKey:{findMany:vi.fn(),create:vi.fn(),findFirst:vi.fn(),updateMany:vi.fn()},auditLog:{create:vi.fn()},$transaction:vi.fn()}));
vi.mock('@repus/database',()=>({prisma:db}));
import {ApiKeysService} from './api-keys';

const req={cookies:{repus_session:'session'}} as any;
const auth=(role:string)=>({authenticate:vi.fn().mockResolvedValue({id:'user-a',tenantId:'tenant-a',role})});

describe('tenant API key management',()=>{
 beforeEach(()=>{vi.clearAllMocks();db.$transaction.mockImplementation(async(fn:any)=>fn(db));});
 it('limits API key management to owners and admins',async()=>{
  const service=new ApiKeysService(auth('MARKETER') as any);
  await expect(service.list(req)).rejects.toThrow('Only workspace owners and admins');
  expect(db.apiKey.findMany).not.toHaveBeenCalled();
 });
 it('returns a newly generated secret once and stores only its hash',async()=>{
  db.apiKey.create.mockImplementation(async({data}:any)=>({id:'key-a',name:data.name,role:data.role,expiresAt:data.expiresAt,createdAt:new Date()}));
  const service=new ApiKeysService(auth('OWNER') as any);
  const result=await service.create(req,{name:'Daily sync',role:'VIEWER'} as any);
  expect(result.key).toMatch(/^rps_live_[A-Za-z0-9_-]{43}$/);
  expect(db.apiKey.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-a',createdByUserId:'user-a',name:'Daily sync',role:'VIEWER',keyHash:expect.any(String)})}));
  expect(result).not.toHaveProperty('keyHash');
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-a',action:'api_key.created'})}));
 });
 it('lists metadata only from the current tenant',async()=>{
  db.apiKey.findMany.mockResolvedValue([]);
  const service=new ApiKeysService(auth('ADMIN') as any);
  await service.list(req);
  expect(db.apiKey.findMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a'},select:{id:true,name:true,role:true,lastUsedAt:true,expiresAt:true,revokedAt:true,createdAt:true},orderBy:{createdAt:'desc'}});
 });
 it('cannot revoke a key owned by another tenant',async()=>{
  db.apiKey.findFirst.mockResolvedValue(null);
  const service=new ApiKeysService(auth('OWNER') as any);
  await expect(service.revoke(req,'foreign-key')).rejects.toThrow('API key not found.');
  expect(db.apiKey.findFirst).toHaveBeenCalledWith({where:{id:'foreign-key',tenantId:'tenant-a'}});
  expect(db.apiKey.updateMany).not.toHaveBeenCalled();
 });
});

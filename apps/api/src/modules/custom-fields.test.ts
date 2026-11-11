import {beforeEach,describe,expect,it,vi} from 'vitest';

const db=vi.hoisted(()=>({customFieldDefinition:{findMany:vi.fn(),create:vi.fn(),findFirst:vi.fn(),update:vi.fn()},auditLog:{create:vi.fn()},$transaction:vi.fn()}));
vi.mock('@repus/database',()=>({prisma:db}));
import {CustomFieldsService} from './custom-fields';

const req={cookies:{repus_session:'session'}} as any;
const auth=(role:string)=>({authenticate:vi.fn().mockResolvedValue({id:'user-a',tenantId:'tenant-a',role})});

describe('tenant custom-field definitions',()=>{
 beforeEach(()=>{vi.clearAllMocks();db.$transaction.mockImplementation(async(fn:any)=>fn(db));});
 it('lists definitions only for the authenticated tenant',async()=>{
  db.customFieldDefinition.findMany.mockResolvedValue([]);
  const service=new CustomFieldsService(auth('VIEWER') as any);
  await service.list(req);
  expect(db.customFieldDefinition.findMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a'},orderBy:[{createdAt:'asc'},{key:'asc'}]});
 });
 it('rejects reserved keys and blocks viewers from creating definitions',async()=>{
  const viewerService=new CustomFieldsService(auth('VIEWER') as any);
  await expect(viewerService.create(req,{key:'industry',label:'Industry'} as any)).rejects.toThrow('Only workspace owners and admins');
  const ownerService=new CustomFieldsService(auth('OWNER') as any);
  await expect(ownerService.create(req,{key:'tags',label:'Audience tags'} as any)).rejects.toThrow('That field key is reserved');
  expect(db.customFieldDefinition.create).not.toHaveBeenCalled();
 });
 it('creates normalized metadata with the requesting tenant id',async()=>{
  db.customFieldDefinition.create.mockResolvedValue({id:'field-a',key:'industry',label:'Industry',type:'TEXT'});
  const service=new CustomFieldsService(auth('OWNER') as any);
  await service.create(req,{key:'industry',label:' Industry ',type:'TEXT'} as any);
  expect(db.customFieldDefinition.create).toHaveBeenCalledWith({data:{tenantId:'tenant-a',key:'industry',label:'Industry',type:'TEXT',required:false}});
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-a',action:'custom_field.created'})}));
 });
 it('archives a definition without deleting subscriber values',async()=>{
  db.customFieldDefinition.findFirst.mockResolvedValue({id:'field-a',key:'industry'});
  db.customFieldDefinition.update.mockResolvedValue({id:'field-a',key:'industry',archived:true});
  const service=new CustomFieldsService(auth('ADMIN') as any);
  await service.archive(req,'field-a',{archived:true} as any);
  expect(db.customFieldDefinition.update).toHaveBeenCalledWith({where:{id:'field-a'},data:{archived:true}});
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({metadata:{key:'industry',valuesRetained:true}})}));
 });
});

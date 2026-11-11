import {afterEach,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({
 tenant:{create:vi.fn()},user:{findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),create:vi.fn()},
 organizationMembership:{create:vi.fn()},tenantSendingLimit:{create:vi.fn()},oneTimeToken:{create:vi.fn()},$executeRaw:vi.fn(),$transaction:vi.fn(),
}));
vi.mock('@repus/database',()=>({prisma:db,withAuthUserEmail:async(_email:string,fn:()=>Promise<unknown>)=>fn(),withOrganizationCreation:async(_id:string,fn:()=>Promise<unknown>)=>fn()}));
vi.mock('./tenant-default-limits',()=>({defaultTenantLimits:async()=>({dailyLimit:17,monthlyLimit:250})}));
vi.mock('argon2',()=>({argon2id:2,hash:vi.fn().mockResolvedValue('test-password-hash')}));
import {AuthService} from './auth';
afterEach(()=>vi.unstubAllEnvs());

it('assigns the current workspace defaults when registering a new account',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('EMAIL_PROVIDER','development');
 db.user.findUnique.mockResolvedValue(null);db.user.findUniqueOrThrow.mockResolvedValue({id:'user-new',tenantId:'tenant-new'});
 db.tenant.create.mockResolvedValue({id:'tenant-new',name:'New workspace',slug:'new-workspace'});db.user.create.mockResolvedValue({id:'user-new'});
 db.$transaction.mockImplementation((callback:any)=>callback(db));
 const result=await new AuthService().register({name:'New customer',email:'new@example.test',password:'Long-test-password-123!',organizationName:'New workspace'} as any);
 expect(result.id).toBe('tenant-new');
 expect(db.tenantSendingLimit.create).toHaveBeenCalledWith({data:{tenantId:'tenant-new',dailyLimit:17,monthlyLimit:250}});
 expect(db.organizationMembership.create).toHaveBeenCalledWith({data:{tenantId:'tenant-new',userId:'user-new',role:'OWNER',status:'PENDING'}});
});

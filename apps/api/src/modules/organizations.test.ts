import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('./tenant-default-limits',()=>({defaultTenantLimits:async()=>({dailyLimit:17,monthlyLimit:250})}));

const db=vi.hoisted(()=>({
  tenant:{create:vi.fn(),update:vi.fn()},
  tenantSendingLimit:{create:vi.fn()},
  user:{findUnique:vi.fn(),findFirst:vi.fn(),create:vi.fn(),update:vi.fn(),updateMany:vi.fn()},
  organizationMembership:{findUnique:vi.fn(),findMany:vi.fn(),create:vi.fn(),update:vi.fn(),updateMany:vi.fn()},
  session:{deleteMany:vi.fn()},
  apiKey:{updateMany:vi.fn()},
  oneTimeToken:{findUnique:vi.fn(),updateMany:vi.fn(),create:vi.fn()},
  auditLog:{create:vi.fn()},
  $executeRaw:vi.fn(),
  $transaction:vi.fn(),
}));
vi.mock('@repus/database',()=>({prisma:db,withAuthUserEmail:async(_email:string,fn:()=>Promise<unknown>)=>fn(),withOneTimeToken:async(_hash:string,fn:()=>Promise<unknown>)=>fn(),withOrganizationCreation:async(_tenantId:string,fn:()=>Promise<unknown>)=>fn()}));
vi.mock('argon2',()=>({argon2id:2,hash:vi.fn().mockResolvedValue('hashed-password')}));
import {OrganizationsService} from './organizations';

const req={cookies:{repus_session:'session'}} as any;
const auth=(role:string)=>({authenticate:vi.fn().mockResolvedValue({id:'user-a',tenantId:'tenant-a',role,organization:'Acme'})});

describe('workspace member administration',()=>{
 beforeEach(()=>{vi.clearAllMocks();db.$transaction.mockImplementation(async(fn:any)=>fn(db));db.apiKey.updateMany.mockResolvedValue({count:0});db.organizationMembership.updateMany.mockResolvedValue({count:1});});
 it('does not find or change members outside the actor tenant',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue(null);
  const service=new OrganizationsService(auth('OWNER') as any);
  await expect(service.updateMemberRole(req,'foreign-user',{role:'VIEWER'} as any)).rejects.toThrow('Workspace member not found.');
  expect(db.organizationMembership.findUnique).toHaveBeenCalledWith({where:{tenantId_userId:{tenantId:'tenant-a',userId:'foreign-user'}},include:{user:true}});
  expect(db.organizationMembership.update).not.toHaveBeenCalled();
 });
 it('prevents admins from granting admin privileges to another member',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'ACTIVE',user:{email:'member@example.test'}});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.updateMemberRole(req,'member-b',{role:'ADMIN'} as any)).rejects.toThrow('Admins cannot promote other members to admin.');
  expect(db.organizationMembership.update).not.toHaveBeenCalled();
 });
 it('changes roles only while the authorized membership role and status still match',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'ACTIVE',user:{email:'member@example.test'}});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.updateMemberRole(req,'member-b',{role:'VIEWER'} as any)).resolves.toMatchObject({role:'VIEWER'});
  expect(db.organizationMembership.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'ACTIVE'},data:{role:'VIEWER'}});
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'organization.member_role_updated',metadata:{from:'MARKETER',to:'VIEWER'}})}));
 });
 it('rejects a role edit after a concurrent membership change without writing misleading audit history',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'ACTIVE',user:{email:'member@example.test'}});
  db.organizationMembership.updateMany.mockResolvedValue({count:0});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.updateMemberRole(req,'member-b',{role:'VIEWER'} as any)).rejects.toThrow('This member changed while you were editing.');
  expect(db.auditLog.create).not.toHaveBeenCalled();
 });
 it('rejects stale removal before revoking sessions, invitations or keys',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'ACTIVE',user:{email:'member@example.test',tenantId:'tenant-a'}});
  db.organizationMembership.updateMany.mockResolvedValue({count:0});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.removeMember(req,'member-b')).rejects.toThrow('This member changed while you were editing.');
  expect(db.session.deleteMany).not.toHaveBeenCalled();
  expect(db.oneTimeToken.updateMany).not.toHaveBeenCalled();
  expect(db.apiKey.updateMany).not.toHaveBeenCalled();
  expect(db.auditLog.create).not.toHaveBeenCalled();
 });
 it('revokes member access without deleting the account or its audit history',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'ACTIVE',user:{email:'member@example.test',tenantId:'tenant-a'}});
  db.organizationMembership.update.mockResolvedValue({});
  db.apiKey.updateMany.mockResolvedValue({count:2});
  const service=new OrganizationsService(auth('OWNER') as any);
  await expect(service.removeMember(req,'member-b')).resolves.toEqual({success:true,status:'DISABLED'});
  expect(db.organizationMembership.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'ACTIVE'},data:{status:'DISABLED'}});
  expect(db.session.deleteMany).toHaveBeenCalledWith({where:{userId:'member-b',tenantId:'tenant-a'}});
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',userId:'member-b',purpose:'invite_member',usedAt:null}}));
  expect(db.apiKey.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',createdByUserId:'member-b',revokedAt:null}}));
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-a',action:'organization.member_access_revoked',metadata:expect.objectContaining({apiKeysRevoked:2})})}));
 });
 it('does not allow an admin to revoke another admin',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'admin-b',role:'ADMIN',status:'ACTIVE',user:{email:'admin@example.test'}});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.removeMember(req,'admin-b')).rejects.toThrow('Only the workspace owner can remove an admin.');
  expect(db.organizationMembership.update).not.toHaveBeenCalled();
 });
 it('resends an invitation and invalidates older unused invitation tokens',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'PENDING',user:{id:'member-b',name:'Taylor',email:'taylor@example.test',role:'MARKETER',status:'PENDING',tenantId:'tenant-a',emailVerifiedAt:null}});
  db.organizationMembership.updateMany.mockResolvedValue({count:1});
  db.oneTimeToken.updateMany.mockResolvedValue({count:1});
  const service=new OrganizationsService(auth('OWNER') as any);
  await expect(service.resendInvitation(req,'member-b')).resolves.toMatchObject({success:true,status:'PENDING'});
  expect(db.oneTimeToken.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({userId:'member-b',purpose:'invite_member'})}));
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',userId:'member-b',purpose:'invite_member',usedAt:null}}));
  expect(db.organizationMembership.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'PENDING'},data:{status:'PENDING'}});
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'organization.invitation_resent',entityId:'member-b'})}));
 });
 it('keeps invite invalidation scoped to the requesting workspace under the account home context',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'VIEWER',status:'PENDING',user:{id:'member-b',name:'Taylor',email:'taylor@example.test',tenantId:'tenant-b'}});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.resendInvitation(req,'member-b')).resolves.toMatchObject({success:true,status:'PENDING'});
  expect(db.$executeRaw.mock.calls.map(call=>call[1])).toEqual(['tenant-b','tenant-a']);
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',userId:'member-b',purpose:'invite_member',usedAt:null}}));
  expect(db.oneTimeToken.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-a',userId:'member-b'})}));
 });
 it('rejects a stale resend claim before auditing or returning a replacement link',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'VIEWER',status:'PENDING',user:{id:'member-b',name:'Taylor',email:'taylor@example.test',tenantId:'tenant-b'}});
  db.organizationMembership.updateMany.mockResolvedValue({count:0});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.resendInvitation(req,'member-b')).rejects.toThrow('This member invitation changed.');
  expect(db.auditLog.create).not.toHaveBeenCalled();
 });
 it('invites an existing account as a pending membership without changing its account role or home workspace',async()=>{
  const existing={id:'existing-user',tenantId:'tenant-b',name:'Jordan',email:'jordan@example.test',normalizedEmail:'jordan@example.test',status:'ACTIVE',role:'OWNER'};
  db.user.findUnique.mockResolvedValue(existing);db.organizationMembership.findUnique.mockResolvedValue(null);db.organizationMembership.create.mockResolvedValue({});db.oneTimeToken.create.mockResolvedValue({});db.auditLog.create.mockResolvedValue({});db.$executeRaw.mockResolvedValue(1);
  const service=new OrganizationsService(auth('OWNER') as any);
  await expect(service.invite(req,{email:existing.email,name:'Jordan',role:'VIEWER'} as any)).resolves.toMatchObject({id:'existing-user',email:existing.email,role:'VIEWER',status:'PENDING'});
  expect(db.user.create).not.toHaveBeenCalled();
  expect(db.organizationMembership.create).toHaveBeenCalledWith({data:{tenantId:'tenant-a',userId:'existing-user',role:'VIEWER',status:'PENDING'}});
  expect(db.oneTimeToken.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-a',userId:'existing-user',purpose:'invite_member'})}));
 });
 it('restores previously verified members without replacing their account',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'DISABLED',user:{id:'member-b',email:'member@example.test',role:'MARKETER',status:'ACTIVE',emailVerifiedAt:new Date()}});
  db.organizationMembership.updateMany.mockResolvedValue({count:1});
  const service=new OrganizationsService(auth('OWNER') as any);
  await expect(service.restoreMember(req,'member-b')).resolves.toEqual({success:true,status:'ACTIVE'});
  expect(db.organizationMembership.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'DISABLED'},data:{status:'ACTIVE'}}));
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'organization.member_access_restored',entityId:'member-b'})}));
 });
 it('rejects stale restoration after a role change without auditing it',async()=>{
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-a',userId:'member-b',role:'MARKETER',status:'DISABLED',user:{id:'member-b',email:'member@example.test',status:'ACTIVE',emailVerifiedAt:new Date()}});
  db.organizationMembership.updateMany.mockResolvedValue({count:0});
  const service=new OrganizationsService(auth('ADMIN') as any);
  await expect(service.restoreMember(req,'member-b')).rejects.toThrow('This member access changed.');
  expect(db.auditLog.create).not.toHaveBeenCalled();
 });
 it('consumes invitation tokens once before activating the account',async()=>{
  db.oneTimeToken.findUnique.mockResolvedValue({id:'token-a',userId:'invitee-a',tenantId:'tenant-a',purpose:'invite_member',usedAt:null,expiresAt:new Date(Date.now()+60_000)});
  db.user.findUnique.mockResolvedValue({tenantId:'tenant-a',status:'PENDING'});
  db.oneTimeToken.updateMany.mockResolvedValue({count:1});
  db.user.update.mockResolvedValue({});db.organizationMembership.updateMany.mockResolvedValue({count:1});
  const service=new OrganizationsService(auth('VIEWER') as any);
  await expect(service.acceptInvitation({token:'x'.repeat(32),password:'a-secure-password'} as any)).resolves.toEqual({success:true});
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'token-a',purpose:'invite_member',usedAt:null})}));
  expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:'invitee-a'},data:expect.objectContaining({status:'ACTIVE',emailVerifiedAt:expect.any(Date)})}));
  expect(db.organizationMembership.updateMany).toHaveBeenCalledWith({where:{tenantId:'tenant-a',userId:'invitee-a',status:'PENDING'},data:{status:'ACTIVE'}});
 });
 it('activates a self-registered home workspace when another workspace invitation verifies the account',async()=>{
  db.oneTimeToken.findUnique.mockResolvedValue({id:'token-b',userId:'invitee-b',tenantId:'tenant-a',purpose:'invite_member',usedAt:null,expiresAt:new Date(Date.now()+60_000)});
  db.user.findUnique.mockResolvedValue({tenantId:'tenant-b',status:'PENDING'});
  db.oneTimeToken.updateMany.mockResolvedValue({count:1});db.user.update.mockResolvedValue({});db.organizationMembership.updateMany.mockResolvedValue({count:1});db.$executeRaw.mockResolvedValue(1);
  const service=new OrganizationsService(auth('VIEWER') as any);
  await expect(service.acceptInvitation({token:'y'.repeat(32),password:'another-secure-password'} as any)).resolves.toEqual({success:true});
  expect(db.organizationMembership.updateMany).toHaveBeenNthCalledWith(1,{where:{tenantId:'tenant-b',userId:'invitee-b',status:'PENDING',role:'OWNER'},data:{status:'ACTIVE'}});
  expect(db.organizationMembership.updateMany).toHaveBeenNthCalledWith(2,{where:{tenantId:'tenant-a',userId:'invitee-b',status:'PENDING'},data:{status:'ACTIVE'}});
 });
 it('stores the workspace double opt-in preference and requires a strong token-encryption secret',async()=>{
  const priorSecret=process.env.SESSION_SECRET;
  try{
   process.env.SESSION_SECRET='short';
   const service=new OrganizationsService(auth('OWNER') as any);
   await expect(service.update(req,{doubleOptInEnabled:true} as any)).rejects.toThrow('Configure a 32-character session secret');
   expect(db.tenant.update).not.toHaveBeenCalled();
   process.env.SESSION_SECRET='s'.repeat(32);
   db.tenant.update.mockResolvedValue({id:'tenant-a',doubleOptInEnabled:true});db.auditLog.create.mockResolvedValue({});
   await expect(service.update(req,{doubleOptInEnabled:true} as any)).resolves.toMatchObject({doubleOptInEnabled:true});
   expect(db.tenant.update).toHaveBeenCalledWith({where:{id:'tenant-a'},data:{name:undefined,timezone:undefined,doubleOptInEnabled:true}});
  }finally{if(priorSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=priorSecret;}
 });
 it('creates a workspace with its owner membership and configured sending limits',async()=>{
  db.tenant.create.mockResolvedValue({id:'tenant-new',name:'Second workspace',slug:'second-workspace-abc',timezone:'Asia/Kolkata'});
  db.organizationMembership.create.mockResolvedValue({});db.tenantSendingLimit.create.mockResolvedValue({});db.auditLog.create.mockResolvedValue({});db.$executeRaw.mockResolvedValue(1);
  const service=new OrganizationsService(auth('OWNER') as any);
  await expect(service.create(req,{name:'Second workspace',timezone:'Asia/Kolkata'} as any)).resolves.toMatchObject({id:'tenant-new',name:'Second workspace',role:'OWNER'});
  expect(db.organizationMembership.create).toHaveBeenCalledWith({data:{tenantId:'tenant-new',userId:'user-a',role:'OWNER',status:'ACTIVE'}});
  expect(db.tenantSendingLimit.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenantId:'tenant-new',dailyLimit:17,monthlyLimit:250})}));
 });
});


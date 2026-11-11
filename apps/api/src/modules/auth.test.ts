import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(()=>vi.stubEnv('SESSION_SECRET','account-api-test-secret-at-least-32-characters'));
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

const db=vi.hoisted(()=>({apiKey:{findUnique:vi.fn()},session:{findUnique:vi.fn(),updateMany:vi.fn(),deleteMany:vi.fn(),create:vi.fn()},organizationMembership:{findFirst:vi.fn(),findUnique:vi.fn()},tenant:{findUnique:vi.fn(),findUniqueOrThrow:vi.fn()},oneTimeToken:{findUnique:vi.fn(),updateMany:vi.fn(),create:vi.fn()},user:{findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),update:vi.fn()},auditLog:{create:vi.fn()},$executeRaw:vi.fn(),$transaction:vi.fn()}));
vi.mock('@repus/database',()=>({prisma:db,withAuthUserEmail:async(_email:string,fn:()=>Promise<unknown>)=>fn(),withOneTimeToken:async(_hash:string,fn:()=>Promise<unknown>)=>fn(),withSessionToken:async(_hash:string,fn:()=>Promise<unknown>)=>fn()}));
vi.mock('argon2',()=>({argon2id:2,hash:vi.fn().mockResolvedValue('test-hash'),verify:vi.fn().mockResolvedValue(true)}));
import { AUTH_RATE_LIMITS,AuthService,isPlatformAdminEmail,normalizeEmail } from './auth';
import * as argon2 from 'argon2';

describe('normalizeEmail', () => {
  it('trims whitespace and folds case for tenant deduplication', () => {
    expect(normalizeEmail('  Alice+News@Example.COM ')).toBe('alice+news@example.com');
  });
});

describe('authentication abuse controls',()=>{
 it('keeps registration and login at five requests per minute and reset requests at three',()=>{
  expect(AUTH_RATE_LIMITS).toEqual({register:{limit:5,ttl:60_000},login:{limit:5,ttl:60_000},passwordResetRequest:{limit:3,ttl:60_000},verificationResend:{limit:3,ttl:60_000}});
 });
});

describe('verification resend',()=>{
 beforeEach(()=>{
  db.user.findUnique.mockReset();db.oneTimeToken.updateMany.mockReset();db.oneTimeToken.create.mockReset();db.$executeRaw.mockReset();
  db.$executeRaw.mockResolvedValue(1);db.oneTimeToken.updateMany.mockResolvedValue({count:1});db.oneTimeToken.create.mockResolvedValue({id:'new-token'});
 });
 it('rotates pending account links and returns only the new development capability',async()=>{
  vi.stubEnv('NODE_ENV','development');vi.stubEnv('NEXT_PUBLIC_APP_URL','http://localhost:3000/');
  db.user.findUnique.mockResolvedValue({id:'user-a',tenantId:'tenant-a',name:'Alice',status:'PENDING'});
  const result=await new AuthService().resendVerification(' Alice@Example.Test ');
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith({where:{userId:'user-a',purpose:'verify_email',usedAt:null},data:{usedAt:expect.any(Date)}});
  expect(db.oneTimeToken.create).toHaveBeenCalledWith({data:{tenantId:'tenant-a',userId:'user-a',tokenHash:expect.any(String),tokenEncrypted:expect.any(String),purpose:'verify_email',expiresAt:expect.any(Date)}});
  expect(db.$executeRaw).toHaveBeenCalled();expect(result).toMatchObject({success:true,developmentVerificationUrl:expect.stringMatching(/^http:\/\/localhost:3000\/verify-email\?token=/)});
 });
 it('returns generic success for unknown and already active accounts',async()=>{
  const auth=new AuthService();db.user.findUnique.mockResolvedValue(null);
  await expect(auth.resendVerification('missing@example.test')).resolves.toEqual({success:true});
  db.user.findUnique.mockResolvedValue({id:'active-user',name:'Alice',status:'ACTIVE'});
  await expect(auth.resendVerification('active@example.test')).resolves.toEqual({success:true});
  expect(db.oneTimeToken.create).not.toHaveBeenCalled();
 });
});

describe('password-reset development delivery',()=>{
 beforeEach(()=>{
  db.user.findUnique.mockReset();db.user.findUniqueOrThrow.mockReset();db.oneTimeToken.create.mockReset();
  db.oneTimeToken.create.mockResolvedValue({id:'new-token'});
 });
 it('returns a local reset link without writing the raw token to logs',async()=>{
  vi.stubEnv('NODE_ENV','development');vi.stubEnv('NEXT_PUBLIC_APP_URL','http://localhost:3000/');
  db.user.findUnique.mockResolvedValue({id:'user-a',tenantId:'tenant-a',name:'Alice',status:'ACTIVE'});
  db.user.findUniqueOrThrow.mockResolvedValue({id:'user-a',tenantId:'tenant-a'});
  const info=vi.spyOn(console,'info').mockImplementation(()=>{});
  const result=await new AuthService().requestPasswordReset('alice@example.test');
  const token=new URL(result.developmentResetUrl!).searchParams.get('token');
  expect(result).toMatchObject({success:true,developmentResetUrl:expect.stringMatching(/^http:\/\/localhost:3000\/reset-password\?token=/)});
  expect(db.oneTimeToken.create).toHaveBeenCalledWith({data:{tenantId:'tenant-a',userId:'user-a',tokenHash:expect.any(String),tokenEncrypted:expect.any(String),purpose:'reset_password',expiresAt:expect.any(Date)}});
  expect(token).toBeTruthy();expect(info.mock.calls.flat().join(' ')).not.toContain(token!);
 });
 it('keeps the same development response shape for an unknown address',async()=>{
  vi.stubEnv('NODE_ENV','development');db.user.findUnique.mockResolvedValue(null);
  const result=await new AuthService().requestPasswordReset('unknown@example.test');
  expect(result).toMatchObject({success:true,developmentResetUrl:expect.stringMatching(/\/reset-password\?token=/)});
  expect(db.oneTimeToken.create).not.toHaveBeenCalled();
 });
});

describe('API key authentication',()=>{
 it('derives the tenant and restricted role from a valid hashed key',async()=>{
  db.apiKey.findUnique.mockResolvedValue({id:'key-a',createdByUserId:'user-a',name:'sync key',role:'VIEWER',tenantId:'tenant-a',revokedAt:null,expiresAt:null,createdBy:{name:'Owner',email:'owner@example.test'},tenant:{name:'Acme'}});
  const auth=new AuthService();
  await expect(auth.authenticate('rps_live_secret')).resolves.toMatchObject({id:'user-a',role:'VIEWER',tenantId:'tenant-a',organization:'Acme'});
  expect(db.apiKey.findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{keyHash:expect.any(String)}}));
  expect(db.session.findUnique).not.toHaveBeenCalled();
 });
 it('rejects a key whose hash is unknown or revoked',async()=>{
  db.apiKey.findUnique.mockResolvedValue({id:'key-a',revokedAt:new Date(),expiresAt:null});
  const auth=new AuthService();
  await expect(auth.authenticate('rps_live_revoked')).rejects.toThrow('invalid, expired, or revoked');
 });
 it('rejects an expired key at the expiration boundary',async()=>{
  db.apiKey.findUnique.mockResolvedValue({id:'key-a',revokedAt:null,expiresAt:new Date(Date.now()-1)});
  const auth=new AuthService();
  await expect(auth.authenticate('rps_live_expired')).rejects.toThrow('invalid, expired, or revoked');
 });
});

describe('workspace membership sessions',()=>{
 beforeEach(()=>{
  vi.mocked(argon2.verify).mockResolvedValue(true);
  db.user.findUnique.mockReset();db.organizationMembership.findFirst.mockReset();db.organizationMembership.findUnique.mockReset();db.tenant.findUnique.mockReset();db.tenant.findUniqueOrThrow.mockReset();db.session.create.mockReset();db.session.findUnique.mockReset();db.session.updateMany.mockReset();db.$executeRaw.mockReset();
  db.$executeRaw.mockResolvedValue(1);
 });
 it('creates the initial session in the first active membership and uses its role',async()=>{
  db.user.findUnique.mockResolvedValue({id:'user-a',name:'Alice',email:'alice@example.test',passwordHash:'test-hash',status:'ACTIVE'});
  db.organizationMembership.findFirst.mockResolvedValue({tenantId:'tenant-b',role:'MARKETER'});
  db.tenant.findUniqueOrThrow.mockResolvedValue({id:'tenant-b',name:'Workspace B'});
  db.session.create.mockResolvedValue({id:'session-a'});
  const result=await new AuthService().login('alice@example.test','password');
  expect(result).toMatchObject({user:{id:'user-a',role:'MARKETER'},organization:{id:'tenant-b',name:'Workspace B'}});
  expect(db.session.create).toHaveBeenCalledWith({data:expect.objectContaining({userId:'user-a',tenantId:'tenant-b',tokenHash:expect.any(String)})});
 });
 it('rotates the session and changes workspace only for an active membership',async()=>{
  db.session.findUnique.mockResolvedValue({id:'session-a',userId:'user-a',expiresAt:new Date(Date.now()+60_000)});
  db.user.findUnique.mockResolvedValue({id:'user-a',status:'ACTIVE'});
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'tenant-b',userId:'user-a',role:'VIEWER',status:'ACTIVE'});
  db.tenant.findUnique.mockResolvedValue({id:'tenant-b',name:'Workspace B'});db.session.updateMany.mockResolvedValue({count:1});
  const result=await new AuthService().switchWorkspace('old-session-token','tenant-b');
  expect(result).toMatchObject({organization:{id:'tenant-b',name:'Workspace B'},token:expect.any(String)});
  expect(db.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'session-a',tokenHash:expect.any(String)}),data:expect.objectContaining({tenantId:'tenant-b',tokenHash:expect.any(String)})}));
 });
 it('rejects workspace switching without an active membership and leaves the session untouched',async()=>{
  db.session.findUnique.mockResolvedValue({id:'session-a',userId:'user-a',expiresAt:new Date(Date.now()+60_000)});
  db.user.findUnique.mockResolvedValue({id:'user-a',status:'ACTIVE'});db.organizationMembership.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({tenantId:'tenant-disabled',userId:'user-a',status:'DISABLED'});
  const auth=new AuthService();
  await expect(auth.switchWorkspace('old-session-token','tenant-foreign')).rejects.toThrow('do not have active access');
  await expect(auth.switchWorkspace('old-session-token','tenant-disabled')).rejects.toThrow('do not have active access');
  expect(db.session.updateMany).not.toHaveBeenCalled();
 });
});

describe('account profile',()=>{
 beforeEach(()=>{
  db.session.findUnique.mockReset();db.organizationMembership.findUnique.mockReset();db.tenant.findUnique.mockReset();db.user.findUnique.mockReset();db.user.update.mockReset();db.auditLog.create.mockReset();db.$executeRaw.mockReset();db.$transaction.mockReset();
  db.$executeRaw.mockResolvedValue(1);db.$transaction.mockImplementation(async(fn:any)=>fn(db));
  db.session.findUnique.mockResolvedValue({id:'session-a',userId:'user-a',tenantId:'workspace-b',expiresAt:new Date(Date.now()+60_000),user:{id:'user-a',name:'Alice',email:'alice@example.test',status:'ACTIVE'}});
  db.organizationMembership.findUnique.mockResolvedValue({tenantId:'workspace-b',userId:'user-a',role:'MARKETER',status:'ACTIVE'});
  db.tenant.findUnique.mockResolvedValue({name:'Workspace B'});db.user.findUnique.mockResolvedValue({tenantId:'home-workspace'});
  db.user.update.mockResolvedValue({id:'user-a',name:'Updated Name',email:'alice@example.test',emailVerifiedAt:new Date()});
 });
 it('updates only the signed-in account name from its home-tenant RLS scope and audits the active workspace',async()=>{
  await expect(new AuthService().updateProfile('session-token','  Updated Name  ')).resolves.toMatchObject({name:'Updated Name'});
  expect(db.$executeRaw).toHaveBeenCalledTimes(2);
  expect(db.user.update).toHaveBeenCalledWith({where:{id:'user-a'},data:{name:'Updated Name'},select:{id:true,name:true,email:true,emailVerifiedAt:true}});
  expect(db.auditLog.create).toHaveBeenCalledWith({data:{tenantId:'workspace-b',userId:'user-a',action:'account.profile_updated',entityType:'user',entityId:'user-a',metadata:{fields:['name']}}});
 });
 it('rejects whitespace-only names without writing the account',async()=>{
  await expect(new AuthService().updateProfile('session-token','    ')).rejects.toThrow('Enter a name between 2 and 120 characters.');
  expect(db.user.update).not.toHaveBeenCalled();expect(db.$transaction).not.toHaveBeenCalled();
 });
 it('does not accept workspace API keys for account profile changes',async()=>{
  await expect(new AuthService().updateProfile('rps_live_workspace_key','Name Updated')).rejects.toThrow('sign in');
  expect(db.user.update).not.toHaveBeenCalled();expect(db.$transaction).not.toHaveBeenCalled();
 });
});

describe('session refresh',()=>{
 beforeEach(()=>{db.session.findUnique.mockReset();db.session.updateMany.mockReset();db.user.findUnique.mockReset();db.organizationMembership.findUnique.mockReset();});
 it('rotates a live session token and extends its expiry without returning a reusable old token',async()=>{
  const oldToken='old-session-token';
  db.session.findUnique.mockResolvedValue({id:'session-a',userId:'user-a',tenantId:'tenant-a',expiresAt:new Date(Date.now()+60_000)});
  db.user.findUnique.mockResolvedValue({status:'ACTIVE'});
  db.organizationMembership.findUnique.mockResolvedValue({status:'ACTIVE'});
  db.session.updateMany.mockResolvedValue({count:1});
  const auth=new AuthService();const refreshed=await auth.refresh(oldToken);
  expect(refreshed.token).not.toBe(oldToken);
  expect(refreshed.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now()+6*24*60*60*1000);
  expect(db.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'session-a',tokenHash:expect.any(String)}),data:expect.objectContaining({tokenHash:expect.any(String),expiresAt:refreshed.expiresAt})}));
  expect(db.session.updateMany.mock.calls[0][0].data.tokenHash).not.toBe(db.session.updateMany.mock.calls[0][0].where.tokenHash);
 });
 it('rejects an expired or disabled session without rotating it',async()=>{
  db.session.findUnique.mockResolvedValue({id:'session-a',userId:'user-a',expiresAt:new Date(Date.now()-1)});
  await expect(new AuthService().refresh('expired-token')).rejects.toThrow('session has expired');
  db.session.findUnique.mockResolvedValue({id:'session-b',userId:'user-b',tenantId:'tenant-a',expiresAt:new Date(Date.now()+60_000)});
  db.user.findUnique.mockResolvedValue({status:'DISABLED'});
  await expect(new AuthService().refresh('disabled-token')).rejects.toThrow('session has expired');
  expect(db.session.updateMany).not.toHaveBeenCalled();
 });
 it('rejects a refresh that loses the concurrent rotation race',async()=>{
  db.session.findUnique.mockResolvedValue({id:'session-a',userId:'user-a',tenantId:'tenant-a',expiresAt:new Date(Date.now()+60_000)});
  db.user.findUnique.mockResolvedValue({status:'ACTIVE'});
  db.organizationMembership.findUnique.mockResolvedValue({status:'ACTIVE'});
  db.session.updateMany.mockResolvedValue({count:0});
  await expect(new AuthService().refresh('raced-session-token')).rejects.toThrow('session changed');
 });
 it('does not accept API keys as refreshable sessions',async()=>{
  await expect(new AuthService().refresh('rps_live_key')).rejects.toThrow('sign in');
  expect(db.session.findUnique).not.toHaveBeenCalled();
 });
});

describe('one-time token concurrency',()=>{
 beforeEach(()=>{
  db.oneTimeToken.findUnique.mockReset();db.oneTimeToken.updateMany.mockReset();db.user.update.mockReset();db.session.deleteMany.mockReset();
  db.$transaction.mockReset().mockImplementation(async(fn:any)=>fn(db));
 });
 it('rejects email verification when another request already consumed the token',async()=>{
  db.oneTimeToken.findUnique.mockResolvedValue({id:'token-a',userId:'user-a',purpose:'verify_email',usedAt:null,expiresAt:new Date(Date.now()+60_000)});
  db.oneTimeToken.updateMany.mockResolvedValue({count:0});
  await expect(new AuthService().verifyEmail('valid-verification-token-long-enough')).rejects.toThrow('already used');
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'token-a',purpose:'verify_email',usedAt:null,expiresAt:{gt:expect.any(Date)}})}));
  expect(db.user.update).not.toHaveBeenCalled();
 });
 it('does not change the password or revoke sessions when reset loses the token-consumption race',async()=>{
  db.oneTimeToken.findUnique.mockResolvedValue({id:'token-b',userId:'user-b',purpose:'reset_password',usedAt:null,expiresAt:new Date(Date.now()+60_000)});
  db.oneTimeToken.updateMany.mockResolvedValue({count:0});
  await expect(new AuthService().resetPassword('valid-reset-token-long-enough','a sufficiently long password')).rejects.toThrow('already used');
  expect(db.user.update).not.toHaveBeenCalled();expect(db.session.deleteMany).not.toHaveBeenCalled();
 });
});

describe('platform admin allowlist',()=>{
 it('matches normalized addresses from the explicit deployment allowlist',()=>{
  vi.stubEnv('PLATFORM_ADMIN_EMAILS','ops@example.test, ADMIN@example.test');
  expect(isPlatformAdminEmail(' Ops@Example.Test ')).toBe(true);expect(isPlatformAdminEmail('other@example.test')).toBe(false);
 });
 it('does not grant platform administration through a workspace API key',async()=>{
  vi.stubEnv('PLATFORM_ADMIN_EMAILS','owner@example.test');
  db.apiKey.findUnique.mockResolvedValue({id:'key-a',createdByUserId:'user-a',name:'restricted key',role:'VIEWER',tenantId:'tenant-a',revokedAt:null,expiresAt:null,createdBy:{name:'Owner',email:'owner@example.test'},tenant:{name:'Acme'}});
  const auth=new AuthService();await expect(auth.authenticate('rps_live_secret')).resolves.toMatchObject({platformAdmin:false});
 });
});



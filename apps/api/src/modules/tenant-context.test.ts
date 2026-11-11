import {describe,expect,it,vi,beforeEach} from 'vitest';
import {firstValueFrom,of} from 'rxjs';

const scopes=vi.hoisted(()=>({withApiKey:vi.fn(),withSessionToken:vi.fn()}));
vi.mock('@repus/database',()=>scopes);
import {TenantContextInterceptor} from './tenant-context';

function context(request:any){return {switchToHttp:()=>({getRequest:()=>request})} as any;}

describe('tenant context interceptor',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  scopes.withSessionToken.mockImplementation(async(_hash:string,fn:()=>Promise<unknown>)=>fn());
  scopes.withApiKey.mockImplementation(async(_hash:string,fn:()=>Promise<unknown>)=>({authorized:true,value:await fn()}));
 });

 it('leaves public authentication and capability routes to their narrow database helpers',async()=>{
  const interceptor=new TenantContextInterceptor();
  for(const [method,path] of [['POST','/api/v1/auth/register'],['POST','/api/v1/auth/login'],['POST','/api/v1/auth/login/'],['POST','/api/v1/auth/verify-email'],['POST','/api/v1/auth/verification/resend'],['POST','/api/v1/auth/password-reset/request'],['POST','/api/v1/auth/password-reset/confirm'],['POST','/api/v1/organizations/invitations/accept'],['GET','/api/v1/t/open/capability'],['POST','/api/v1/unsubscribe/capability'],['POST','/api/v1/abuse-reports']]){
   const request={method,path,cookies:{repus_session:'browser-session'},headers:{}};
   await expect(firstValueFrom(interceptor.intercept(context(request),{handle:()=>of('public')} as any))).resolves.toBe('public');
  }
  expect(scopes.withSessionToken).not.toHaveBeenCalled();
  expect(scopes.withApiKey).not.toHaveBeenCalled();
 });

 it('installs the session claim for authenticated workspace routes',async()=>{
  const interceptor=new TenantContextInterceptor();const request={method:'GET',path:'/api/v1/contacts',cookies:{repus_session:'browser-session'},headers:{}};
  await expect(firstValueFrom(interceptor.intercept(context(request),{handle:()=>of('tenant')} as any))).resolves.toBe('tenant');
  expect(scopes.withSessionToken).toHaveBeenCalledWith(expect.any(String),expect.any(Function),{maxWait:10_000,timeout:15_000});
 });

 it('keeps account profile updates inside the authenticated session scope',async()=>{
  const interceptor=new TenantContextInterceptor();const request={method:'PATCH',path:'/api/v1/auth/profile',cookies:{repus_session:'browser-session'},headers:{}};
  await expect(firstValueFrom(interceptor.intercept(context(request),{handle:()=>of('profile')} as any))).resolves.toBe('profile');
  expect(scopes.withSessionToken).toHaveBeenCalledWith(expect.any(String),expect.any(Function),{maxWait:10_000,timeout:15_000});
  expect(scopes.withApiKey).not.toHaveBeenCalled();
 });

 it('installs the API-key tenant claim for bearer-authenticated routes',async()=>{
  const interceptor=new TenantContextInterceptor();const request={method:'GET',path:'/api/v1/contacts',cookies:{},headers:{authorization:'Bearer rps_live_test-token'}};
  await expect(firstValueFrom(interceptor.intercept(context(request),{handle:()=>of('tenant')} as any))).resolves.toBe('tenant');
  expect(scopes.withApiKey).toHaveBeenCalledWith(expect.any(String),expect.any(Function),{maxWait:10_000,timeout:15_000});
 });
});

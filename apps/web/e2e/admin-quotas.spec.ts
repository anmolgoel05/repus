import {expect,test} from '@playwright/test';
import {createPrismaClient,withPlatformAdmin} from '@repus/database';

const email=process.env.E2E_PLATFORM_ADMIN_EMAIL;
const API=(process.env.E2E_API_URL??process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000').replace(/\/$/,'');
const WEB=process.env.E2E_WEB_URL??process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000';
const api=(path:string)=>`${API}/api/v1${path}`;
const prisma=createPrismaClient();
test.afterAll(async()=>prisma.$disconnect());

test('platform admin edits audited workspace defaults without changing existing quotas',async({page,playwright})=>{
 test.skip(!email,'Configure a temporary development operator through E2E_PLATFORM_ADMIN_EMAIL and the API allowlist.');
 expect(process.env.EMAIL_PROVIDER).toBe('development');
 for(const value of [API,WEB,process.env.DATABASE_URL!])expect(['localhost','127.0.0.1','[::1]']).toContain(new URL(value).hostname);
 const [role]=await prisma.$queryRaw<Array<{bypass:boolean;superuser:boolean}>>`SELECT rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname=current_user`;
 expect(role).toEqual({bypass:true,superuser:false});
 expect(email).toMatch(/^repus-admin-e2e-[a-z0-9-]+@example\.test$/);
 expect(await prisma.user.findUnique({where:{normalizedEmail:email!}}),'The operator must be a fresh synthetic account.').toBeNull();
 const nonce=`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
 const peerEmail=`repus-admin-peer-${nonce}@example.test`;
 const password=`Repus-admin-test-${nonce}-long-password`;
 const tenants:string[]=[];
 const ordinary=await playwright.request.newContext({extraHTTPHeaders:{origin:new URL(WEB).origin}});
 let original:any,operatorId:string|undefined;
 async function register(request:typeof page.request,address:string){
  const response=await request.post(api('/auth/register'),{headers:{origin:new URL(WEB).origin},data:{name:'Admin journey tester',organizationName:`Admin test ${nonce}`,email:address,password}});
  expect(response.ok(),await response.text()).toBeTruthy();const account=(await response.json()).data;tenants.push(account.id);
  const token=new URL(account.developmentVerificationUrl).searchParams.get('token');
  expect((await request.post(api('/auth/verify-email'),{data:{token}})).ok()).toBeTruthy();
  expect((await request.post(api('/auth/login'),{headers:{origin:new URL(WEB).origin},data:{email:address,password}})).ok()).toBeTruthy();
  return account.id as string;
 }
 try{
  const homeId=await register(page.request,email!);
  const user=(await (await page.request.get(api('/auth/me'))).json()).data;operatorId=user.id;
  expect(user.platformAdmin).toBe(true);
  const settings=await page.request.get(api('/admin/settings'));expect(settings.ok()).toBeTruthy();original=(await settings.json()).data;
  const originalHome=await prisma.tenantSendingLimit.findUniqueOrThrow({where:{tenantId:homeId}});
  await page.goto('/dashboard/admin');
  await expect(page.getByRole('heading',{name:'Platform admin',exact:true})).toBeVisible();
  const panel=page.locator('form').filter({has:page.getByRole('heading',{name:'New workspace defaults',exact:true})});
  await panel.getByLabel('Default daily allowance').fill('0');await panel.getByLabel('Default monthly allowance').fill('250');
  const updated=page.waitForResponse(response=>response.url()===api('/admin/settings')&&response.request().method()==='PATCH');
  await panel.getByRole('button',{name:'Save workspace defaults'}).click();expect((await updated).ok()).toBeTruthy();
  await expect(panel.getByRole('status')).toHaveText('Workspace defaults saved. Existing workspace quotas are unchanged.');
  expect(await prisma.tenantSendingLimit.findUniqueOrThrow({where:{tenantId:homeId}})).toEqual(originalHome);

  const peerId=await register(ordinary,peerEmail);
  expect(await prisma.tenantSendingLimit.findUniqueOrThrow({where:{tenantId:peerId}})).toMatchObject({dailyLimit:0,monthlyLimit:250});
  expect((await ordinary.get(api('/admin/settings'))).status()).toBe(403);
  expect((await ordinary.patch(api('/admin/settings'),{data:{defaultTenantDailyLimit:100}})).status()).toBe(403);

  await page.goto('/dashboard/workspaces/new');await page.getByLabel('Workspace name').fill(`Default quota workspace ${nonce}`);
  const created=page.waitForResponse(response=>response.url()===api('/organizations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Create and switch'}).click();const createdResponse=await created;expect(createdResponse.ok()).toBeTruthy();const workspace=(await createdResponse.json()).data;tenants.push(workspace.id);
  await page.waitForURL('**/dashboard');
  expect(await prisma.tenantSendingLimit.findUniqueOrThrow({where:{tenantId:workspace.id}})).toMatchObject({dailyLimit:0,monthlyLimit:250});
  await page.goto('/dashboard/admin');
  await panel.getByLabel('Default daily allowance').fill('');await panel.getByLabel('Default monthly allowance').fill('');
  const reset=page.waitForResponse(response=>response.url()===api('/admin/settings')&&response.request().method()==='PATCH');
  await panel.getByRole('button',{name:'Save workspace defaults'}).click();const resetResponse=await reset;expect(resetResponse.ok()).toBeTruthy();
  expect((await resetResponse.json()).data).toMatchObject({defaultTenantDailyLimit:null,defaultTenantMonthlyLimit:null,tenantDefaults:{dailyLimit:Number(process.env.DEFAULT_TENANT_DAILY_LIMIT??500),monthlyLimit:Number(process.env.DEFAULT_TENANT_MONTHLY_LIMIT??15000)}});
  expect(await prisma.tenantSendingLimit.findUniqueOrThrow({where:{tenantId:workspace.id}})).toMatchObject({dailyLimit:0,monthlyLimit:250});
  const audit=await withPlatformAdmin(()=>prisma.platformAuditLog.findMany({where:{actorUserId:operatorId,action:'platform.sending_limits.updated'}}));
  expect(audit.some(record=>(record.metadata as any).limits?.defaultTenantDailyLimit===0&&(record.metadata as any).limits?.defaultTenantMonthlyLimit===250)).toBe(true);
 }finally{
  if(original)await withPlatformAdmin(()=>prisma.platformControl.update({where:{id:1},data:{defaultTenantDailyLimit:original.defaultTenantDailyLimit,defaultTenantMonthlyLimit:original.defaultTenantMonthlyLimit,updatedByUserId:original.updatedByUserId,updatedAt:new Date(original.updatedAt)}}));
  await ordinary.dispose();
  for(const address of [email!,peerEmail]){const user=await prisma.user.findUnique({where:{normalizedEmail:address},select:{tenantId:true}});if(user&&!tenants.includes(user.tenantId))tenants.push(user.tenantId);}
  for(const tenantId of [...new Set(tenants)].reverse())await prisma.tenant.delete({where:{id:tenantId}});
 }
});

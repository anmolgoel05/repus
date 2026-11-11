import {expect,test} from '@playwright/test';

test('web responses protect token pages and prevent embedding',async({request})=>{
 for(const route of ['/','/login','/verify-email?token=header-check','/reset-password?token=header-check','/accept-invitation?token=header-check','/confirm-subscription/header-check','/dashboard/contacts']){
  const response=await request.get(route);
  expect(response.status(),route).toBe(200);
  const headers=response.headers();
  expect(headers['referrer-policy'],route).toBe('no-referrer');
  expect(headers['x-content-type-options'],route).toBe('nosniff');
  expect(headers['x-frame-options'],route).toBe('DENY');
  expect(headers['content-security-policy'],route).toContain("frame-ancestors 'none'");
  if(route!=='/'&&route!=='/login')expect(headers['cache-control'],route).toContain('no-store');
 }
});

test.describe('credential forms before hydration',()=>{
 test.use({javaScriptEnabled:false});

 test('password forms use POST and password reset waits for hydration',async({page})=>{
  for(const route of ['/login','/register','/accept-invitation?token=header-check','/reset-password?token=header-check']){
   await page.goto(route);
   await expect(page.locator('form.auth-card')).toHaveAttribute('method','post');
  }
  await expect(page.getByRole('button',{name:'Update password'})).toBeDisabled();
 });
});

test('workspace loading offers retry for service failures and redirects on expired sessions',async({page})=>{
 let status=503;
 await page.route('**/api/v1/auth/me',route=>route.fulfill({status,json:{},headers:{
  'access-control-allow-origin':new URL(page.url()).origin,
  'access-control-allow-credentials':'true',
 }}));
 await page.goto('/dashboard');
 await expect(page.getByRole('alert').filter({hasText:'We couldn’t load your workspace'})).toBeVisible();
 status=401;
 await page.getByRole('button',{name:'Try again'}).click();
 await expect(page).toHaveURL(/\/login$/);
});

test('background refresh keeps the workspace open through a temporary session-check failure',async({page,baseURL})=>{
 const headers={'access-control-allow-origin':new URL(baseURL!).origin,'access-control-allow-credentials':'true'};
 let sessionStatus=200;
 const user={id:'user',tenantId:'workspace',name:'Test user',organization:'Test workspace'};
 await page.route('**/api/v1/auth/me',route=>route.fulfill({status:sessionStatus,json:{data:user},headers}));
 await page.route('**/api/v1/organizations',route=>route.fulfill({json:{data:[{id:user.tenantId,name:user.organization,role:'OWNER'}]},headers}));
 await page.route('**/api/v1/auth/refresh',route=>route.fulfill({status:401,json:{},headers}));
 await page.clock.install();
 await page.goto('/dashboard');
 await expect(page.getByRole('button',{name:'Log out'})).toBeVisible();
 sessionStatus=503;
 const unavailable=page.waitForResponse(response=>response.url().endsWith('/auth/me')&&response.status()===503);
 await page.clock.fastForward(6*60*60*1000);
 await unavailable;
 await expect(page.getByRole('button',{name:'Log out'})).toBeVisible();
 sessionStatus=401;
 await page.clock.fastForward(6*60*60*1000);
 await expect(page).toHaveURL(/\/login$/);
});

test('a failed workspace switch preserves the selection and can be retried',async({page,baseURL})=>{
 const headers={'access-control-allow-origin':new URL(baseURL!).origin,'access-control-allow-credentials':'true','access-control-allow-headers':'content-type'};
 const workspaces=[{id:'first',name:'First workspace',role:'OWNER'},{id:'second',name:'Second workspace',role:'OWNER'}];
 let selected=workspaces[0];
 let fail=true;
 await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{data:{id:'user',name:'Test user',tenantId:selected.id,organization:selected.name}},headers}));
 await page.route('**/api/v1/organizations',route=>route.fulfill({json:{data:workspaces},headers}));
 await page.route('**/api/v1/auth/switch-workspace',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{...headers,'access-control-allow-methods':'POST'}});
  expect(route.request().postDataJSON()).toEqual({tenantId:'second'});
  if(fail)return route.fulfill({status:503,json:{},headers});
  selected=workspaces[1];
  return route.fulfill({json:{},headers});
 });
 await page.goto('/dashboard');
 const selector=page.getByRole('combobox',{name:'Switch workspace'});
 await selector.selectOption('second');
 await expect(page.getByRole('alert').filter({hasText:'We couldn’t switch workspaces'})).toBeVisible();
 await expect(selector).toHaveValue('first');
 fail=false;
 await selector.selectOption('second');
 await expect(selector).toHaveValue('second');
 await expect(page.getByRole('alert').filter({hasText:'We couldn’t switch workspaces'})).toHaveCount(0);
});

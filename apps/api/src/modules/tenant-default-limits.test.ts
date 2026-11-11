import {afterEach,describe,expect,it,vi} from 'vitest';
const findUniqueOrThrow=vi.hoisted(()=>vi.fn());
vi.mock('@repus/database',()=>({prisma:{platformControl:{findUniqueOrThrow}},withTrustedWorker:async(fn:()=>Promise<unknown>)=>fn()}));
import {defaultTenantLimits} from './tenant-default-limits';
afterEach(()=>vi.unstubAllEnvs());
describe('new workspace quota defaults',()=>{
 it('uses persisted zero limits rather than replacing them with environment defaults',async()=>{
  vi.stubEnv('DEFAULT_TENANT_DAILY_LIMIT','500');vi.stubEnv('DEFAULT_TENANT_MONTHLY_LIMIT','15000');
  findUniqueOrThrow.mockResolvedValue({defaultTenantDailyLimit:0,defaultTenantMonthlyLimit:0});
  expect(await defaultTenantLimits()).toEqual({dailyLimit:0,monthlyLimit:0});
 });
 it('falls back independently to configured environment values when reset to null',async()=>{
  vi.stubEnv('DEFAULT_TENANT_DAILY_LIMIT','25');vi.stubEnv('DEFAULT_TENANT_MONTHLY_LIMIT','750');
  findUniqueOrThrow.mockResolvedValue({defaultTenantDailyLimit:10,defaultTenantMonthlyLimit:null});
  expect(await defaultTenantLimits()).toEqual({dailyLimit:10,monthlyLimit:750});
 });
});

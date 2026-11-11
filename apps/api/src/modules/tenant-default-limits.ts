import {prisma,withTrustedWorker} from '@repus/database';
import {nonNegativeIntegerConfig} from '@repus/validation';

export async function defaultTenantLimits(){
 const control=await withTrustedWorker(()=>prisma.platformControl.findUniqueOrThrow({where:{id:1},select:{defaultTenantDailyLimit:true,defaultTenantMonthlyLimit:true}}),{maxWait:5000,timeout:8000});
 return resolveDefaultTenantLimits(control);
}
export function resolveDefaultTenantLimits(control:{defaultTenantDailyLimit?:number|null;defaultTenantMonthlyLimit?:number|null}){
 return {
  dailyLimit:control.defaultTenantDailyLimit??nonNegativeIntegerConfig(process.env.DEFAULT_TENANT_DAILY_LIMIT,500,'DEFAULT_TENANT_DAILY_LIMIT'),
  monthlyLimit:control.defaultTenantMonthlyLimit??nonNegativeIntegerConfig(process.env.DEFAULT_TENANT_MONTHLY_LIMIT,15000,'DEFAULT_TENANT_MONTHLY_LIMIT'),
 };
}

import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL DateTime instants',()=>{
 let prisma:any,tenantId:string;
 const previousUrl=process.env.DATABASE_URL;
 const instant=new Date('2026-01-15T12:34:56.789Z');
 beforeAll(async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL!);
  // Deliberately request a non-UTC session: the factory must pin its final value.
  url.searchParams.set('options','-c timezone=Pacific/Auckland');
  process.env.DATABASE_URL=url.toString();
  prisma=(await import('./index')).createPrismaClient();
  const tenant=await prisma.tenant.create({data:{name:'DateTime regression',slug:'datetime-'+randomUUID()}});tenantId=tenant.id;
 });
 afterAll(async()=>{
  if(tenantId)await prisma.tenant.delete({where:{id:tenantId}});
  await prisma?.$disconnect();
  if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
 });
 it('pins pooled connections to UTC even with conflicting URL timezone options',async()=>{
  const settings=await prisma.$queryRaw`SELECT current_setting('TimeZone') AS timezone`;
  expect(settings[0].timezone).toBe('UTC');
 });
 it('stores and compares a scheduled instant without server-local timezone drift',async()=>{
  const campaign=await prisma.campaign.create({data:{tenantId,name:'Absolute scheduled instant',status:'SCHEDULED',scheduledAt:instant}});
  const persisted=await prisma.$queryRaw`SELECT scheduled_at FROM campaigns WHERE id=${campaign.id}::uuid`;
  expect(persisted[0].scheduled_at.toISOString()).toBe(instant.toISOString());
  const due=await prisma.campaign.count({where:{id:campaign.id,scheduledAt:{lte:instant}}});
  const notDue=await prisma.campaign.count({where:{id:campaign.id,scheduledAt:{lt:instant}}});
  expect(due).toBe(1);expect(notDue).toBe(0);
 });
});

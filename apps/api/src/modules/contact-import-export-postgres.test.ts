import {randomUUID} from 'node:crypto';
import {Writable} from 'node:stream';
import type {Request,Response} from 'express';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';

vi.mock('bullmq',()=>({Queue:class{}}));
vi.mock('ioredis',()=>({default:class{}}));

const databaseUrl=process.env.RLS_TEST_DATABASE_URL;
const previousUrl=process.env.DATABASE_URL;
let database:typeof import('@repus/database')|undefined;
let tenantId:string|undefined;

beforeAll(()=>{if(databaseUrl)process.env.DATABASE_URL=databaseUrl;});
afterAll(async()=>{
 try{
  if(database&&tenantId){const {prisma,withPlatformAdmin}=database;await withPlatformAdmin(()=>prisma.tenant.delete({where:{id:tenantId}}));}
 }finally{
  if(database)await database.prisma.$disconnect();
  if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
 }
});

it.skipIf(!databaseUrl)('streams sparse rejection rows across pages without mixing import jobs',async()=>{
 database=await import('@repus/database');
 const {prisma,withTenant,withPlatformAdmin}=database;
 const tenant=await withPlatformAdmin(()=>prisma.tenant.create({data:{name:'CSV report regression',slug:`csv-report-${randomUUID()}`}}));
 tenantId=tenant.id;
 const expectedRowNumbers=Array.from({length:501},(_,index)=>2+index*3);
 const {id}=await withTenant(tenant.id,async()=>{
  const job=await prisma.importJob.create({data:{tenantId:tenant.id,fileKey:`${tenant.id}/${randomUUID()}.csv`}});
  const otherJob=await prisma.importJob.create({data:{tenantId:tenant.id,fileKey:`${tenant.id}/${randomUUID()}.csv`}});
  await prisma.importError.createMany({data:[
   ...expectedRowNumbers.map(rowNumber=>({tenantId:tenant.id,importJobId:job.id,rowNumber,reason:'Invalid date',rowData:{}})),
   {tenantId:tenant.id,importJobId:otherJob.id,rowNumber:3,reason:'Unrelated job',rowData:{}},
  ]});
  return job;
 });
 const {ContactImportsService}=await import('./contact-imports');
 const service=new ContactImportsService({authenticate:async()=>({tenantId:tenant.id})} as ConstructorParameters<typeof ContactImportsService>[0]);
 const chunks:Buffer[]=[];
 const response=Object.assign(new Writable({write(chunk,_encoding,done){chunks.push(chunk);done();}}),{setHeader:vi.fn()});
 await withTenant(tenant.id,()=>service.errors({} as Request,id,response as unknown as Response));
 const [header,...rows]=Buffer.concat(chunks).toString().trimEnd().split(/\r?\n/);
 expect(header).toContain('row_number');
 expect(rows.map(row=>Number(row.split(',')[0].replaceAll('"','')))).toEqual(expectedRowNumbers);
},30_000);

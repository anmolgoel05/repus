import 'reflect-metadata';
import {describe,expect,it,vi} from 'vitest';
import {ValidationPipe} from '@nestjs/common';

vi.mock('@repus/database',()=>({prisma:{}}));
vi.mock('bullmq',()=>({Queue:class{}}));
vi.mock('ioredis',()=>({default:class{}}));
import {ScheduleDto,UpdateCampaignDto} from './campaigns';
import {UpdateListDto} from './lists';
import {UpdateTemplateDto} from './templates';

const pipe=new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true});
it.each(['2026-11-10','2026-11-10T12:00','2026-02-30T12:00:00Z'])('rejects ambiguous or invalid schedule timestamp %s',async scheduledAt=>{
 await expect(pipe.transform({scheduledAt},{type:'body',metatype:ScheduleDto})).rejects.toThrow();
});
it.each(['2026-11-10T12:00:00.000Z','2026-11-10T12:00:00+05:30'])('accepts an explicit schedule instant %s',async scheduledAt=>{
 await expect(pipe.transform({scheduledAt},{type:'body',metatype:ScheduleDto})).resolves.toMatchObject({scheduledAt});
});
describe.each([
 {name:'campaign',type:UpdateCampaignDto},
 {name:'list',type:UpdateListDto},
 {name:'template',type:UpdateTemplateDto},
])('$name PATCH validation',({type})=>{
 it('permits a partial edit without requiring every create field',async()=>{
  await expect(pipe.transform({name:'Updated name'},{type:'body',metatype:type})).resolves.toMatchObject({name:'Updated name'});
 });
 it('rejects client-controlled tenant, status, and other unknown properties',async()=>{
  await expect(pipe.transform({name:'Updated name',tenantId:'foreign',status:'SENT'},{type:'body',metatype:type})).rejects.toThrow();
 });
 it('rejects a whitespace-only name',async()=>{
  await expect(pipe.transform({name:'   '},{type:'body',metatype:type})).rejects.toThrow();
 });
});

it('retains campaign email validation on partial updates',async()=>{
 await expect(pipe.transform({fromEmail:'invalid-address'},{type:'body',metatype:UpdateCampaignDto})).rejects.toThrow();
});

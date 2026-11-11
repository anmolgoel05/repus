import {afterEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@repus/database';
import {deleteExpiredResolvedAbuseReports,RESOLVED_ABUSE_REPORT_RETENTION_DAYS} from './abuse-report-retention';

describe('resolved abuse report retention',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('deletes only resolved or rejected reports older than one year since the last status change',async()=>{
  const deleteMany=vi.fn().mockResolvedValue({count:3});
  const now=new Date('2026-10-30T00:00:00.000Z');
  await expect(deleteExpiredResolvedAbuseReports({abuseReport:{deleteMany}} as unknown as Pick<PrismaClient,'abuseReport'>,now)).resolves.toBe(3);
  expect(deleteMany).toHaveBeenCalledWith({where:{status:{in:['resolved','rejected']},updatedAt:{lt:new Date(now.getTime()-RESOLVED_ABUSE_REPORT_RETENTION_DAYS*24*60*60*1000)}}});
 });
});

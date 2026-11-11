import type {PrismaClient} from '@repus/database';

/** Retain resolved abuse reports for one year after their last status change. */
export const RESOLVED_ABUSE_REPORT_RETENTION_DAYS=365;
const DAY_MS=24*60*60*1000;

export async function deleteExpiredResolvedAbuseReports(database:Pick<PrismaClient,'abuseReport'>,now=new Date()){
 const cutoff=new Date(now.getTime()-RESOLVED_ABUSE_REPORT_RETENTION_DAYS*DAY_MS);
 if(!Number.isFinite(cutoff.getTime()))throw new Error('Invalid report retention clock.');
 const result=await database.abuseReport.deleteMany({where:{status:{in:['resolved','rejected']},updatedAt:{lt:cutoff}}});
 return result.count;
}

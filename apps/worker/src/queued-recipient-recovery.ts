import type {PrismaClient} from '@repus/database';
import type {Queue} from 'bullmq';
import {EMAIL_JOB_PRIORITIES} from '@repus/validation';

export function recipientQueueJob(id:string){
  return {name:'send',data:{recipientId:id},opts:{priority:EMAIL_JOB_PRIORITIES.campaign,jobId:`recipient-${id}`,attempts:5,backoff:{type:'exponential' as const,delay:5000},removeOnComplete:true,removeOnFail:false}};
}

export async function publishQueuedRecipientBatch(
  prisma:PrismaClient,
  queue:Queue,
  afterId?:string,
  batchSize=500,
):Promise<{count:number;nextCursor?:string;done:boolean}>{
  const rows=await prisma.campaignRecipient.findMany({
    where:{status:'QUEUED',campaign:{is:{status:{not:'PAUSED'}}},...(afterId?{id:{gt:afterId}}:{})},
    orderBy:{id:'asc'},take:batchSize,select:{id:true},
  });
  if(!rows.length)return {count:0,done:true};
  await queue.addBulk(rows.map(({id})=>recipientQueueJob(id)));
  return {count:rows.length,nextCursor:rows[rows.length-1].id,done:false};
}

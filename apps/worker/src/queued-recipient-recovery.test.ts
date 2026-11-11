import {describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@repus/database';
import type {Queue} from 'bullmq';
import {publishQueuedRecipientBatch,recipientQueueJob} from './queued-recipient-recovery';

describe('queued recipient recovery paging',()=>{
  it('removes completed recipient job IDs so pause/resume can requeue recipients',()=>{
    expect(recipientQueueJob('recipient-a')).toEqual({name:'send',data:{recipientId:'recipient-a'},opts:{priority:10,jobId:'recipient-recipient-a',attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:false}});
  });
  it('advances through bounded recipient pages so later rows are recoverable',async()=>{
    const findMany=vi.fn()
      .mockResolvedValueOnce([{id:'recipient-a'},{id:'recipient-b'}])
      .mockResolvedValueOnce([{id:'recipient-c'}])
      .mockResolvedValueOnce([]);
    const queue={addBulk:vi.fn().mockResolvedValue([])};
    const db={campaignRecipient:{findMany}};

    const first=await publishQueuedRecipientBatch(db as unknown as PrismaClient,queue as unknown as Queue,undefined,2);
    const second=await publishQueuedRecipientBatch(db as unknown as PrismaClient,queue as unknown as Queue,first.nextCursor,2);
    const done=await publishQueuedRecipientBatch(db as unknown as PrismaClient,queue as unknown as Queue,second.nextCursor,2);

    expect(first).toEqual({count:2,nextCursor:'recipient-b',done:false});
    expect(second).toEqual({count:1,nextCursor:'recipient-c',done:false});
    expect(done).toEqual({count:0,done:true});
    expect(findMany.mock.calls[1][0]).toMatchObject({where:{status:'QUEUED',campaign:{is:{status:{not:'PAUSED'} }},id:{gt:'recipient-b'}},take:2});
    expect(queue.addBulk).toHaveBeenCalledTimes(2);
    expect(queue.addBulk).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({data:{recipientId:'recipient-a'},opts:expect.objectContaining({jobId:'recipient-recipient-a',removeOnComplete:true})}),
    ]));
  });
});


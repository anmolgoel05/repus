import {beforeEach,describe,expect,it,vi} from 'vitest';

const {findMany}=vi.hoisted(()=>({findMany:vi.fn()}));
vi.mock('@repus/database',()=>({
 prisma:{platformQueueHealthSample:{findMany}},
 withPlatformAdmin:async(callback:()=>Promise<unknown>)=>callback(),
}));

import {ForbiddenException} from '@nestjs/common';
import {PlatformHealthService} from './platform-health';

describe('platform queue health history access',()=>{
 beforeEach(()=>{findMany.mockReset();});

 it('returns only the newest 100 aggregate snapshots to a platform admin',async()=>{
  const rows=[{checkedAt:new Date('2026-10-30T00:00:00.000Z'),queues:[],failedJobCount:2,healthCheckFailures:0}];
  findMany.mockResolvedValue(rows);
  const auth={authenticate:vi.fn().mockResolvedValue({platformAdmin:true})};
  const service=new PlatformHealthService(auth as any);
  await expect(service.history({cookies:{repus_session:'valid'}} as any)).resolves.toBe(rows);
  expect(findMany).toHaveBeenCalledWith({orderBy:{checkedAt:'desc'},take:100,select:{checkedAt:true,queues:true,failedJobCount:true,healthCheckFailures:true}});
 });

 it('does not query history for an ordinary workspace user',async()=>{
  const auth={authenticate:vi.fn().mockResolvedValue({platformAdmin:false})};
  const service=new PlatformHealthService(auth as any);
  await expect(service.history({cookies:{repus_session:'tenant-session'}} as any)).rejects.toBeInstanceOf(ForbiddenException);
  expect(findMany).not.toHaveBeenCalled();
 });
});

import {describe,expect,it,vi} from 'vitest';
import {sweepOrphanedImages} from './image-orphan-sweep';

const now=new Date('2026-10-30T12:00:00.000Z');
describe('stale private image orphan sweep',()=>{
 it('preserves registered assets and young uploads while deleting old orphan objects',async()=>{
  const remove=vi.fn().mockResolvedValue(undefined),findRegistered=vi.fn().mockResolvedValue(['tenant/image-kept.png']);
  const result=await sweepOrphanedImages({now,list:async()=>({objects:[{key:'tenant/image-kept.png',lastModified:new Date(now.getTime()-48*60*60*1000)},{key:'tenant/image-orphan.png',lastModified:new Date(now.getTime()-48*60*60*1000)},{key:'tenant/image-new.png',lastModified:new Date(now.getTime()-1000)}],nextCursor:'page-2'}),findRegistered,remove});
  expect(findRegistered).toHaveBeenCalledWith(['tenant/image-kept.png','tenant/image-orphan.png']);expect(remove).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledWith('tenant/image-orphan.png');expect(result).toMatchObject({nextCursor:'page-2',scanned:3,stale:2,removed:1,failed:0});
 });
 it('continues after individual object-delete failures',async()=>{
  const remove=vi.fn().mockRejectedValue(new Error('storage unavailable'));
  const result=await sweepOrphanedImages({now,list:async()=>({objects:[{key:'tenant/orphan.png',lastModified:new Date(now.getTime()-48*60*60*1000)}]}),findRegistered:async()=>[],remove});
  expect(result).toMatchObject({removed:0,failed:1});
 });
});

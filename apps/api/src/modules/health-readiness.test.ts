import {describe,expect,it,vi} from 'vitest';
import {checkApiReadiness} from './health-readiness';

describe('API dependency readiness',()=>{
 it('reports database and Redis readiness without exposing connection details',async()=>{
  const result=await checkApiReadiness({database:async()=>1,redis:async()=>'PONG'});
  expect(result).toMatchObject({status:'ok',service:'repus-api',dependencies:{database:'available',redis:'available'}});
 });

 it('returns safe dependency statuses when a check fails or times out',async()=>{
  const failure=await checkApiReadiness({database:async()=>1,redis:async()=>{throw new Error('redis://private:secret@host');}},5);
  expect(failure).toMatchObject({status:'unavailable',dependencies:{database:'available',redis:'unavailable'}});
  expect(JSON.stringify(failure)).not.toContain('private:secret');
  const timeout=await checkApiReadiness({database:()=>new Promise(()=>{})},1);
  expect(timeout).toMatchObject({status:'unavailable',dependencies:{database:'unavailable'}});
 });

 it('runs dependency probes concurrently',async()=>{
  const first=vi.fn(async()=>1),second=vi.fn(async()=>1);
  await checkApiReadiness({database:first,redis:second});
  expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce();
 });
});

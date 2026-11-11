import {describe,expect,it,vi} from 'vitest';
import {singleFlight} from './single-flight';

describe('single-flight task guard',()=>{
  it('ignores overlapping ticks and allows the next tick after completion',async()=>{
    let release!:()=>void;
    const operation=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
    const run=singleFlight(operation);

    const active=run();
    await expect(run()).resolves.toBeUndefined();
    expect(operation).toHaveBeenCalledTimes(1);
    release();
    await active;
    const next=run();
    expect(operation).toHaveBeenCalledTimes(2);
    release();
    await next;
  });
});

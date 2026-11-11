import {describe,expect,it,vi} from 'vitest';
import {triggerBlobDownload,type BrowserDownloadEnvironment} from './browser-download';

describe('browser blob downloads',()=>{
 it('keeps the anchor and object URL alive until the download has started',()=>{
  const anchor={href:'',download:'',click:vi.fn(),remove:vi.fn()} as unknown as HTMLAnchorElement;
  const scheduled:Array<()=>void>=[];
  const environment:BrowserDownloadEnvironment={
   createObjectURL:vi.fn().mockReturnValue('blob:repus-export'),
   revokeObjectURL:vi.fn(),
   createAnchor:vi.fn().mockReturnValue(anchor),
   appendAnchor:vi.fn(),
   defer:vi.fn((callback:()=>void,milliseconds:number)=>{expect(milliseconds).toBe(1000);scheduled.push(callback);}),
  };
  triggerBlobDownload({} as Blob,'repus-export.csv',environment);
  expect(anchor.href).toBe('blob:repus-export');
  expect(anchor.download).toBe('repus-export.csv');
  expect(environment.appendAnchor).toHaveBeenCalledWith(anchor);
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).not.toHaveBeenCalled();
  expect(environment.revokeObjectURL).not.toHaveBeenCalled();
  scheduled[0]?.();
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(environment.revokeObjectURL).toHaveBeenCalledWith('blob:repus-export');
 });
});

import {afterEach,expect,it,vi} from 'vitest';
import {Worker} from 'bullmq';
import {processProviderEvent} from './processor';

const resources=vi.hoisted(()=>({worker:{close:vi.fn(),on:vi.fn()},connection:{quit:vi.fn(),on:vi.fn()},database:vi.fn()}));
vi.mock('./processor',()=>({processProviderEvent:vi.fn(),closeProviderEventDatabase:resources.database}));
vi.mock('bullmq',()=>({Worker:vi.fn(function(){return resources.worker;})}));
vi.mock('ioredis',()=>({default:vi.fn(function(){return resources.connection;})}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

it('drains active event processing before closing the database and handles repeated shutdown signals once',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('EMAIL_PROVIDER','development');vi.stubEnv('AWS_SES_SQS_URL','');
 let finishDrain!:()=>void;
 resources.worker.close.mockReturnValue(new Promise<void>(resolve=>{finishDrain=resolve;}));
 resources.connection.quit.mockResolvedValue('OK');resources.database.mockResolvedValue(undefined);
 const handlers=new Map<string,()=>void>();
 const originalOn=process.on.bind(process);
 vi.spyOn(process,'on').mockImplementation(((event:string,listener:any)=>{
  if(event==='SIGTERM'||event==='SIGINT'){handlers.set(event,listener);return process;}
  return originalOn(event,listener);
 }) as any);
 await import('./main');
 const logError=vi.spyOn(console,'error').mockImplementation(()=>{});
 const privateError=new Error('Connection failed for private.example.test');
 expect(resources.connection.on).toHaveBeenCalledWith('error',expect.any(Function));
 expect(resources.worker.on).toHaveBeenCalledWith('error',expect.any(Function));
 resources.connection.on.mock.calls[0][1](privateError);
 resources.worker.on.mock.calls[0][1](privateError);
 expect(logError.mock.calls).toEqual([
  ['Provider event Redis connection failed.'],
  ['Provider event queue worker encountered an infrastructure error.'],
 ]);
 const execute=vi.mocked(Worker).mock.calls[0][1];
 vi.mocked(processProviderEvent).mockRejectedValueOnce(new Error('Failed event for private@example.test'));
 await expect((execute as (job: {data: unknown})=>Promise<unknown>)({data:{}})).rejects.toThrow(/^Provider event processing failed\.$/);
 expect(handlers.size).toBe(2);
 handlers.get('SIGTERM')!();handlers.get('SIGTERM')!();handlers.get('SIGINT')!();
 expect(resources.worker.close).toHaveBeenCalledTimes(1);
 expect(resources.connection.quit).not.toHaveBeenCalled();expect(resources.database).not.toHaveBeenCalled();
 finishDrain();
 await vi.waitFor(()=>expect(resources.database).toHaveBeenCalledTimes(1));
 expect(resources.connection.quit).toHaveBeenCalledTimes(1);
});

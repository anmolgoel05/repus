import {expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({
 workerClose:vi.fn(),queueClose:vi.fn().mockResolvedValue(undefined),quit:vi.fn().mockResolvedValue('OK'),disconnect:vi.fn().mockResolvedValue(undefined),
 findMany:vi.fn().mockResolvedValue([]),findUnique:vi.fn(),updateMany:vi.fn(),process:vi.fn(),getImportReadStream:vi.fn(),handlers:new Map<string,(...args:any[])=>void>(),queueOn:vi.fn(),redisOn:vi.fn(),
 readCsvRecords:vi.fn(),lockImport:vi.fn(),lockTenant:vi.fn(),
}));
vi.mock('bullmq',()=>({
 Worker:class{constructor(_name:string,processor:(job:unknown)=>Promise<void>){state.process.mockImplementation(processor);}close=state.workerClose;on(event:string,handler:(...args:any[])=>void){state.handlers.set(event,handler);return this;}},
 Queue:class{close=state.queueClose;on=state.queueOn;},
}));
vi.mock('ioredis',()=>({default:class{quit=state.quit;on=state.redisOn;}}));
vi.mock('@repus/database',()=>({createPrismaClient:()=>({importJob:{findMany:state.findMany,findUnique:state.findUnique,updateMany:state.updateMany},customFieldDefinition:{findMany:async()=>[]},$transaction:(run:(tx:unknown)=>Promise<unknown>)=>run({$queryRaw:state.lockImport,$executeRaw:state.lockTenant}),$disconnect:state.disconnect})}));
vi.mock('@repus/validation',()=>({emailSchema:{}}));
vi.mock('@repus/import-storage',()=>({deleteImportFile:vi.fn().mockResolvedValue(undefined),getImportReadStream:state.getImportReadStream,readCsvRecords:state.readCsvRecords}));
vi.mock('@repus/token-security',()=>({createOpaqueToken:vi.fn(),encryptToken:vi.fn(),tokenHash:vi.fn()}));

it('skips replayed rows and drains jobs, reconciliation and failure writes before shutdown',async()=>{
 vi.useFakeTimers();
 let releaseWorker!:()=>void,releaseReconcile!:(rows:any[])=>void,releaseFailure!:(result:any)=>void;
 state.workerClose.mockImplementation(()=>new Promise<void>(resolve=>{releaseWorker=resolve;}));
 state.findMany.mockResolvedValue([]).mockImplementationOnce(()=>new Promise(resolve=>{releaseReconcile=resolve;}));
 state.updateMany.mockImplementation(()=>new Promise(resolve=>{releaseFailure=resolve;}));
 const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{});
 const {closeImportWorker}=await import('./import-worker');
 const privateError=new Error('Connection failed for private.example.test');
 expect(state.redisOn).toHaveBeenCalledTimes(2);
 for(const [event,handler] of [...state.redisOn.mock.calls,...state.queueOn.mock.calls]){
  expect(event).toBe('error');
  handler(privateError);
 }
 state.handlers.get('error')!(privateError);
 expect(errorLog.mock.calls).toEqual([
  ['CSV import Redis connection failed.'],['CSV import Redis connection failed.'],
  ['CSV import queue encountered an infrastructure error.'],['CSV import worker encountered an infrastructure error.'],
 ]);
 errorLog.mockClear();
 state.findUnique.mockResolvedValue({id:'import-a',attempt:1,status:'PROCESSING'});
 await state.process({id:'import-import-a-0',data:{importId:'import-a'}});
 expect(state.getImportReadStream).not.toHaveBeenCalled();
 state.findUnique.mockResolvedValue({id:'import-a',attempt:1,status:'PROCESSING',tenantId:'tenant-a',fileKey:'fixture.csv',consentSource:'fixture',consentAt:new Date(),fieldMapping:{email:'email'},csvHeaders:['email'],processedRows:0,totalRows:1});
 state.getImportReadStream.mockRejectedValueOnce(new Error('Could not read row for private@example.test'));
 await expect(state.process({id:'import-import-a-1',data:{importId:'import-a'}})).rejects.toThrow(/^CSV import processing failed\.$/);
 state.readCsvRecords.mockReturnValue([['email'],['replayed@example.test']]);
 state.lockImport.mockResolvedValue([{status:'PROCESSING',attempt:1,processedRows:1}]);
 state.updateMany.mockResolvedValueOnce({count:1});
 await state.process({id:'import-import-a-1',data:{importId:'import-a'}});
 expect(state.lockImport).toHaveBeenCalledOnce();
 expect(state.lockTenant).not.toHaveBeenCalled();
 state.handlers.get('failed')!({id:'import-import-a-0',attemptsMade:1,opts:{attempts:1},data:{importId:'import-a'}},new Error('failed batch'));
 expect(errorLog).toHaveBeenCalledExactlyOnceWith('CSV import attempt failed.');
 expect(state.updateMany).toHaveBeenCalledWith({where:{id:'import-a',attempt:0,status:'PROCESSING'},data:{status:'FAILED',completedAt:expect.any(Date)}});
 const closing=closeImportWorker();
 try{
  expect(closeImportWorker()).toBe(closing);
  expect(state.quit).not.toHaveBeenCalled();expect(state.disconnect).not.toHaveBeenCalled();
  releaseWorker();await Promise.resolve();
  expect(state.queueClose).not.toHaveBeenCalled();
  releaseReconcile([]);await Promise.resolve();
  expect(state.disconnect).not.toHaveBeenCalled();
  releaseFailure({count:1});await closing;
  expect(state.workerClose).toHaveBeenCalledTimes(1);
  expect(state.queueClose).toHaveBeenCalledTimes(1);
  expect(state.quit).toHaveBeenCalledTimes(2);expect(state.disconnect).toHaveBeenCalledTimes(1);
 }finally{
  releaseWorker();releaseReconcile([]);releaseFailure({count:1});await closing;
  errorLog.mockRestore();vi.useRealTimers();
 }
});

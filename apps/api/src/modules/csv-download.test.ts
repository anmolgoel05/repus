import {describe,expect,it,vi} from 'vitest';
import {Writable} from 'node:stream';
import {setPrivateCsvDownloadHeaders,streamCsvDownload} from './csv-download';

describe('private CSV response headers',()=>{
 it('marks exports as private, non-cacheable downloads and sanitizes filenames',()=>{
  const headers=new Map<string,string>();
  const response={setHeader:vi.fn((name:string,value:string)=>headers.set(name,value))};
  setPrivateCsvDownloadHeaders(response,'contacts.csv\r\nX-Injected: yes');
  expect(headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  expect(headers.get('Content-Disposition')).toBe('attachment; filename="contacts.csv__X-Injected__yes"');
  expect(headers.get('Content-Disposition')).not.toMatch(/[\r\n]/);
  expect(headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(headers.get('Pragma')).toBe('no-cache');
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
 });
});

it('closes the row iterator when a download disconnects',async()=>{
 const closed=vi.fn();
 async function* rows(){
  try{for(let row=0;row<100;row++)yield 'email@example.test\n';}
  finally{closed();}
 }
 const response=new Writable({write(){this.destroy();}});
 await expect(streamCsvDownload(rows(),response)).resolves.toBeUndefined();
 expect(closed).toHaveBeenCalledOnce();
});

it('propagates a row source failure for API error reporting',async()=>{
 const failure=new Error('Row source failed');
 async function* rows(){yield 'email\n';throw failure;}
 const response=new Writable({write(_chunk,_encoding,done){done();}});
 await expect(streamCsvDownload(rows(),response)).rejects.toBe(failure);
});

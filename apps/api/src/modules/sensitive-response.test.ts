import {describe,expect,it,vi} from 'vitest';
import {setSensitiveResponseHeaders} from './sensitive-response';

describe('sensitive capability response headers',()=>{
 it('prevents caching, referrer leakage, and content sniffing',()=>{
  const headers=new Map<string,string>();
  setSensitiveResponseHeaders({setHeader:vi.fn((name:string,value:string)=>headers.set(name,value))});
  expect(headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
  expect(headers.get('Pragma')).toBe('no-cache');
  expect(headers.get('Expires')).toBe('0');
  expect(headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
 });
});

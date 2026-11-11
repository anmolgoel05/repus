import {describe,expect,it} from 'vitest';
import {Readable} from 'node:stream';
import {CsvInspectionError,inspectCsvPreview} from './csv-preview';
import {serializeCsvRow} from './csv-safety';
import {readCsvRecords} from './csv-records';

describe('streaming CSV inspection',()=>{
 it('handles a BOM, quoted commas, escaped quotes, and previews only five data rows',async()=>{
  const csv='\uFEFFemail,company,note\r\na@example.test,"North, Inc","say ""hello"""\r\nb@example.test,Other,ok\r\nc@example.test,Other,ok\r\nd@example.test,Other,ok\r\ne@example.test,Other,ok\r\nf@example.test,Other,not previewed\r\n';
  const result=await inspectCsvPreview(Readable.from([csv]));
  expect(result.headers).toEqual(['email','company','note']);expect(result.totalRows).toBe(6);expect(result.preview).toHaveLength(5);expect(result.preview[0].company).toBe('North, Inc');expect(result.preview[0].note).toBe('say "hello"');
 });
 it('rejects duplicate and blank header names',async()=>{
  await expect(inspectCsvPreview(Readable.from(['email,Email\na@b.test,a']))).rejects.toBeInstanceOf(CsvInspectionError);
  await expect(inspectCsvPreview(Readable.from(['email,\na@b.test,a']))).rejects.toBeInstanceOf(CsvInspectionError);
 });
 it('enforces the configured row limit while streaming',async()=>{
  await expect(inspectCsvPreview(Readable.from(['email\na@b.test\nc@d.test']),1)).rejects.toThrow('up to 1 data rows');
 });
 it('forwards a source read failure and closes the input',async()=>{
  const input=new Readable({read(){this.destroy(new Error('staging read failed'));}});
  await expect(inspectCsvPreview(input)).rejects.toThrow('staging read failed');
  expect(input.destroyed).toBe(true);
 });
 it('closes a source when validation stops inspection early',async()=>{
  let emitted=false;
  const input=new Readable({read(){if(!emitted){emitted=true;this.push('email,Email\na@example.test,a\n');}}});
  await expect(inspectCsvPreview(input)).rejects.toBeInstanceOf(CsvInspectionError);
  expect(input.destroyed).toBe(true);
 });
 it('closes an unfinished source when an import consumer cancels iteration',async()=>{
  let emitted=false;
  const input=new Readable({read(){if(!emitted){emitted=true;this.push('email\na@example.test\n');}}});
  for await(const _record of readCsvRecords(input))break;
  expect(input.destroyed).toBe(true);
 });
 it('quotes CSV fields and neutralizes spreadsheet formulas',()=>{
  expect(serializeCsvRow(['a,b','say "hi"','=1+1'])).toBe('"a,b","say ""hi""","\'=1+1"\r\n');
 });
 it('neutralizes formulas after leading spaces and controls while preserving negative numbers',()=>{
  expect(serializeCsvRow([' =1+1','\t+cmd','\n@SUM(A1:A2)','-1+2','-12.5'])).toBe('"\' =1+1","\'\t+cmd","\'\n@SUM(A1:A2)","\'-1+2","-12.5"\r\n');
 });
});

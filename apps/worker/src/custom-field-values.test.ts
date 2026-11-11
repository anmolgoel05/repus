import {describe,expect,it} from 'vitest';
import {parseCustomFieldValue} from './custom-field-values';

describe('CSV custom field parsing',()=>{
 it('validates each supported field type and preserves typed values',()=>{
  expect(parseCustomFieldValue('TEXT','Example','Company',false)).toEqual({valid:true,empty:false,value:'Example'});
  expect(parseCustomFieldValue('NUMBER','42.5','Seats',false)).toEqual({valid:true,empty:false,value:42.5});
  expect(parseCustomFieldValue('BOOLEAN','FALSE','Opted in',false)).toEqual({valid:true,empty:false,value:false});
  expect(parseCustomFieldValue('DATE','2026-10-30','Joined',false)).toEqual({valid:true,empty:false,value:'2026-10-30'});
 });
 it('rejects invalid types and missing required values with row-safe messages',()=>{
  expect(parseCustomFieldValue('NUMBER','many','Seats',false)).toMatchObject({valid:false});
  expect(parseCustomFieldValue('DATE','2026-02-30','Joined',false)).toMatchObject({valid:false});
  expect(parseCustomFieldValue('BOOLEAN','yes','Opted in',false)).toMatchObject({valid:false});
  expect(parseCustomFieldValue('TEXT','','Industry',true)).toEqual({valid:false,reason:'Industry is required.'});
 });
});

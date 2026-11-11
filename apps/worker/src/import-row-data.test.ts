import {describe,expect,it} from 'vitest';
import {safeImportRowData} from './import-row-data';

describe('safe import error row data',()=>{
 it('replaces null characters and caps each retained field at 500 characters',()=>{
  expect(safeImportRowData({permission:'bad\u0000date',notes:'x'.repeat(501)})).toEqual({permission:'bad�date',notes:'x'.repeat(500)});
 });
});

import {describe,expect,it} from 'vitest';
import {canStoreImage} from './image-storage-quota';

describe('workspace image storage quota',()=>{
 it('allows an upload that exactly fills the remaining space',()=>expect(canStoreImage(90,10,100)).toBe(true));
 it('rejects uploads above the limit or when storage is disabled',()=>{expect(canStoreImage(90,11,100)).toBe(false);expect(canStoreImage(0,1,0)).toBe(false);});
 it('rejects invalid and unsafe counters',()=>{expect(canStoreImage(-1,1,100)).toBe(false);expect(canStoreImage(0,0,100)).toBe(false);expect(canStoreImage(Number.MAX_SAFE_INTEGER,2,Number.MAX_SAFE_INTEGER)).toBe(false);});
});

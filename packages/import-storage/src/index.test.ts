import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deleteImportFile,deletePrivateImage,getImportReadStream,getPrivateImageStream,listPrivateImageObjects,putImportFile,putPrivateImage} from './index';
const tenant='123e4567-e89b-12d3-a456-426614174000';
const job='123e4567-e89b-12d3-a456-426614174001';
const key=`${tenant}/${job}.csv`;
const previous={dir:process.env.IMPORT_STAGING_DIR,bucket:process.env.AWS_S3_BUCKET,nodeEnv:process.env.NODE_ENV};
afterEach(()=>{for(const [key,value] of Object.entries({IMPORT_STAGING_DIR:previous.dir,AWS_S3_BUCKET:previous.bucket,NODE_ENV:previous.nodeEnv})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
describe('private import staging adapter',()=>{
 it('stores and reads CSV files from the local development adapter',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'repus-import-test-'));process.env.IMPORT_STAGING_DIR=dir;delete process.env.AWS_S3_BUCKET;process.env.NODE_ENV='test';
  const source=path.join(dir,'source.csv');await fs.writeFile(source,'email\na@example.test\n');
  await putImportFile(source,key);const stream=await getImportReadStream(key);let result='';for await(const chunk of stream)result+=chunk;
  expect(result).toContain('a@example.test');await deleteImportFile(key);await fs.rm(dir,{recursive:true,force:true});
 });
 it('rejects path traversal keys',async()=>{process.env.NODE_ENV='test';delete process.env.AWS_S3_BUCKET;await expect(getImportReadStream('../../secret.csv')).rejects.toThrow('Invalid private object key');});
 it('stores and reads private image objects in the local development adapter',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'repus-image-test-'));process.env.IMPORT_STAGING_DIR=dir;delete process.env.AWS_S3_BUCKET;process.env.NODE_ENV='test';
  const source=path.join(dir,'source.png');const bytes=Buffer.from([137,80,78,71,13,10,26,10]);await fs.writeFile(source,bytes);const imageKey=`${tenant}/${job}.png`;
  await putPrivateImage(source,imageKey,'image/png');const stream=await getPrivateImageStream(imageKey);const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks)).toEqual(bytes);
  await deletePrivateImage(imageKey);await fs.rm(dir,{recursive:true,force:true});
 });
 it('lists only private image keys with a stable continuation cursor',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'repus-image-list-test-'));process.env.IMPORT_STAGING_DIR=dir;delete process.env.AWS_S3_BUCKET;process.env.NODE_ENV='test';
  const source=path.join(dir,'source.png');await fs.writeFile(source,Buffer.from([137,80,78,71,13,10,26,10]));
  const keyA=`${tenant}/${job}.png`,tenantB='123e4567-e89b-12d3-a456-426614174002',keyB=`${tenantB}/123e4567-e89b-12d3-a456-426614174003.webp`;
  await putPrivateImage(source,keyA,'image/png');await putPrivateImage(source,keyB,'image/webp');await fs.writeFile(path.join(dir,tenant,'123e4567-e89b-12d3-a456-426614174004.csv'),'ignored');
  const first=await listPrivateImageObjects(undefined,1);expect(first.objects.map(item=>item.key)).toEqual([keyA]);expect(first.nextCursor).toBe(keyA);
  const second=await listPrivateImageObjects(first.nextCursor,1);expect(second.objects.map(item=>item.key)).toEqual([keyB]);expect(second.nextCursor).toBeUndefined();
  await fs.rm(dir,{recursive:true,force:true});
 });
 it('rejects unsupported image object keys and content types',async()=>{process.env.NODE_ENV='test';delete process.env.AWS_S3_BUCKET;const source=path.join(os.tmpdir(),'repus-image-invalid.png');await fs.writeFile(source,'x');await expect(putPrivateImage(source,`${tenant}/${job}.svg`,'image/svg+xml')).rejects.toThrow('Invalid private object key.');await expect(getPrivateImageStream(`${tenant}/${job}.svg`)).rejects.toThrow('Invalid private object key.');await fs.rm(source,{force:true});});
});

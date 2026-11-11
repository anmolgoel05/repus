import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { GetObjectCommand, S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });
const isObjectStorageEnabled = () => Boolean(process.env.AWS_S3_BUCKET);
export type PrivateImageObject={key:string;lastModified:Date};
function safeKey(key: string) {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(?:csv|png|jpe?g|webp)$/i.test(key)) throw new Error('Invalid private object key.');
  return key;
}
function localPath(key: string) {
  const root = path.resolve(process.env.IMPORT_STAGING_DIR ?? path.join(process.cwd(), '../../.repus-imports'));
  const target = path.resolve(root, ...safeKey(key).split('/'));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Import object path is outside the staging directory.');
  return target;
}

/** Use private S3 in production; the local adapter is for development with a shared API/worker directory. */
export async function putImportFile(sourcePath: string, key: string): Promise<void> {
  safeKey(key);
  if (!key.toLowerCase().endsWith('.csv')) throw new Error('Import files must use a CSV object key.');
  if (isObjectStorageEnabled()) {
    await new Upload({client:s3,params:{Bucket:process.env.AWS_S3_BUCKET!,Key:key,Body:createReadStream(sourcePath),ContentType:'text/csv',ServerSideEncryption:'AES256'}}).done();
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('AWS_S3_BUCKET must be configured for production CSV imports.');
  const destination=localPath(key);
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  await fs.copyFile(sourcePath,destination);
  await fs.chmod(destination,0o600);
}

/** Store a validated image in private tenant-scoped object storage. */
export async function putPrivateImage(sourcePath:string,key:string,contentType:string):Promise<void>{
 safeKey(key);if(!/\.(?:png|jpe?g|webp)$/i.test(key)||!['image/png','image/jpeg','image/webp'].includes(contentType))throw new Error('Unsupported private image object.');
 if(isObjectStorageEnabled()){await new Upload({client:s3,params:{Bucket:process.env.AWS_S3_BUCKET!,Key:key,Body:createReadStream(sourcePath),ContentType:contentType,ServerSideEncryption:'AES256'}}).done();return;}
 if(process.env.NODE_ENV==='production')throw new Error('AWS_S3_BUCKET must be configured for production image uploads.');
 const destination=localPath(key);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.copyFile(sourcePath,destination);await fs.chmod(destination,0o600);
}

export async function getPrivateImageStream(key:string):Promise<Readable>{
 safeKey(key);if(!/\.(?:png|jpe?g|webp)$/i.test(key))throw new Error('Invalid private image object key.');
 if(isObjectStorageEnabled()){const result=await s3.send(new GetObjectCommand({Bucket:process.env.AWS_S3_BUCKET!,Key:key}));if(!result.Body)throw new Error('Private image is missing from object storage.');const body=result.Body as any;if(body instanceof Readable)return body;if(typeof body.transformToWebStream==='function')return Readable.fromWeb(body.transformToWebStream());throw new Error('Unsupported object-storage response stream.');}
 if(process.env.NODE_ENV==='production')throw new Error('AWS_S3_BUCKET must be configured for production image uploads.');return createReadStream(localPath(key));
}

export async function deletePrivateImage(key:string):Promise<void>{
 safeKey(key);if(!/\.(?:png|jpe?g|webp)$/i.test(key))throw new Error('Invalid private image object key.');
 if(isObjectStorageEnabled()){await s3.send(new DeleteObjectCommand({Bucket:process.env.AWS_S3_BUCKET!,Key:key}));return;}
 if(process.env.NODE_ENV==='production')throw new Error('AWS_S3_BUCKET must be configured for production image uploads.');await fs.rm(localPath(key),{force:true});
}

/** List a bounded page of private image objects for the worker's stale-orphan sweep. */
export async function listPrivateImageObjects(cursor?:string,maxKeys=500):Promise<{objects:PrivateImageObject[];nextCursor?:string}>{
 const limit=Math.min(1000,Math.max(1,Math.floor(maxKeys)));
 if(isObjectStorageEnabled()){
  const page=await s3.send(new ListObjectsV2Command({Bucket:process.env.AWS_S3_BUCKET!,MaxKeys:limit,ContinuationToken:cursor}));
  const objects=(page.Contents??[]).flatMap(item=>{if(!item.Key||!item.LastModified||!/^([a-f0-9-]{36})\/([a-f0-9-]{36})\.(?:png|jpe?g|webp)$/i.test(item.Key))return[];try{safeKey(item.Key);return[{key:item.Key,lastModified:item.LastModified}];}catch{return[];}});
  return {objects,nextCursor:page.IsTruncated?page.NextContinuationToken:undefined};
 }
 if(process.env.NODE_ENV==='production')throw new Error('AWS_S3_BUCKET must be configured for production image cleanup.');
 const root=path.resolve(process.env.IMPORT_STAGING_DIR??path.join(process.cwd(),'../../.repus-imports'));
 const tenantEntries=await fs.readdir(root,{withFileTypes:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;});
 const objects:PrivateImageObject[]=[];
 for(const tenant of tenantEntries){if(!tenant.isDirectory()||!/^[a-f0-9-]{36}$/i.test(tenant.name))continue;const folder=path.join(root,tenant.name);const files=await fs.readdir(folder,{withFileTypes:true});for(const file of files){if(!file.isFile()||!/^([a-f0-9-]{36})\.(?:png|jpe?g|webp)$/i.test(file.name))continue;const key=`${tenant.name}/${file.name}`;const stat=await fs.stat(path.join(folder,file.name));objects.push({key,lastModified:stat.mtime});}}
 objects.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const after=cursor?objects.filter(item=>item.key>cursor):objects;
 const page=after.slice(0,limit);
 return {objects:page,nextCursor:after.length>limit?page.at(-1)?.key:undefined};
}

export async function getImportReadStream(key: string): Promise<Readable> {
  safeKey(key);
  if (isObjectStorageEnabled()) {
    const result=await s3.send(new GetObjectCommand({Bucket:process.env.AWS_S3_BUCKET!,Key:key}));
    if (!result.Body) throw new Error('Import file is missing from private object storage.');
    const body=result.Body as any;
    if (body instanceof Readable) return body;
    if (typeof body.transformToWebStream === 'function') return Readable.fromWeb(body.transformToWebStream());
    throw new Error('Unsupported object-storage response stream.');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('AWS_S3_BUCKET must be configured for production CSV imports.');
  return createReadStream(localPath(key));
}

export async function deleteImportFile(key: string): Promise<void> {
  safeKey(key);
  if (isObjectStorageEnabled()) {
    await s3.send(new DeleteObjectCommand({Bucket:process.env.AWS_S3_BUCKET!,Key:key}));
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('AWS_S3_BUCKET must be configured for production CSV imports.');
  await fs.rm(localPath(key),{force:true});
}
export * from './csv-preview';
export {readCsvRecords} from './csv-records';

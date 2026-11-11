import {Worker,Queue,Job} from 'bullmq';
import IORedis from 'ioredis';
import {createPrismaClient} from '@repus/database';
import {emailSchema} from '@repus/validation';
import {deleteImportFile,getImportReadStream,readCsvRecords} from '@repus/import-storage';
import {parseCustomFieldValue} from './custom-field-values';
import {safeImportRowData} from './import-row-data';
import {createOpaqueToken,encryptToken,tokenHash} from '@repus/token-security';

const prisma=createPrismaClient();
const workerConnection=new IORedis(process.env.REDIS_URL??'redis://localhost:6379',{maxRetriesPerRequest:null});
const queueConnection=new IORedis(process.env.REDIS_URL??'redis://localhost:6379',{maxRetriesPerRequest:null});
for(const connection of [workerConnection,queueConnection])connection.on('error',()=>console.error('CSV import Redis connection failed.'));
const importQueue=new Queue('repus-csv-import',{connection:queueConnection});
importQueue.on('error',()=>console.error('CSV import queue encountered an infrastructure error.'));
const batchSize=500;
type ImportRow={rowNumber:number;fields:Record<string,string>;shapeValid:boolean};
type Mapping=Record<string,string>;
function parseConsentDate(value:string):Date|null{if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value))return null;const day=value.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;const dateOnly=new Date(`${day}T00:00:00.000Z`);if(Number.isNaN(dateOnly.getTime())||dateOnly.toISOString().slice(0,10)!==day)return null;const date=new Date(value);return Number.isNaN(date.getTime())||date>new Date()?null:date;}
async function processBatch(importId:string,tenantId:string,attempt:number,batch:ImportRow[],mapping:Mapping,consentSource:string,defaultConsentAt:Date|null,destinationListId:string|null,customDefinitions:Array<{key:string;label:string;type:string;required:boolean}>){
 return prisma.$transaction(async tx=>{
  const locked=await tx.$queryRaw<Array<{status:string;attempt:number;processedRows:number}>>`SELECT status, attempt, processed_rows AS "processedRows" FROM import_jobs WHERE id=${importId}::uuid FOR UPDATE`;
  if(locked[0]?.status!=='PROCESSING'||locked[0].attempt!==attempt)return false;
  // A stalled job can resume after another worker has committed part of its batch.
  const rows=batch.filter(row=>row.rowNumber-1>locked[0].processedRows);
  if(!rows.length)return true;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
  const errors:Array<{tenantId:string;importJobId:string;rowNumber:number;email:string|null;reason:string;rowData:any}>=[];
  let duplicateRows=0,suppressedRows=0,rejectedRows=0;
  const candidates:Array<{row:ImportRow;email:string;firstName:string|null;lastName:string|null;consentAt:Date;customFields:Record<string,string|number|boolean>}>=[];
  for(const row of rows){
   const originalEmail=String(row.fields[mapping.email]??'').trim();const email=originalEmail.toLowerCase();
// eslint-disable-next-line no-control-regex -- Remove unsafe control characters from email and CSV content.
   const rowData=safeImportRowData(row.fields);const emailForError=email.replace(/\u0000/g,'�').slice(0,254)||null;
   if(!row.shapeValid){rejectedRows++;errors.push({tenantId,importJobId:importId,rowNumber:row.rowNumber,email:emailForError,reason:'This row has a different number of columns than the CSV header.',rowData});continue;}
   if(Object.values(row.fields).some(value=>value.includes('\u0000'))){rejectedRows++;errors.push({tenantId,importJobId:importId,rowNumber:row.rowNumber,email:emailForError,reason:'This row contains an unsupported null character.',rowData});continue;}
   if(!emailSchema.safeParse(email).success){rejectedRows++;errors.push({tenantId,importJobId:importId,rowNumber:row.rowNumber,email:emailForError,reason:'Email address is missing or invalid.',rowData});continue;}
   const consentAt=mapping.consentAt?parseConsentDate(String(row.fields[mapping.consentAt]??'')):defaultConsentAt;
   if(!consentAt){rejectedRows++;errors.push({tenantId,importJobId:importId,rowNumber:row.rowNumber,email,reason:'Permission date is missing, invalid, or in the future.',rowData});continue;}
   const firstName=mapping.firstName?String(row.fields[mapping.firstName]??'').trim():'';
   const lastName=mapping.lastName?String(row.fields[mapping.lastName]??'').trim():'';
   const company=mapping.company?String(row.fields[mapping.company]??'').trim():'';
   if(firstName.length>120||lastName.length>120||company.length>4000){rejectedRows++;errors.push({tenantId,importJobId:importId,rowNumber:row.rowNumber,email,reason:'A mapped name or company value exceeds its allowed length.',rowData});continue;}
   const customFields:Record<string,string|number|boolean>=company?{company}:{};let fieldError='';
   for(const definition of customDefinitions){const column=mapping[definition.key];const parsed=parseCustomFieldValue(definition.type,column?String(row.fields[column]??''):'',definition.label,definition.required);if(!parsed.valid){fieldError=parsed.reason;break;}if(!parsed.empty)customFields[definition.key]=parsed.value!;}
   if(fieldError){rejectedRows++;errors.push({tenantId,importJobId:importId,rowNumber:row.rowNumber,email,reason:fieldError,rowData});continue;}
   candidates.push({row,email,firstName:firstName||null,lastName:lastName||null,consentAt,customFields});
  }
  const emails=candidates.map(item=>item.email);
  const existing=emails.length?await tx.contact.findMany({where:{tenantId,deletedAt:null,normalizedEmail:{in:emails}},select:{id:true,normalizedEmail:true}}):[];
  const suppressed=emails.length?await tx.suppression.findMany({where:{tenantId,normalizedEmail:{in:emails}},select:{normalizedEmail:true}}):[];
  const existingMap=new Map(existing.map(item=>[item.normalizedEmail,item.id]));const suppressedSet=new Set(suppressed.map(item=>item.normalizedEmail));
  const insert:Array<(typeof candidates)[number]>=[];const listContactIds:string[]=[];
  const seen=new Set<string>();
  for(const candidate of candidates){
   if(suppressedSet.has(candidate.email)){
    suppressedRows++;errors.push({tenantId,importJobId:importId,rowNumber:candidate.row.rowNumber,email:candidate.email,reason:'This address is suppressed and cannot be re-subscribed by import.',rowData:safeImportRowData(candidate.row.fields)});continue;
   }
   if(seen.has(candidate.email)){duplicateRows++;continue;}
   seen.add(candidate.email);
   const existingId=existingMap.get(candidate.email);
   if(existingId){duplicateRows++;listContactIds.push(existingId);continue;}
   insert.push(candidate);
  }
  const limits=await tx.tenantSendingLimit.findUnique({where:{tenantId},select:{contactLimit:true}});
  const tenantSettings=await tx.tenant.findUnique({where:{id:tenantId},select:{doubleOptInEnabled:true}});
  if(limits){const current=await tx.contact.count({where:{tenantId,deletedAt:null}});const available=Math.max(0,limits.contactLimit-current);if(insert.length>available){for(const rejected of insert.splice(available)){rejectedRows++;errors.push({tenantId,importJobId:importId,rowNumber:rejected.row.rowNumber,email:rejected.email,reason:'The workspace contact limit has been reached.',rowData:safeImportRowData(rejected.row.fields)});}}}
  let importedRows=0;
  if(insert.length){
   const inserted=await tx.contact.createManyAndReturn({data:insert.map(item=>({tenantId,email:item.email,normalizedEmail:item.email,firstName:item.firstName,lastName:item.lastName,status:tenantSettings?.doubleOptInEnabled?'PENDING_CONFIRMATION':'SUBSCRIBED',consentSource,consentAt:item.consentAt,customFields:item.customFields})),skipDuplicates:true,select:{id:true,normalizedEmail:true}});
   importedRows=inserted.length;
   const insertedMap=new Map(inserted.map(item=>[item.normalizedEmail,item.id]));
   for(const item of insert){const contactId=insertedMap.get(item.email);if(contactId)listContactIds.push(contactId);}
   duplicateRows+=Math.max(0,insert.length-inserted.length);
   if(tenantSettings?.doubleOptInEnabled&&inserted.length){
    const tokenRows=[];
    for(const item of insert){const contactId=insertedMap.get(item.email);if(!contactId)continue;const rawToken=createOpaqueToken();tokenRows.push({tenantId,contactId,tokenHash:tokenHash(rawToken),tokenEncrypted:encryptToken(rawToken,process.env.SESSION_SECRET??''),expiresAt:new Date(Date.now()+48*60*60*1000)});}
    if(tokenRows.length)await tx.contactConfirmationToken.createMany({data:tokenRows});
   }
  }
  if(destinationListId&&listContactIds.length){
   const list=await tx.contactList.findFirst({where:{tenantId,id:destinationListId},select:{id:true}});
   if(!list)throw new Error('The destination list no longer exists.');
   await tx.listContact.createMany({data:[...new Set(listContactIds)].map(contactId=>({tenantId,listId:destinationListId,contactId})),skipDuplicates:true});
  }
  if(errors.length)await tx.importError.createMany({data:errors as any,skipDuplicates:true});
  await tx.importJob.update({where:{id:importId},data:{processedRows:{increment:rows.length},importedRows:{increment:importedRows},duplicateRows:{increment:duplicateRows},suppressedRows:{increment:suppressedRows},rejectedRows:{increment:rejectedRows}}});
  return true;
 },{timeout:30000});
}

async function processImport(job:Job<{importId:string}>){
 let jobRecord=await prisma.importJob.findUnique({where:{id:job.data.importId}});
 if(!jobRecord)return;
 if(job.id!==`import-${jobRecord.id}-${jobRecord.attempt}`)return;
 if(jobRecord.status!=='PROCESSING'){if(jobRecord.status==='CANCELLED')await deleteImportFile(jobRecord.fileKey).catch(()=>{});return;}
 const {id,attempt,fileKey}=jobRecord;
 async function cleanupIfCancelled(){
  const current=await prisma.importJob.findUnique({where:{id},select:{status:true}});
  if(current?.status==='CANCELLED')await deleteImportFile(fileKey).catch(()=>{});
 }
 if(!jobRecord.consentSource||!jobRecord.fieldMapping)throw new Error('Import is missing confirmed permission or column mapping.');
 const consentSource=jobRecord.consentSource;const mapping=jobRecord.fieldMapping as unknown as Mapping;const headers=jobRecord.csvHeaders as unknown as string[];
 if(!headers?.length||!mapping.email||!headers.includes(mapping.email)||mapping.consentAt&&!headers.includes(mapping.consentAt)||(!mapping.consentAt&&!jobRecord.consentAt))throw new Error('Import has an invalid email or permission-date mapping.');
 const mappedCustomKeys=Object.keys(mapping).filter(key=>!['email','firstName','lastName','company','consentAt'].includes(key));
 const customDefinitions=await prisma.customFieldDefinition.findMany({where:{tenantId:jobRecord.tenantId,key:{in:mappedCustomKeys}}});
 const input=await getImportReadStream(jobRecord.fileKey);
 let index=0;let batch:ImportRow[]=[];let headerSeen=false;
 for await(const raw of readCsvRecords(input)){
  const columns=(raw as unknown[]).map(value=>String(value??''));
  if(!headerSeen){headerSeen=true;if(columns.length!==headers.length||columns.some((value,i)=>value!==headers[i]))throw new Error('The staged CSV header changed after preview.');continue;}
  index++;
  if(index<=jobRecord.processedRows)continue;
  const fields=Object.create(null) as Record<string,string>;headers.forEach((header,i)=>fields[header]=columns[i]??'');
  batch.push({rowNumber:index+1,fields,shapeValid:columns.length===headers.length});
  if(batch.length>=batchSize){
   const shouldContinue=await processBatch(id,jobRecord.tenantId,attempt,batch,mapping,consentSource,jobRecord.consentAt,jobRecord.destinationListId,customDefinitions);
   batch=[];
   if(!shouldContinue){await cleanupIfCancelled();return;}
   jobRecord=await prisma.importJob.findUnique({where:{id}});
   if(!jobRecord||jobRecord.status!=='PROCESSING'||jobRecord.attempt!==attempt){await cleanupIfCancelled();return;}
  }
 }
 if(batch.length){const shouldContinue=await processBatch(id,jobRecord.tenantId,attempt,batch,mapping,consentSource,jobRecord.consentAt,jobRecord.destinationListId,customDefinitions);if(!shouldContinue){await cleanupIfCancelled();return;}}
 if(index!==jobRecord.totalRows)throw new Error('The staged CSV row count differs from the upload preview.');
 const completed=await prisma.importJob.updateMany({where:{id,attempt,status:'PROCESSING'},data:{status:'COMPLETED',completedAt:new Date()}});
 if(completed.count)await deleteImportFile(jobRecord.fileKey).catch(()=>console.error('Completed import staging object cleanup failed.'));
 else await cleanupIfCancelled();
}

export const importWorker=new Worker<{importId:string}>('repus-csv-import',async job=>{
 try{await processImport(job);}
 catch{
  // BullMQ persists this error. Row details belong in the tenant-scoped rejection report.
  throw new Error('CSV import processing failed.');
 }
},{connection:workerConnection,concurrency:2});
importWorker.on('error',()=>console.error('CSV import worker encountered an infrastructure error.'));
const pendingFailureWrites=new Set<Promise<unknown>>();
importWorker.on('failed',job=>{
 if(job&&job.attemptsMade>=Number(job.opts.attempts??1)){
  const prefix=`import-${job.data.importId}-`;
  const attemptText=job.id?.startsWith(prefix)?job.id.slice(prefix.length):'';
  const attempt=Number(attemptText);
  if(Number.isSafeInteger(attempt)&&attempt>=0&&String(attempt)===attemptText){
   const write=prisma.importJob.updateMany({where:{id:job.data.importId,attempt,status:'PROCESSING'},data:{status:'FAILED',completedAt:new Date()}}).catch(()=>console.error('Could not mark the import failed.'));
   pendingFailureWrites.add(write);void write.finally(()=>pendingFailureWrites.delete(write));
  }
 }
 console.error('CSV import attempt failed.');
});
let closing=false;
let reconciliation:Promise<void>|undefined;
let stagingCleanupCursor:string|undefined;
function reconcileImports():Promise<void>{
 if(closing)return Promise.resolve();
 if(reconciliation)return reconciliation;
 reconciliation=(async()=>{try{
 const cleanupCandidates=await prisma.importJob.findMany({
  where:{status:{in:['COMPLETED','CANCELLED']},stagingDeletedAt:null,id:{gt:stagingCleanupCursor}},
  select:{id:true,fileKey:true},orderBy:{id:'asc'},take:50,
 });
 for(const item of cleanupCandidates){
  try{
   await deleteImportFile(item.fileKey);
   await prisma.importJob.updateMany({where:{id:item.id,stagingDeletedAt:null},data:{stagingDeletedAt:new Date()}});
  }catch{
   console.error('Import staging cleanup will retry.');
  }
 }
 // Move past failing objects so later imports receive cleanup before the next pass.
 stagingCleanupCursor=cleanupCandidates.length===50?cleanupCandidates.at(-1)?.id:undefined;
 const pending=await prisma.importJob.findMany({where:{status:'PROCESSING'},select:{id:true,attempt:true},take:100});
 for(const item of pending){const jobId=`import-${item.id}-${item.attempt}`;const queued=await importQueue.getJob(jobId);if(queued&&(await queued.getState())==='failed'){await prisma.importJob.updateMany({where:{id:item.id,attempt:item.attempt,status:'PROCESSING'},data:{status:'FAILED',completedAt:new Date()}});continue;}if(!queued)await importQueue.add('process',{importId:item.id},{jobId,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:1000,removeOnFail:false});}
 const expired=await prisma.importJob.findMany({where:{status:'UPLOADED',createdAt:{lt:new Date(Date.now()-24*60*60*1000)}},select:{id:true,fileKey:true},take:50});
 for(const item of expired){const claimed=await prisma.importJob.updateMany({where:{id:item.id,status:'UPLOADED'},data:{status:'CANCELLED',completedAt:new Date()}});if(claimed.count)await deleteImportFile(item.fileKey).catch(()=>console.error('Expired import staging cleanup failed.'));}
 }catch{console.error('CSV import reconciliation failed.');}})().finally(()=>{reconciliation=undefined;});
 return reconciliation;
}
const reconcileTimer=setInterval(()=>void reconcileImports(),15000);void reconcileImports();
let shutdownPromise:Promise<void>|undefined;
export function closeImportWorker():Promise<void>{
 if(shutdownPromise)return shutdownPromise;
 closing=true;clearInterval(reconcileTimer);
 shutdownPromise=(async()=>{
  await importWorker.close();
  await reconciliation;
  await Promise.all([...pendingFailureWrites]);
  await importQueue.close();
  await Promise.all([workerConnection.quit(),queueConnection.quit(),prisma.$disconnect()]);
 })();
 return shutdownPromise;
}

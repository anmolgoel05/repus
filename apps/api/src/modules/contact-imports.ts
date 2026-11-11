import {BadRequestException,Body,Controller,ForbiddenException,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Post,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {ApiBody,ApiConsumes,ApiTags} from '@nestjs/swagger';
import {Throttle} from '@nestjs/throttler';
import {diskStorage} from 'multer';
import {IsBoolean,IsDateString,IsObject,IsOptional,IsString,IsUUID,MaxLength} from 'class-validator';
import {Request,Response} from 'express';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {extname} from 'node:path';
import {createReadStream,promises as fs} from 'node:fs';
import {Queue} from 'bullmq';
import IORedis from 'ioredis';
import {afterTenantCommit,prisma} from '@repus/database';
import {CsvInspectionError,deleteImportFile,inspectCsvPreview,putImportFile,serializeCsvRow} from '@repus/import-storage';
import {AuthService} from './auth';
import {setPrivateCsvDownloadHeaders,streamCsvDownload} from './csv-download';

const MAX_UPLOAD_BYTES=25*1024*1024;
const MAX_ROWS=100_000;
const importConnection=new IORedis(process.env.REDIS_URL??'redis://localhost:6379',{maxRetriesPerRequest:1,commandTimeout:3000,autoResendUnfulfilledCommands:false});
const importQueue=new Queue('repus-csv-import',{connection:importConnection});
function publishImportAfterCommit(importId:string,attempt:number){
 afterTenantCommit(async()=>{
  if(importConnection.status!=='ready')return;
  await importQueue.add('process',{importId},{jobId:`import-${importId}-${attempt}`,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:1000,removeOnFail:false});
 });
}
const uploadInterceptor=FileInterceptor('file',{
 storage:diskStorage({destination:tmpdir(),filename:(_req,_file,callback)=>callback(null,`${randomUUID()}.csv`)}),
 limits:{fileSize:MAX_UPLOAD_BYTES,files:1},
 fileFilter:(_req,file,callback)=>callback(extname(file.originalname).toLowerCase()==='.csv'?null:new BadRequestException('Upload a CSV file.'),extname(file.originalname).toLowerCase()==='.csv')
});

class StartImportDto {
 @IsObject() fieldMapping!:Record<string,string>;
 @IsOptional() @IsUUID() destinationListId?:string;
 @IsBoolean() consentConfirmed!:boolean;
 @IsString() @MaxLength(240) consentSource!:string;
 @IsOptional() @IsDateString() consentAt?:string;
}

@Injectable()
export class ContactImportsService {
 constructor(private auth:AuthService){}
 private async actor(req:Request){return this.auth.authenticate(req.cookies?.repus_session as string|undefined);}
 private canWrite(role:string){if(role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');}
 private async ownedJob(tenantId:string,id:string){const job=await prisma.importJob.findFirst({where:{id,tenantId}});if(!job)throw new NotFoundException('Import not found.');return job;}
 async upload(req:Request,file:Express.Multer.File){
  if(!file?.path)throw new BadRequestException('Choose a CSV file to upload.');
  try{
   const user=await this.actor(req);this.canWrite(user.role);
   const input=createReadStream(file.path);
   let inspected:Awaited<ReturnType<typeof inspectCsvPreview>>;try{inspected=await inspectCsvPreview(input,MAX_ROWS);}catch(error){if(error instanceof CsvInspectionError||error instanceof Error)throw new BadRequestException(error.message);throw error;}
   const {headers,totalRows,preview}=inspected;
   const id=randomUUID();const fileKey=`${user.tenantId}/${id}.csv`;
   await putImportFile(file.path,fileKey);
   try{
    const job=await prisma.importJob.create({data:{id,tenantId:user.tenantId,fileKey,totalRows,csvHeaders:headers}});
    await prisma.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'contacts.import.uploaded',entityType:'import',entityId:id,metadata:{totalRows,bytes:file.size}}});
    return {id:job.id,status:job.status,totalRows,headers,preview};
   }catch(error){await deleteImportFile(fileKey).catch(()=>{});throw error;}
  }finally{await fs.rm(file.path,{force:true}).catch(()=>{});}
 }
 async start(req:Request,id:string,dto:StartImportDto){
  const user=await this.actor(req);this.canWrite(user.role);const job=await this.ownedJob(user.tenantId,id);
  if(job.status!=='UPLOADED')throw new BadRequestException('This import has already been started.');
  if(!dto.consentConfirmed||!dto.consentSource.trim()||dto.consentSource.includes('\u0000'))throw new BadRequestException('Confirm that these subscribers gave permission and record where that permission was collected.');
  const customDefinitions=await prisma.customFieldDefinition.findMany({where:{tenantId:user.tenantId,archived:false}});
  const customKeys=new Set(customDefinitions.map(field=>field.key));
  const supported=new Set(['email','firstName','lastName','company','consentAt',...customKeys]);
  const fieldMapping=Object.fromEntries(Object.entries(dto.fieldMapping??{}).filter(([,column])=>column!==''));
  for(const [field,column] of Object.entries(fieldMapping))if(!supported.has(field)||typeof column!=='string')throw new BadRequestException('Choose valid CSV columns for the supported contact fields.');
  if(!fieldMapping.email)throw new BadRequestException('Map a CSV column to Email to continue.');
  for(const field of customDefinitions)if(field.required&&!fieldMapping[field.key])throw new BadRequestException(`Map a CSV column to ${field.label}; this field is required.`);
  const mappingValues=Object.values(fieldMapping);const headers=Array.isArray(job.csvHeaders)?job.csvHeaders as string[]:[];
  if(mappingValues.some(column=>typeof column!=='string'||!column.trim())||mappingValues.some(column=>!headers.includes(column)))throw new BadRequestException('A mapped column is not present in this CSV file.');
  const defaultConsentAt=dto.consentAt?new Date(dto.consentAt):null;
  if(defaultConsentAt){const day=dto.consentAt!.slice(0,10);const normalizedDay=new Date(`${day}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(defaultConsentAt.getTime())||Number.isNaN(normalizedDay.getTime())||normalizedDay.toISOString().slice(0,10)!==day)throw new BadRequestException('Enter a valid permission collection date.');}
  if(defaultConsentAt&&defaultConsentAt>new Date())throw new BadRequestException('Permission date cannot be in the future.');
  if(!fieldMapping.consentAt&&!defaultConsentAt)throw new BadRequestException('Map a permission date column or enter the date permission was collected.');
  if(dto.destinationListId&&!await prisma.contactList.findFirst({where:{id:dto.destinationListId,tenantId:user.tenantId}}))throw new NotFoundException('Destination list not found.');
  if(job.totalRows<1)throw new BadRequestException('This CSV does not contain any data rows.');
  const claimed=await prisma.importJob.updateMany({where:{id,tenantId:user.tenantId,status:'UPLOADED'},data:{status:'PROCESSING',attempt:{increment:1},fieldMapping:fieldMapping as any,destinationListId:dto.destinationListId,consentSource:dto.consentSource.trim(),consentAt:defaultConsentAt}});
  if(claimed.count!==1)throw new BadRequestException('This import has already been started or cancelled.');
  const started=await prisma.importJob.findFirstOrThrow({where:{id,tenantId:user.tenantId}});
  await prisma.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'contacts.import.started',entityType:'import',entityId:id,metadata:{totalRows:job.totalRows,destinationListId:dto.destinationListId??null,fieldMapping:Object.keys(fieldMapping),consentSource:dto.consentSource.trim(),usesPerRowConsentDate:Boolean(fieldMapping.consentAt)}}});
  publishImportAfterCommit(id,started.attempt);
  return {id,status:'PROCESSING',totalRows:job.totalRows};
 }
 async status(req:Request,id:string){const user=await this.actor(req);const job=await this.ownedJob(user.tenantId,id);return {id:job.id,status:job.status,totalRows:job.totalRows,processedRows:job.processedRows,importedRows:job.importedRows,duplicateRows:job.duplicateRows,rejectedRows:job.rejectedRows,suppressedRows:job.suppressedRows,headers:job.csvHeaders,fieldMapping:job.fieldMapping,destinationListId:job.destinationListId,createdAt:job.createdAt,completedAt:job.completedAt};}
 async list(req:Request){const user=await this.actor(req);return prisma.importJob.findMany({where:{tenantId:user.tenantId},orderBy:{createdAt:'desc'},take:50,select:{id:true,status:true,totalRows:true,processedRows:true,importedRows:true,duplicateRows:true,rejectedRows:true,suppressedRows:true,createdAt:true,completedAt:true}});}
 async cancel(req:Request,id:string){const user=await this.actor(req);this.canWrite(user.role);const job=await this.ownedJob(user.tenantId,id);if(!['UPLOADED','PROCESSING'].includes(job.status))throw new BadRequestException('This import can no longer be cancelled.');const result=await prisma.importJob.updateMany({where:{id,tenantId:user.tenantId,status:{in:['UPLOADED','PROCESSING']}},data:{status:'CANCELLED',completedAt:new Date()}});if(result.count!==1)throw new BadRequestException('This import has already finished.');await prisma.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'contacts.import.cancelled',entityType:'import',entityId:id,metadata:{processedRows:job.processedRows}}});if(job.status==='UPLOADED')afterTenantCommit(()=>deleteImportFile(job.fileKey));return {id,status:'CANCELLED'};}
 async retry(req:Request,id:string){const user=await this.actor(req);this.canWrite(user.role);const job=await this.ownedJob(user.tenantId,id);if(job.status!=='FAILED')throw new BadRequestException('Only failed imports can be retried.');const claimed=await prisma.importJob.updateMany({where:{id,tenantId:user.tenantId,status:'FAILED'},data:{status:'PROCESSING',attempt:{increment:1},completedAt:null}});if(claimed.count!==1)throw new BadRequestException('This import is no longer available to retry.');const retry=await prisma.importJob.findFirstOrThrow({where:{id,tenantId:user.tenantId}});await prisma.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'contacts.import.retried',entityType:'import',entityId:id,metadata:{attempt:retry.attempt,processedRows:job.processedRows}}});publishImportAfterCommit(id,retry.attempt);return {id,status:'PROCESSING',processedRows:job.processedRows};}
 async errors(req:Request,id:string,response:Response){const user=await this.actor(req);await this.ownedJob(user.tenantId,id);setPrivateCsvDownloadHeaders(response,'repus-import-errors.csv');
  async function* rows(){
   yield serializeCsvRow(['row_number','email','reason','row_data']);
   const pageSize=500;
   let lastRowNumber:number|undefined;
   while(true){
    const page=await prisma.importError.findMany({
     where:{tenantId:user.tenantId,importJobId:id,...(lastRowNumber===undefined?{}:{rowNumber:{gt:lastRowNumber}})},
     orderBy:{rowNumber:'asc'},take:pageSize,
    });
    for(const row of page)yield serializeCsvRow([String(row.rowNumber),row.email??'',row.reason,JSON.stringify(row.rowData)]);
    if(page.length<pageSize)return;
    lastRowNumber=page[page.length-1].rowNumber;
   }
  }
  await streamCsvDownload(rows(),response);
 }
}

@Controller('contacts/import')
@ApiTags('contact imports')
export class ContactImportsController {
 constructor(private imports:ContactImportsService){}
 @Post() @Throttle({default:{limit:5,ttl:60*60*1000}}) @ApiConsumes('multipart/form-data') @ApiBody({schema:{type:'object',properties:{file:{type:'string',format:'binary'}},required:['file']}}) @UseInterceptors(uploadInterceptor) async upload(@Req()req:Request,@UploadedFile()file:Express.Multer.File){return {data:await this.imports.upload(req,file)};}
 @Get() async list(@Req()req:Request){return {data:await this.imports.list(req)};}
 @Get(':id/errors') async errors(@Req()req:Request,@Param('id',new ParseUUIDPipe())id:string,@Res()response:Response){return this.imports.errors(req,id,response);}
 @Get(':id') async status(@Req()req:Request,@Param('id',new ParseUUIDPipe())id:string){return {data:await this.imports.status(req,id)};}
 @Post(':id/start') async start(@Req()req:Request,@Param('id',new ParseUUIDPipe())id:string,@Body()dto:StartImportDto){return {data:await this.imports.start(req,id,dto)};}
 @Post(':id/retry') async retry(@Req()req:Request,@Param('id',new ParseUUIDPipe())id:string){return {data:await this.imports.retry(req,id)};}
 @Post(':id/cancel') async cancel(@Req()req:Request,@Param('id',new ParseUUIDPipe())id:string){return {data:await this.imports.cancel(req,id)};}
}

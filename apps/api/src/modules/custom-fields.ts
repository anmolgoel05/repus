import {Body,Controller,Get,Injectable,BadRequestException,ForbiddenException,NotFoundException,Param,Patch,Post,Req,ParseUUIDPipe} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {IsBoolean,IsIn,IsOptional,IsString,Matches,MaxLength,MinLength} from 'class-validator';
import {Request} from 'express';
import {prisma} from '@repus/database';
import {AuthService} from './auth';

const RESERVED=new Set(['email','first_name','last_name','name','status','consent_source','consent_at','tags','company']);
class CreateCustomFieldDto{
 @IsString() @Matches(/^[a-z][a-z0-9_]{0,39}$/) key!:string;
 @IsString() @MinLength(1) @MaxLength(80) label!:string;
 @IsOptional() @IsIn(['TEXT','NUMBER','DATE','BOOLEAN']) type?:string;
 @IsOptional() @IsBoolean() required?:boolean;
}
class UpdateCustomFieldDto{
 @IsOptional() @IsString() @MinLength(1) @MaxLength(80) label?:string;
 @IsOptional() @IsBoolean() required?:boolean;
}
class ArchiveCustomFieldDto{@IsBoolean() archived!:boolean;}

@Injectable()
export class CustomFieldsService{
 constructor(private auth:AuthService){}
 private async actor(req:Request){const user=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(user.role))throw new ForbiddenException('Only workspace owners and admins can manage custom fields.');return user;}
 async list(req:Request){const user=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);return prisma.customFieldDefinition.findMany({where:{tenantId:user.tenantId},orderBy:[{createdAt:'asc'},{key:'asc'}]});}
 async create(req:Request,dto:CreateCustomFieldDto){const user=await this.actor(req);const key=dto.key.toLowerCase();if(!dto.label.trim())throw new BadRequestException('Enter a field label.');if(RESERVED.has(key))throw new ForbiddenException('That field key is reserved by Repus.');return prisma.$transaction(async tx=>{const field=await tx.customFieldDefinition.create({data:{tenantId:user.tenantId,key,label:dto.label.trim(),type:(dto.type??'TEXT') as any,required:dto.required??false}});await tx.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'custom_field.created',entityType:'custom_field_definition',entityId:field.id,metadata:{key,label:field.label,type:field.type}}});return field;});}
 async update(req:Request,id:string,dto:UpdateCustomFieldDto){const user=await this.actor(req);if(dto.label!==undefined&&!dto.label.trim())throw new BadRequestException('Enter a field label.');const existing=await prisma.customFieldDefinition.findFirst({where:{id,tenantId:user.tenantId}});if(!existing)throw new NotFoundException('Custom field not found.');return prisma.$transaction(async tx=>{const field=await tx.customFieldDefinition.update({where:{id:existing.id},data:{...(dto.label===undefined?{}:{label:dto.label.trim()}),...(dto.required===undefined?{}:{required:dto.required})}});await tx.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'custom_field.updated',entityType:'custom_field_definition',entityId:field.id,metadata:{fields:Object.keys(dto)}}});return field;});}
 async archive(req:Request,id:string,dto:ArchiveCustomFieldDto){const user=await this.actor(req);const existing=await prisma.customFieldDefinition.findFirst({where:{id,tenantId:user.tenantId}});if(!existing)throw new NotFoundException('Custom field not found.');return prisma.$transaction(async tx=>{const field=await tx.customFieldDefinition.update({where:{id:existing.id},data:{archived:dto.archived}});await tx.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:dto.archived?'custom_field.archived':'custom_field.restored',entityType:'custom_field_definition',entityId:field.id,metadata:{key:field.key,valuesRetained:true}}});return field;});}
}

@ApiTags('custom fields')
@Controller('custom-fields')
export class CustomFieldsController{
 constructor(private service:CustomFieldsService){}
 @Get() async list(@Req()req:Request){return {data:await this.service.list(req)}}
 @Post() async create(@Req()req:Request,@Body()dto:CreateCustomFieldDto){return {data:await this.service.create(req,dto)}}
 @Patch(':id') async update(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string,@Body()dto:UpdateCustomFieldDto){return {data:await this.service.update(req,id,dto)}}
 @Patch(':id/archive') async archive(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string,@Body()dto:ArchiveCustomFieldDto){return {data:await this.service.archive(req,id,dto)}}
}

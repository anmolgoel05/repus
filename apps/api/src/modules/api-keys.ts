import {Body,Controller,Delete,ForbiddenException,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Post,Req,BadRequestException} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {IsDateString,IsIn,IsOptional,IsString,MaxLength,MinLength} from 'class-validator';
import {Request} from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {prisma} from '@repus/database';
import {AuthService} from './auth';

class CreateApiKeyDto{
 @IsString() @MinLength(2) @MaxLength(120) name!:string;
 @IsIn(['MARKETER','VIEWER']) role!:string;
 @IsOptional() @IsDateString() expiresAt?:string;
}
const hashKey=(value:string)=>createHash('sha256').update(value).digest('hex');

@Injectable()
export class ApiKeysService{
 constructor(private auth:AuthService){}
 private async manager(req:Request){const actor=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(actor.role))throw new ForbiddenException('Only workspace owners and admins can manage API keys.');return actor;}
 async list(req:Request){const actor=await this.manager(req);return prisma.apiKey.findMany({where:{tenantId:actor.tenantId},select:{id:true,name:true,role:true,lastUsedAt:true,expiresAt:true,revokedAt:true,createdAt:true},orderBy:{createdAt:'desc'}});}
 async create(req:Request,dto:CreateApiKeyDto){const actor=await this.manager(req);const name=dto.name.trim();if(name.length<2)throw new BadRequestException('Enter an API key name.');let expiresAt:Date|null=null;if(dto.expiresAt){expiresAt=new Date(dto.expiresAt);if(Number.isNaN(expiresAt.getTime())||expiresAt<=new Date())throw new BadRequestException('API key expiration must be in the future.');}const raw=`rps_live_${randomBytes(32).toString('base64url')}`;const key=await prisma.$transaction(async tx=>{const created=await tx.apiKey.create({data:{tenantId:actor.tenantId,createdByUserId:actor.id,name,keyHash:hashKey(raw),role:dto.role as any,expiresAt}});await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'api_key.created',entityType:'api_key',entityId:created.id,metadata:{name,role:dto.role,expiresAt}}});return created;});return {id:key.id,name:key.name,role:key.role,expiresAt:key.expiresAt,createdAt:key.createdAt,key:raw};}
 async revoke(req:Request,id:string){const actor=await this.manager(req);const key=await prisma.apiKey.findFirst({where:{id,tenantId:actor.tenantId}});if(!key)throw new NotFoundException('API key not found.');if(key.revokedAt)return {success:true,revoked:true};await prisma.$transaction(async tx=>{const changed=await tx.apiKey.updateMany({where:{id:key.id,tenantId:actor.tenantId,revokedAt:null},data:{revokedAt:new Date()}});if(changed.count)await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'api_key.revoked',entityType:'api_key',entityId:key.id,metadata:{name:key.name,role:key.role}}});});return {success:true,revoked:true};}
}

@ApiTags('API keys')
@Controller('api-keys')
export class ApiKeysController{
 constructor(private service:ApiKeysService){}
 @Get() async list(@Req()req:Request){return {data:await this.service.list(req)}}
 @Post() async create(@Req()req:Request,@Body()dto:CreateApiKeyDto){return {data:await this.service.create(req,dto)}}
 @Delete(':id') async revoke(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.revoke(req,id)}}
}

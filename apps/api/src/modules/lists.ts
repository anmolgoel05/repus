import { Body,Controller,Get,Post,Delete,Patch,Param,Req,Injectable,ForbiddenException,NotFoundException,ParseUUIDPipe } from '@nestjs/common';
import { ApiTags,PartialType } from '@nestjs/swagger';
import { IsOptional,IsString,IsArray,IsUUID,Matches,MaxLength } from 'class-validator';
import { Request } from 'express';
import { prisma } from '@repus/database';
import { AuthService } from './auth';
export class ListDto{@IsString() @Matches(/\S/) @MaxLength(120) name!:string;@IsOptional() @IsString() @MaxLength(500) description?:string;}
export class UpdateListDto extends PartialType(ListDto) {}
class MembershipDto{@IsArray() @IsUUID('4',{each:true}) contactIds!:string[];}
@Injectable() export class ListsService{
 constructor(private auth:AuthService){}
 private async actor(req:Request){return this.auth.authenticate(req.cookies?.repus_session as string|undefined)}
 async list(req:Request){const u=await this.actor(req);return prisma.contactList.findMany({where:{tenantId:u.tenantId},orderBy:{name:'asc'},include:{_count:{select:{contacts:true}}}})}
 async get(req:Request,id:string){const u=await this.actor(req);const list=await prisma.contactList.findFirst({where:{id,tenantId:u.tenantId},include:{_count:{select:{contacts:true}}}});if(!list)throw new NotFoundException('List not found.');return list}
 async create(req:Request,d:ListDto){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');return prisma.contactList.create({data:{tenantId:u.tenantId,name:d.name.trim(),description:d.description?.trim()}})}
 async update(req:Request,id:string,d:Partial<ListDto>){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');const list=await prisma.contactList.findFirst({where:{id,tenantId:u.tenantId}});if(!list)throw new NotFoundException('List not found.');return prisma.contactList.update({where:{id},data:{name:d.name?.trim(),description:d.description?.trim()}})}
 async remove(req:Request,id:string){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');const list=await prisma.contactList.findFirst({where:{id,tenantId:u.tenantId}});if(!list)throw new NotFoundException('List not found.');await prisma.contactList.delete({where:{id}});return {success:true}}
 async addContacts(req:Request,id:string,d:MembershipDto){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');const list=await prisma.contactList.findFirst({where:{id,tenantId:u.tenantId}});if(!list)throw new NotFoundException('List not found.');const contacts=await prisma.contact.findMany({where:{tenantId:u.tenantId,deletedAt:null,id:{in:d.contactIds}},select:{id:true}});if(contacts.length!==new Set(d.contactIds).size)throw new NotFoundException('One or more contacts were not found in this workspace.');await prisma.listContact.createMany({data:contacts.map(c=>({tenantId:u.tenantId,listId:id,contactId:c.id})),skipDuplicates:true});return {added:contacts.length};}
 async removeContacts(req:Request,id:string,d:MembershipDto){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');const list=await prisma.contactList.findFirst({where:{id,tenantId:u.tenantId}});if(!list)throw new NotFoundException('List not found.');return prisma.listContact.deleteMany({where:{tenantId:u.tenantId,listId:id,contactId:{in:d.contactIds}}}).then(x=>({removed:x.count}));}
}
@ApiTags('lists') @Controller('lists') export class ListsController{
 constructor(private service:ListsService){}
 @Get() async list(@Req()r:Request){return {data:await this.service.list(r)}}
 @Get(':id') async get(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.get(r,id)}}
 @Post() async create(@Req()r:Request,@Body()d:ListDto){return {data:await this.service.create(r,d)}}
 @Patch(':id') async update(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:UpdateListDto){return {data:await this.service.update(r,id,d)}}
 @Delete(':id') async remove(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.remove(r,id)}}
 @Post(':id/contacts') async add(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:MembershipDto){return {data:await this.service.addContacts(r,id,d)}}
 @Delete(':id/contacts') async removeMembers(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:MembershipDto){return {data:await this.service.removeContacts(r,id,d)}}
}

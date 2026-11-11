import { Body,Controller,Get,Post,Patch,Delete,Param,Req,Injectable,ForbiddenException,NotFoundException,BadRequestException,ParseUUIDPipe } from '@nestjs/common';
import { ApiTags,PartialType } from '@nestjs/swagger';
import { IsObject,IsOptional,IsString,Matches,MaxLength } from 'class-validator';
import { Request } from 'express';
import { prisma } from '@repus/database';
import sanitizeHtml from 'sanitize-html';
import { AuthService } from './auth';
export class TemplateDto{@IsString() @Matches(/\S/) @MaxLength(160) name!:string;@IsOptional() @IsString() @MaxLength(255) subject?:string;@IsString() @MaxLength(500000) htmlContent!:string;@IsOptional() @IsString() @MaxLength(500000) textContent?:string;@IsOptional() @IsObject() editorJson?:Record<string,unknown>;}
export class UpdateTemplateDto extends PartialType(TemplateDto) {}
const editorKinds=['heading','paragraph','button','image','columns','divider'] as const;
export function normalizeTemplateEditorJson(input:unknown){
 if(input===undefined)return undefined;
 if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Template editor data must be an object.');
 const value=input as Record<string,unknown>;if((value.version!==1&&value.version!==2)||!Array.isArray(value.blocks)||value.blocks.length>100)throw new BadRequestException('Template editor data has an unsupported format.');
 const blocks=value.blocks.map((item,index)=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new BadRequestException('Template editor block is invalid.');const block=item as Record<string,unknown>;if(!editorKinds.includes(block.kind as typeof editorKinds[number])||typeof block.text!=='string'||block.text.length>10_000)throw new BadRequestException('Template editor block is invalid.');if(block.secondText!==undefined&&(typeof block.secondText!=='string'||block.secondText.length>10_000))throw new BadRequestException('Template editor block is invalid.');if(block.url!==undefined&&(typeof block.url!=='string'||block.url.length>2048))throw new BadRequestException('Template editor block is invalid.');if(block.assetId!==undefined&&(typeof block.assetId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(block.assetId)))throw new BadRequestException('Template editor block is invalid.');if(block.bold!==undefined&&typeof block.bold!=='boolean'||block.italic!==undefined&&typeof block.italic!=='boolean')throw new BadRequestException('Template editor block formatting is invalid.');if(block.textColor!==undefined&&(typeof block.textColor!=='string'||!/^#[0-9a-f]{6}$/i.test(block.textColor)))throw new BadRequestException('Template editor text color is invalid.');return {id:index+1,kind:block.kind,text:block.text,...(typeof block.secondText==='string'?{secondText:block.secondText}:{}),...(typeof block.url==='string'?{url:block.url}:{}),...(typeof block.assetId==='string'?{assetId:block.assetId}:{}),...(typeof block.bold==='boolean'?{bold:block.bold}:{}),...(typeof block.italic==='boolean'?{italic:block.italic}:{}),...(typeof block.textColor==='string'?{textColor:block.textColor}:{})};});
 if(value.version===2&&value.backgroundColor!==undefined&&(typeof value.backgroundColor!=='string'||!/^#[0-9a-f]{6}$/i.test(value.backgroundColor)))throw new BadRequestException('Template background color is invalid.');
 return value.version===2?{version:2,blocks,backgroundColor:value.backgroundColor??'#ffffff'}:{version:1,blocks};
}
const safeEmailStyles={'*':{
 'background':[/^(?:#[\da-f]{3,8}|white|black|transparent)$/i],
 'background-color':[/^(?:#[\da-f]{3,8}|white|black|transparent)$/i],
 'border':[/^(?:0|\d{1,2}px solid (?:#[\da-f]{3,8}|white|black))$/i],
 'border-collapse':[/^collapse$/i],
 'border-top':[/^(?:0|\d{1,2}px solid (?:#[\da-f]{3,8}|white|black))$/i],
 'border-radius':[/^(?:0|\d{1,3}px|\d{1,3}%|\d{1,3}px\s+\d{1,3}px)$/i],
 'color':[/^(?:#[\da-f]{3,8}|white|black|transparent)$/i],
 'display':[/^(?:block|inline|inline-block|table|table-cell)$/i],
 'font-family':[/^[\w\s,"'-]{1,100}$/],
 'font-size':[/^\d{1,3}(?:px|pt|em|%)$/i],
 'font-weight':[/^(?:normal|bold|[1-9]00)$/i],
 'height':[/^(?:auto|\d{1,4}px)$/i],
 'line-height':[/^\d{1,3}(?:\.\d{1,2})?(?:px|%|em)?$/i],
 'margin':[/^(?:0|\d{1,4}(?:px|%|em))(?:\s+(?:0|\d{1,4}(?:px|%|em))){0,3}$/i],
 'max-width':[/^\d{1,4}(?:px|%)$/i],
 'padding':[/^(?:0|\d{1,4}(?:px|%|em))(?:\s+(?:0|\d{1,4}(?:px|%|em))){0,3}$/i],
 'text-align':[/^(?:left|right|center|justify)$/i],
 'text-decoration':[/^(?:none|underline|line-through)$/i],
 'vertical-align':[/^(?:top|middle|bottom|baseline)$/i],
 'white-space':[/^(?:normal|nowrap|pre|pre-line|pre-wrap)$/i],
 'width':[/^\d{1,4}(?:px|%)$/i],
}};
const hasEmbeddedUrlCredentials=(value:string|undefined)=>{
 if(!value)return false;
 try{const url=new URL(value);return Boolean(url.username||url.password)}catch{return false}
};
const removeCredentialUrl=(attribs:Record<string,string>,key:'href'|'src')=>{
 const safe={...attribs};
 if(hasEmbeddedUrlCredentials(safe[key]))delete safe[key];
 return safe;
};
export const sanitizeEmailHtml=(html:string)=>sanitizeHtml(html,{allowedTags:['a','b','blockquote','br','caption','center','code','div','em','font','h1','h2','h3','h4','hr','i','img','li','ol','p','span','strong','table','tbody','td','th','thead','tr','u','ul'],allowedAttributes:{'*':['style','class','align','valign','bgcolor'],a:['href','name','target','rel'],img:['src','alt','width','height'],td:['colspan','rowspan','width','role'],th:['colspan','rowspan','width'],table:['width','cellpadding','cellspacing','border','role']},allowedStyles:safeEmailStyles,allowedSchemes:['http','https','mailto'],transformTags:{a:(_tagName,attribs)=>({tagName:'a',attribs:removeCredentialUrl(attribs,'href')}),img:(_tagName,attribs)=>({tagName:'img',attribs:removeCredentialUrl(attribs,'src')})},disallowedTagsMode:'discard'});
@Injectable() export class TemplatesService{
 constructor(private auth:AuthService){}
 private async actor(req:Request){return this.auth.authenticate(req.cookies?.repus_session as string|undefined)}
 async list(req:Request){const u=await this.actor(req);return prisma.template.findMany({where:{tenantId:u.tenantId},orderBy:{updatedAt:'desc'}})}
 async get(req:Request,id:string){const u=await this.actor(req);const template=await prisma.template.findFirst({where:{id,tenantId:u.tenantId}});if(!template)throw new NotFoundException('Template not found.');return template}
 async create(req:Request,d:TemplateDto){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 98321))`;return prisma.template.create({data:{tenantId:u.tenantId,name:d.name.trim(),subject:d.subject?.trim(),htmlContent:sanitizeEmailHtml(d.htmlContent),textContent:d.textContent??d.htmlContent.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),editorJson:normalizeTemplateEditorJson(d.editorJson) as any}})}
 async update(req:Request,id:string,d:Partial<TemplateDto>){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 98321))`;const t=await prisma.template.findFirst({where:{id,tenantId:u.tenantId}});if(!t)throw new NotFoundException('Template not found.');return prisma.template.update({where:{id},data:{name:d.name?.trim(),subject:d.subject?.trim(),htmlContent:d.htmlContent?sanitizeEmailHtml(d.htmlContent):undefined,textContent:d.textContent,editorJson:d.editorJson===undefined?undefined:normalizeTemplateEditorJson(d.editorJson) as any}})}
 async remove(req:Request,id:string){const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');const t=await prisma.template.findFirst({where:{id,tenantId:u.tenantId}});if(!t)throw new NotFoundException('Template not found.');await prisma.template.delete({where:{id}});return {success:true}}
}
@ApiTags('templates') @Controller('templates') export class TemplatesController{
 constructor(private service:TemplatesService){}
 @Get() async list(@Req()r:Request){return {data:await this.service.list(r)}}
 @Get(':id') async get(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.get(r,id)}}
 @Post() async create(@Req()r:Request,@Body()d:TemplateDto){return {data:await this.service.create(r,d)}}
 @Patch(':id') async update(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:UpdateTemplateDto){return {data:await this.service.update(r,id,d)}}
 @Delete(':id') async remove(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.remove(r,id)}}
}

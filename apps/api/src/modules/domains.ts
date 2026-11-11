import {Body,Controller,Get,Post,Param,Req,Injectable,ForbiddenException,NotFoundException,BadRequestException,ParseUUIDPipe} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {IsString,Matches,MaxLength} from 'class-validator';
import {Request} from 'express';
import {GetEmailIdentityCommand,SESv2Client} from '@aws-sdk/client-sesv2';
import {resolveTxt} from 'node:dns/promises';
import {prisma} from '@repus/database';
import {AuthService} from './auth';
import {hasDmarcPolicyRecord,hasSesSpfRecord} from './dns-readiness';
class AddDomainDto{@IsString() @MaxLength(253) @Matches(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i) domain!:string;}
@Injectable() export class DomainsService{
 private ses=new SESv2Client({region:process.env.AWS_REGION});
 constructor(private auth:AuthService){}
 private async actor(r:Request){return this.auth.authenticate(r.cookies?.repus_session as string|undefined)}
 async list(r:Request){const u=await this.actor(r);return prisma.sendingDomain.findMany({where:{tenantId:u.tenantId},orderBy:{createdAt:'desc'}})}
 async get(r:Request,id:string){const u=await this.actor(r);const domain=await prisma.sendingDomain.findFirst({where:{id,tenantId:u.tenantId}});if(!domain)throw new NotFoundException('Sending domain not found.');return domain}
 async add(r:Request,raw:string){const u=await this.actor(r);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');const domain=raw.trim().toLowerCase();if(!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain))throw new BadRequestException('Enter a valid domain name.');let tokens:string[]=[];
  if(process.env.EMAIL_PROVIDER==='ses'){
   const existing=await this.ses.send(new GetEmailIdentityCommand({EmailIdentity:domain})).catch(error=>{if((error as {name?:string}).name==='NotFoundException')throw new BadRequestException('This sending identity is not provisioned in Amazon SES yet. Ask your Repus administrator to add the domain identity and grant its explicit identity ARN to the application role.');throw error;});
   tokens=existing.DkimAttributes?.Tokens??[];
  }
  const record=await prisma.sendingDomain.upsert({where:{tenantId_domain:{tenantId:u.tenantId,domain}},create:{tenantId:u.tenantId,domain},update:{}});
  return {domain:record,developmentMode:process.env.EMAIL_PROVIDER!=='ses',dns:{dkim:tokens.map(token=>({type:'CNAME',name:`${token}._domainkey.${domain}`,value:`${token}.dkim.amazonses.com`})),spf:{type:'TXT',name:domain,instructions:'Add include:amazonses.com to your existing SPF TXT record. Keep a single SPF record and preserve your current mail providers.'},dmarc:{type:'TXT',name:`_dmarc.${domain}`,value:`v=DMARC1; p=none; rua=mailto:postmaster@${domain}`}}};
 }
 async verify(r:Request,id:string){const u=await this.actor(r);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');const record=await prisma.sendingDomain.findFirst({where:{id,tenantId:u.tenantId}});if(!record)throw new NotFoundException('Sending domain not found.');
  if(process.env.EMAIL_PROVIDER!=='ses')return prisma.sendingDomain.update({where:{id},data:{verificationStatus:'verified',dkimStatus:'development',spfStatus:'development',dmarcStatus:'development'}});
  const identity=await this.ses.send(new GetEmailIdentityCommand({EmailIdentity:record.domain}));const verified=identity.VerificationStatus==='SUCCESS';const dkim=identity.DkimAttributes?.Status==='SUCCESS';
  const [spfTxt,dmarcTxt]=await Promise.all([resolveTxt(record.domain).catch(()=>[]),resolveTxt(`_dmarc.${record.domain}`).catch(()=>[])]);
  const spf=hasSesSpfRecord(spfTxt);
  const dmarc=hasDmarcPolicyRecord(dmarcTxt);
  return prisma.sendingDomain.update({where:{id},data:{verificationStatus:verified?'verified':'pending',dkimStatus:dkim?'verified':'pending',spfStatus:spf?'verified':'missing',dmarcStatus:dmarc?'verified':'missing'}});
 }
}
@ApiTags('sending domains') @Controller('domains') export class DomainsController{
 constructor(private service:DomainsService){}
 @Get() async list(@Req()r:Request){return {data:await this.service.list(r)}}
 @Get(':id') async get(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.get(r,id)}}
 @Post() async add(@Req()r:Request,@Body()d:AddDomainDto){return {data:await this.service.add(r,d.domain)}}
 @Post(':id/verify') async verify(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.verify(r,id)}}
}

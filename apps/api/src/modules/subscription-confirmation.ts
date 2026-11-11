import {Controller,Get,Headers,Injectable,NotFoundException,Param,Post,Res,UnauthorizedException} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {Throttle} from '@nestjs/throttler';
import {Response} from 'express';
import {prisma,withContactConfirmationToken} from '@repus/database';
import {tokenHash} from '@repus/token-security';
import {setSensitiveResponseHeaders} from './sensitive-response';

@Injectable()
export class SubscriptionConfirmationService{
 async valid(token:string){
  const result=await withContactConfirmationToken(tokenHash(token),async capability=>{
   if(capability.confirmedAt||capability.expiresAt<=new Date())return false;
   const contact=await prisma.contact.findFirst({where:{id:capability.contactId,tenantId:capability.tenantId,status:'PENDING_CONFIRMATION',deletedAt:null},select:{consentAt:true,consentSource:true}});
   return Boolean(contact?.consentAt&&contact.consentSource);
  });
  return result===true;
 }
 async confirm(token:string){
  const result=await withContactConfirmationToken(tokenHash(token),async capability=>{
   const now=new Date();if(capability.confirmedAt||capability.expiresAt<=now)return false;
   const contact=await prisma.contact.findFirst({where:{id:capability.contactId,tenantId:capability.tenantId,status:'PENDING_CONFIRMATION',deletedAt:null},select:{id:true,normalizedEmail:true,consentAt:true,consentSource:true}});
   if(!contact?.consentAt||!contact.consentSource)return false;
   const claimed=await prisma.contactConfirmationToken.updateMany({where:{id:capability.id,confirmedAt:null,expiresAt:{gt:now}},data:{confirmedAt:now}});
   if(!claimed.count)return false;
   const activated=await prisma.contact.updateMany({where:{id:contact.id,tenantId:capability.tenantId,status:'PENDING_CONFIRMATION',deletedAt:null},data:{status:'SUBSCRIBED'}});
   if(!activated.count)throw new UnauthorizedException('This subscription confirmation is no longer available.');
   const suppression=await prisma.suppression.findUnique({where:{tenantId_normalizedEmail:{tenantId:capability.tenantId,normalizedEmail:contact.normalizedEmail}},select:{id:true,reason:true}});
   if(suppression&&suppression.reason!=='unsubscribe')throw new UnauthorizedException('This address remains suppressed and cannot be reactivated.');
   if(suppression)await prisma.suppression.deleteMany({where:{id:suppression.id,tenantId:capability.tenantId,reason:'unsubscribe'}});
   await prisma.contactConfirmationToken.updateMany({where:{tenantId:capability.tenantId,contactId:contact.id,id:{not:capability.id},confirmedAt:null},data:{confirmedAt:now}});
   await prisma.auditLog.create({data:{tenantId:capability.tenantId,action:'contact.double_opt_in.confirmed',entityType:'contact',entityId:contact.id,metadata:{consentSource:contact.consentSource,permissionRecordedAt:contact.consentAt.toISOString(),confirmedAt:now.toISOString()}}});
   return true;
  });
  if(result!==true)throw new UnauthorizedException('This subscription confirmation is invalid or has expired.');
  return {confirmed:true};
 }
}

@ApiTags('public subscription confirmation')
@Controller('confirm-subscription')
export class SubscriptionConfirmationController{
 constructor(private service:SubscriptionConfirmationService){}
 @Get(':token') async page(@Param('token')token:string,@Res()res:Response){
  setSensitiveResponseHeaders(res);
  if(!await this.service.valid(token))throw new NotFoundException('This subscription confirmation is invalid or has expired.');
  const action=`/api/v1/confirm-subscription/${encodeURIComponent(token)}`;
  return res.type('html').send(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm subscription</title><body style="font:16px system-ui;background:#f7f9fc;color:#17243b;display:grid;place-items:center;min-height:90vh"><main style="background:white;padding:36px;border:1px solid #e8edf3;border-radius:14px;max-width:420px"><h1>Confirm your subscription</h1><p>Confirm that you want to receive emails from this sender.</p><form method="post" action="${action}"><button style="background:#2563eb;color:white;border:0;padding:12px 18px;border-radius:8px;font:inherit">Confirm subscription</button></form></main></body></html>`);
 }
 @Post(':token') @Throttle({default:{limit:10,ttl:60*60*1000}}) async submit(@Param('token')token:string,@Res()res:Response,@Headers('accept')accept?:string){
  setSensitiveResponseHeaders(res);
  const result=await this.service.confirm(token);
  if(accept?.includes('application/json'))return res.json({data:result});
  return res.type('html').send('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;background:#f7f9fc;color:#17243b;display:grid;place-items:center;min-height:90vh"><main style="background:white;padding:36px;border:1px solid #e8edf3;border-radius:14px"><h1>Subscription confirmed</h1><p>You are confirmed to receive emails from this sender.</p></main></body></html>');
 }
}

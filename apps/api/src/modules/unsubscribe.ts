import {Controller,Get,Post,Param,Req,Res,Injectable,NotFoundException} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {Request,Response} from 'express';
import {prisma,withUnsubscribeToken} from '@repus/database';
import {tokenHash} from '@repus/token-security';
import {publishSendInterrupt} from './send-interrupts';
import {setSensitiveResponseHeaders} from './sensitive-response';
@Injectable() export class UnsubscribeService{
 async validate(token:string){const recipient=await withUnsubscribeToken(tokenHash(token),async r=>r.id);if(!recipient)throw new NotFoundException('This unsubscribe link is invalid or has expired.');return {valid:true};}
 async unsubscribe(token:string,reason?:string){
  const result=await withUnsubscribeToken(tokenHash(token),async found=>{
   const recipient=await prisma.campaignRecipient.findUnique({where:{id:found.id},include:{contact:true}});if(!recipient)return null;
   const inFlightRecipientIds=await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recipient.tenantId}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
    const normalizedEmail=recipient.email.trim().toLowerCase();
    const currentContact=await tx.contact.findFirst({where:{id:recipient.contactId,tenantId:recipient.tenantId},select:{deletedAt:true,normalizedEmail:true}});
    const contactIsActive=!!currentContact&&!currentContact.deletedAt;
    if(contactIsActive&&currentContact?.normalizedEmail===normalizedEmail)await tx.contact.updateMany({where:{id:recipient.contactId,tenantId:recipient.tenantId,normalizedEmail,deletedAt:null},data:{status:'UNSUBSCRIBED'}});
    await tx.suppression.upsert({where:{tenantId_normalizedEmail:{tenantId:recipient.tenantId,normalizedEmail}},create:{tenantId:recipient.tenantId,email:recipient.email,normalizedEmail,reason:'unsubscribe',source:'email_link'},update:{}});
    const unsubscribeEvent=await tx.emailEvent.createMany({data:[{tenantId:recipient.tenantId,recipientId:recipient.id,eventType:'unsubscribe',eventKey:`unsubscribe:${recipient.id}`}],skipDuplicates:true});
    if(unsubscribeEvent.count)await tx.unsubscribe.create({data:{tenantId:recipient.tenantId,contactId:contactIsActive?recipient.contactId:null,email:recipient.email,reason:reason?.slice(0,500)}});
    const affected=await tx.campaignRecipient.findMany({where:{tenantId:recipient.tenantId,email:{equals:normalizedEmail,mode:'insensitive'},status:{in:['PENDING','QUEUED','SENDING']}},select:{id:true,campaignId:true,quotaDate:true,quotaReserved:true,status:true}});
    const pending=affected.filter(row=>row.status!=='SENDING'&&row.quotaReserved);
    if(pending.length){
     const changed=await tx.campaignRecipient.updateMany({where:{id:{in:pending.map(row=>row.id)},quotaReserved:true,status:{in:['PENDING','QUEUED']}},data:{status:'SUPPRESSED',quotaReserved:false}});
     const byDay=new Map<string,{date:Date;count:number}>();
     for(const row of pending){const date=row.quotaDate;const key=date.toISOString().slice(0,10);const entry=byDay.get(key)??{date,count:0};entry.count++;byDay.set(key,entry);}
     let remaining=changed.count;
     for(const entry of byDay.values()){const amount=Math.min(entry.count,remaining);if(amount<=0)continue;remaining-=amount;await tx.dailyUsage.updateMany({where:{tenantId:recipient.tenantId,usageDate:entry.date},data:{reservedCount:{decrement:amount}}});await tx.platformDailyUsage.updateMany({where:{usageDate:entry.date},data:{reservedCount:{decrement:amount}}});}
     for(const campaignId of new Set(pending.map(row=>row.campaignId))){
      const active=await tx.campaignRecipient.count({where:{tenantId:recipient.tenantId,campaignId,status:{in:['PENDING','QUEUED','SENDING']}}});
      if(active===0){const accepted=await tx.campaignRecipient.count({where:{tenantId:recipient.tenantId,campaignId,sentAt:{not:null}}});await tx.campaign.updateMany({where:{id:campaignId,tenantId:recipient.tenantId,status:{in:['SCHEDULED','QUEUED','SENDING']}},data:{status:accepted?'COMPLETED':'FAILED',completedAt:new Date()}});}
     }
    }
    return [...new Set([recipient.id,...affected.filter(row=>row.status==='SENDING').map(row=>row.id)])];
   });return {success:true,inFlightRecipientIds};
  });
  if(!result)throw new NotFoundException('This unsubscribe link is invalid or has expired.');
  await Promise.all(result.inFlightRecipientIds.map(recipientId=>publishSendInterrupt({scope:'recipient',recipientId})));
  return {success:true};
 }
}
@ApiTags('public unsubscribe') @Controller('unsubscribe') export class UnsubscribeController{
 constructor(private service:UnsubscribeService){}
 @Get(':token') async page(@Param('token')token:string,@Res()res:Response){
  setSensitiveResponseHeaders(res);
  await this.service.validate(token);
  const action=`/unsubscribe/${encodeURIComponent(token)}`;
  return res.type('html').send(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font:16px system-ui;background:#f7f9fc;color:#17243b;display:grid;place-items:center;min-height:90vh"><main style="background:white;padding:36px;border:1px solid #e8edf3;border-radius:14px;max-width:420px"><h1>Manage your emails</h1><p>Confirm that you’d like to stop receiving marketing emails from this sender.</p><form method="post" action="${action}"><button style="background:#2563eb;color:white;border:0;padding:12px 18px;border-radius:8px;font:inherit">Unsubscribe</button></form></main></body></html>`);
 }
 @Post(':token') async submit(@Param('token')token:string,@Req()req:Request,@Res()res:Response){setSensitiveResponseHeaders(res);const reason=typeof req.body?.reason==='string'?req.body.reason:undefined;await this.service.unsubscribe(token,reason);return res.type('html').send('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;background:#f7f9fc;color:#17243b;display:grid;place-items:center;min-height:90vh"><main style="background:white;padding:36px;border:1px solid #e8edf3;border-radius:14px"><h1>You’re unsubscribed</h1><p>You will not receive further marketing emails from this sender.</p></main></body></html>');}
}

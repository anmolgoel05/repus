import { Body, Controller, Get, Post, Patch, Delete, Param, Query, Req, Res, HttpCode, Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Request,Response } from 'express';
import { prisma } from '@repus/database';
import { serializeCsvRow } from '@repus/import-storage';
import { AuthService } from './auth';
import {createContactConfirmation} from './confirmation-mail';
import {parseContactConsentEvidence} from './contact-consent';
import {setPrivateCsvDownloadHeaders,streamCsvDownload} from './csv-download';
import {publishSendInterrupt} from './send-interrupts';
import {Throttle} from '@nestjs/throttler';

class CreateContactDto {
  @IsEmail() email!: string;
  @IsOptional() @IsString() @MaxLength(120) firstName?: string;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string;
  @IsString() @MaxLength(240) consentSource!: string;
  @IsDateString({strict:true}) consentAt!: string;
  @IsOptional() @IsObject() customFields?:Record<string,unknown>;
}
class UpdateContactDto {
  @IsOptional() @IsString() @MaxLength(120) firstName?: string;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() consentConfirmed?:boolean;
  @IsOptional() @IsString() @MaxLength(240) consentSource?:string;
  @IsOptional() @IsDateString({strict:true}) consentAt?:string;
  @IsOptional() @IsString() @MaxLength(4000) company?: string;
  @IsOptional() @IsObject() customFields?:Record<string,unknown>;
}
class ReactivateContactDto {
  @IsBoolean() consentConfirmed!:boolean;
  @IsString() @MaxLength(240) consentSource!:string;
  @IsDateString({strict:true}) consentAt!:string;
}
class ContactSelectionDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4',{each:true}) contactIds!:string[];
}
class BulkContactsDto extends ContactSelectionDto {
  @IsIn(['add_to_list','remove_from_list','unsubscribe','delete','add_tags','remove_tags']) action!:string;
  @IsOptional() @IsUUID('4') listId?:string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(32,{each:true}) @Matches(/^[\p{L}\p{N} _-]+$/u,{each:true}) tags?:string[];
}
function isValidCustomFieldValue(type:string,value:unknown){
 if(type==='TEXT')return typeof value==='string'&&value.length<=4000;
 if(type==='NUMBER')return typeof value==='number'&&Number.isFinite(value);
 if(type==='BOOLEAN')return typeof value==='boolean';
 if(type==='DATE'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){const date=new Date(`${value}T00:00:00.000Z`);return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;}
 return false;
}

@Injectable()
export class ContactsService {
  constructor(private auth: AuthService) {}
  private async actor(req: Request) { return this.auth.authenticate(req.cookies?.repus_session as string | undefined); }
  async get(req:Request,id:string){const user=await this.actor(req);const contact=await prisma.contact.findFirst({where:{id,tenantId:user.tenantId,deletedAt:null}});if(!contact)throw new NotFoundException('Contact not found.');const [definitions,unsubscribeHistory]=await Promise.all([prisma.customFieldDefinition.findMany({where:{tenantId:user.tenantId},orderBy:{createdAt:'asc'}}),prisma.unsubscribe.findMany({where:{tenantId:user.tenantId,contactId:id},orderBy:{createdAt:'desc'},select:{email:true,reason:true,createdAt:true}})]);return {...contact,customFieldDefinitions:definitions,unsubscribeHistory};}
  async list(req: Request, page: number, query: string,tag='') {
    const user = await this.actor(req); const take = 25; const skip = (page - 1) * take;
    if(tag&&(!/^[\p{L}\p{N} _-]{1,32}$/u.test(tag)))throw new BadRequestException('Choose a valid tag.');
    const where = { tenantId: user.tenantId, deletedAt:null, ...(tag?{customFields:{path:['tags'],array_contains:[tag.toLowerCase()]}}:{}), ...(query ? { OR: [{ email: { contains: query, mode: 'insensitive' as const } }, { firstName: { contains: query, mode: 'insensitive' as const } }, { lastName: { contains: query, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await prisma.$transaction([prisma.contact.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }), prisma.contact.count({ where })]);
    return { items, page, pageSize: take, total };
  }
  async tags(req:Request){
    const user=await this.actor(req);
    const rows=await prisma.$queryRaw<Array<{tag:string}>>`
      SELECT DISTINCT t.tag FROM contacts c
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(c.custom_fields->'tags')='array' THEN c.custom_fields->'tags' ELSE '[]'::jsonb END
      ) AS t(tag)
      WHERE c.tenant_id=${user.tenantId}::uuid AND c.deleted_at IS NULL
      ORDER BY t.tag LIMIT 100
    `;
    return rows.map(row=>row.tag);
  }
  async export(req:Request,query:string,tag:string,response:Response){
    const user=await this.actor(req);const q=query.trim().slice(0,150);if(tag&&(!/^[\p{L}\p{N} _-]{1,32}$/u.test(tag)))throw new BadRequestException('Choose a valid tag.');
    const customFields=await prisma.customFieldDefinition.findMany({where:{tenantId:user.tenantId},select:{key:true},orderBy:{key:'asc'}});
    setPrivateCsvDownloadHeaders(response,'repus-contacts.csv');
    async function* rows(){
      yield serializeCsvRow(['email','first_name','last_name','status','consent_source','consent_at','created_at',...customFields.map(field=>field.key)]);
      let lastId:string|undefined;
      while(true){
        const page=await prisma.contact.findMany({where:{tenantId:user.tenantId,deletedAt:null,...(tag?{customFields:{path:['tags'],array_contains:[tag.toLowerCase()]}}:{}),...(q?{OR:[{email:{contains:q,mode:'insensitive' as const}},{firstName:{contains:q,mode:'insensitive' as const}},{lastName:{contains:q,mode:'insensitive' as const}}]}:{}),...(lastId?{id:{gt:lastId}}:{})},orderBy:{id:'asc'},take:500,select:{id:true,email:true,firstName:true,lastName:true,status:true,consentSource:true,consentAt:true,createdAt:true,customFields:true}});
        if(!page.length)return;
        for(const contact of page){const values=contact.customFields&&typeof contact.customFields==='object'&&!Array.isArray(contact.customFields)?contact.customFields as Record<string,unknown>:{};yield serializeCsvRow([contact.email,contact.firstName??'',contact.lastName??'',contact.status,contact.consentSource??'',contact.consentAt?.toISOString()??'',contact.createdAt.toISOString(),...customFields.map(field=>String(values[field.key]??''))]);}
        lastId=page[page.length-1].id;if(page.length<500)return;
      }
    }
    await streamCsvDownload(rows(),response);
  }
  async exportSelected(req:Request,selection:ContactSelectionDto,response:Response){
    const user=await this.actor(req);const ids=[...new Set(selection.contactIds)];
    const customFields=await prisma.customFieldDefinition.findMany({where:{tenantId:user.tenantId},select:{key:true},orderBy:{key:'asc'}});
    const contacts=await prisma.contact.findMany({where:{tenantId:user.tenantId,deletedAt:null,id:{in:ids}},select:{id:true,email:true,firstName:true,lastName:true,status:true,consentSource:true,consentAt:true,createdAt:true,customFields:true},orderBy:{email:'asc'}});
    if(contacts.length!==ids.length)throw new NotFoundException('One or more selected contacts were not found in this workspace.');
    setPrivateCsvDownloadHeaders(response,'repus-selected-contacts.csv');
    const body=[serializeCsvRow(['email','first_name','last_name','status','consent_source','consent_at','created_at',...customFields.map(field=>field.key)]),...contacts.map(c=>{const values=c.customFields&&typeof c.customFields==='object'&&!Array.isArray(c.customFields)?c.customFields as Record<string,unknown>:{};return serializeCsvRow([c.email,c.firstName??'',c.lastName??'',c.status,c.consentSource??'',c.consentAt?.toISOString()??'',c.createdAt.toISOString(),...customFields.map(field=>String(values[field.key]??''))]);})].join('');
    response.send(body);
  }
  async create(req: Request, dto: CreateContactDto) {
    const user = await this.actor(req); const email = dto.email.trim().toLowerCase();
    if(user.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');
    const evidence=parseContactConsentEvidence(dto.consentSource,dto.consentAt);
    if(!evidence)throw new BadRequestException('Record when and how this subscriber gave permission using a valid date that is not in the future.');
    const {consentSource,consentAt}=evidence;
    return prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId}, 0))`;
      const definitions=await tx.customFieldDefinition.findMany({where:{tenantId:user.tenantId,archived:false}});
      const customFields=dto.customFields??{};
      const allowed=new Set(definitions.map(field=>field.key));
      if(Object.keys(customFields).some(key=>!allowed.has(key)))throw new BadRequestException('One or more custom fields are not defined for this workspace.');
      for(const field of definitions){const value=customFields[field.key];if(field.required&&(value===undefined||value===null||value===''))throw new BadRequestException(`${field.label} is required.`);if(value===undefined||value===null||value==='')continue;if(!isValidCustomFieldValue(field.type,value))throw new BadRequestException(`${field.label} has an invalid value.`);}
      const existing = await tx.suppression.findUnique({ where: { tenantId_normalizedEmail: { tenantId: user.tenantId, normalizedEmail: email } } });
      if (existing) throw new ConflictException(existing.reason==='unsubscribe'
        ? 'This address is suppressed because the subscriber opted out. If their contact is still in your workspace and they have given fresh permission, use Reactivate subscriber on their contact page.'
        : 'This address is suppressed and cannot be added to your contacts.');
      const existingContact=await tx.contact.findFirst({where:{tenantId:user.tenantId,normalizedEmail:email,deletedAt:null}});
      if(!existingContact){const limits=await tx.tenantSendingLimit.findUnique({where:{tenantId:user.tenantId}});const count=await tx.contact.count({where:{tenantId:user.tenantId,deletedAt:null}});if(limits&&count>=limits.contactLimit)throw new ForbiddenException('Your contact storage limit has been reached. Remove contacts or update your plan to add more.');}
      const tenant=await tx.tenant.findUnique({where:{id:user.tenantId},select:{doubleOptInEnabled:true}});
      const contact=await tx.contact.upsert({ where: { tenantId_normalizedEmail: { tenantId: user.tenantId, normalizedEmail: email } }, update: {}, create: { tenantId: user.tenantId, email, normalizedEmail: email, firstName: dto.firstName?.trim(), lastName: dto.lastName?.trim(), status: tenant?.doubleOptInEnabled?'PENDING_CONFIRMATION':'SUBSCRIBED', consentSource, consentAt,customFields:customFields as any } });
      if(tenant?.doubleOptInEnabled&&!existingContact)await createContactConfirmation(tx,user.tenantId,contact.id);
      return {...contact,confirmationRequired:contact.status==='PENDING_CONFIRMATION'};
    });
  }
  async bulk(req:Request,dto:BulkContactsDto){
    const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');
    const ids=[...new Set(dto.contactIds)];const contacts=await prisma.contact.findMany({where:{tenantId:u.tenantId,deletedAt:null,id:{in:ids}},select:{id:true,email:true,normalizedEmail:true,customFields:true}});
    if(contacts.length!==ids.length)throw new NotFoundException('One or more selected contacts were not found in this workspace.');
    if(dto.action==='add_to_list'||dto.action==='remove_from_list'){
      if(!dto.listId)throw new BadRequestException('Choose a contact list first.');
      const list=await prisma.contactList.findFirst({where:{id:dto.listId,tenantId:u.tenantId}});if(!list)throw new NotFoundException('Contact list not found.');
      const result=await prisma.$transaction(async tx=>{
        if(dto.action==='add_to_list')return {affectedCount:(await tx.listContact.createMany({data:ids.map(contactId=>({tenantId:u.tenantId,listId:dto.listId!,contactId})),skipDuplicates:true})).count};
        return {affectedCount:(await tx.listContact.deleteMany({where:{tenantId:u.tenantId,listId:dto.listId!,contactId:{in:ids}}})).count};
      });
      await prisma.auditLog.create({data:{tenantId:u.tenantId,userId:u.id,action:`contacts.bulk_${dto.action}`,entityType:'contact',metadata:{selected:ids.length,affected:result.affectedCount,listId:dto.listId}}});return {action:dto.action,...result};
    }
    if(dto.action==='add_tags'||dto.action==='remove_tags'){
      const tags=[...new Set((dto.tags??[]).map(tag=>tag.trim().replace(/\s+/g,' ').toLowerCase()).filter(Boolean))];if(!tags.length)throw new BadRequestException('Enter at least one tag.');
      await prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 0))`;for(const contact of contacts){const fields=contact.customFields&&typeof contact.customFields==='object'&&!Array.isArray(contact.customFields)?contact.customFields as Record<string,unknown>:{};const current=Array.isArray(fields.tags)?fields.tags.filter((tag):tag is string=>typeof tag==='string'):[];const next=dto.action==='add_tags'?[...new Set([...current,...tags])]:current.filter(tag=>!tags.includes(tag));await tx.contact.update({where:{id:contact.id},data:{customFields:{...fields,tags:next} as any}});}});
      await prisma.auditLog.create({data:{tenantId:u.tenantId,userId:u.id,action:`contacts.bulk_${dto.action}`,entityType:'contact',metadata:{selected:ids.length,tags}}});return {action:dto.action,affectedCount:ids.length,tags};
    }
    if(dto.action==='unsubscribe'){
      const result=await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 0))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
        const currentContacts=await tx.contact.findMany({where:{tenantId:u.tenantId,id:{in:ids},deletedAt:null},select:{id:true,email:true,normalizedEmail:true,status:true}});
        if(currentContacts.length!==ids.length)throw new NotFoundException('One or more selected contacts were not found in this workspace.');
        const newlyUnsubscribed=currentContacts.filter(contact=>contact.status!=='UNSUBSCRIBED');
        await tx.contact.updateMany({where:{tenantId:u.tenantId,id:{in:ids},deletedAt:null},data:{status:'UNSUBSCRIBED'}});
        for(const contact of currentContacts)await tx.suppression.upsert({where:{tenantId_normalizedEmail:{tenantId:u.tenantId,normalizedEmail:contact.normalizedEmail}},create:{tenantId:u.tenantId,email:contact.email,normalizedEmail:contact.normalizedEmail,reason:'unsubscribe',source:'workspace_bulk_action'},update:{}});
        if(newlyUnsubscribed.length)await tx.unsubscribe.createMany({data:newlyUnsubscribed.map(contact=>({tenantId:u.tenantId,contactId:contact.id,email:contact.email,reason:'workspace_bulk_action'}))});
        const recipients=await tx.campaignRecipient.findMany({where:{tenantId:u.tenantId,contactId:{in:ids},status:{in:['PENDING','QUEUED','SENDING']}},select:{id:true,campaignId:true,status:true,quotaReserved:true,quotaDate:true}});
        if(recipients.length)await tx.emailEvent.createMany({data:recipients.map(r=>({tenantId:u.tenantId,recipientId:r.id,eventType:'unsubscribe',eventKey:`unsubscribe:${r.id}`})),skipDuplicates:true});
        const pending=recipients.filter(r=>['PENDING','QUEUED'].includes(r.status));
        if(pending.length){
          await tx.campaignRecipient.updateMany({where:{id:{in:pending.map(r=>r.id)},status:{in:['PENDING','QUEUED']}},data:{status:'SUPPRESSED',quotaReserved:false}});
          const reserved=pending.filter(row=>row.quotaReserved);
          const byDay=new Map<string,{date:Date;count:number}>();
          for(const row of reserved){const date=row.quotaDate;const key=date.toISOString().slice(0,10);const entry=byDay.get(key)??{date,count:0};entry.count++;byDay.set(key,entry);}
          for(const entry of byDay.values()){await tx.dailyUsage.updateMany({where:{tenantId:u.tenantId,usageDate:entry.date},data:{reservedCount:{decrement:entry.count}}});await tx.platformDailyUsage.updateMany({where:{usageDate:entry.date},data:{reservedCount:{decrement:entry.count}}});}
          for(const campaignId of new Set(pending.map(row=>row.campaignId))){const active=await tx.campaignRecipient.count({where:{tenantId:u.tenantId,campaignId,status:{in:['PENDING','QUEUED','SENDING']}}});if(active===0){const accepted=await tx.campaignRecipient.count({where:{tenantId:u.tenantId,campaignId,sentAt:{not:null}}});await tx.campaign.updateMany({where:{id:campaignId,tenantId:u.tenantId,status:{in:['SCHEDULED','QUEUED','SENDING']}},data:{status:accepted?'COMPLETED':'FAILED',completedAt:new Date()}});}}
        }
        await tx.auditLog.create({data:{tenantId:u.tenantId,userId:u.id,action:'contacts.bulk_unsubscribe',entityType:'contact',metadata:{count:newlyUnsubscribed.length,queuedRecipientsSuppressed:pending.length}}});
        return {count:newlyUnsubscribed.length,inFlightRecipientIds:recipients.filter(r=>r.status==='SENDING').map(r=>r.id)};
      });
      await Promise.all(result.inFlightRecipientIds.map(recipientId=>publishSendInterrupt({scope:'recipient',recipientId})));
      return {action:dto.action,affectedCount:result.count};
    }
    if(dto.action==='delete'){
      const count=await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 0))`;
        const active=await tx.campaignRecipient.count({where:{tenantId:u.tenantId,contactId:{in:ids},status:'SENDING'}});if(active)throw new ConflictException('One or more subscribers are currently being sent an email. Try again after those sends finish.');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
        const pending=await tx.campaignRecipient.findMany({where:{tenantId:u.tenantId,contactId:{in:ids},quotaReserved:true,status:{in:['PENDING','QUEUED']}},select:{id:true,campaignId:true,quotaDate:true}});
        if(pending.length){const changed=await tx.campaignRecipient.updateMany({where:{id:{in:pending.map(r=>r.id)},quotaReserved:true,status:{in:['PENDING','QUEUED']}},data:{status:'SUPPRESSED',quotaReserved:false}});const byDay=new Map<string,{date:Date;count:number}>();for(const row of pending){const date=row.quotaDate;const key=date.toISOString().slice(0,10);const entry=byDay.get(key)??{date,count:0};entry.count++;byDay.set(key,entry);}let remaining=changed.count;for(const entry of byDay.values()){const amount=Math.min(entry.count,remaining);if(amount<=0)continue;remaining-=amount;await tx.dailyUsage.updateMany({where:{tenantId:u.tenantId,usageDate:entry.date},data:{reservedCount:{decrement:amount}}});await tx.platformDailyUsage.updateMany({where:{usageDate:entry.date},data:{reservedCount:{decrement:amount}}});}}
        for(const campaignId of new Set(pending.map(row=>row.campaignId))){const active=await tx.campaignRecipient.count({where:{tenantId:u.tenantId,campaignId,status:{in:['PENDING','QUEUED','SENDING']}}});if(active===0){const accepted=await tx.campaignRecipient.count({where:{tenantId:u.tenantId,campaignId,sentAt:{not:null}}});await tx.campaign.updateMany({where:{id:campaignId,tenantId:u.tenantId,status:{in:['SCHEDULED','QUEUED','SENDING']}},data:{status:accepted?'COMPLETED':'FAILED',completedAt:new Date()}});}}
        await tx.listContact.deleteMany({where:{tenantId:u.tenantId,contactId:{in:ids}}});
        for(const contact of contacts){const redacted=`deleted+${contact.id}@redacted.repus.invalid`;await tx.contact.update({where:{id:contact.id},data:{email:redacted,normalizedEmail:redacted,firstName:null,lastName:null,status:'UNSUBSCRIBED',consentSource:null,consentAt:null,customFields:{},deletedAt:new Date()}});}
        await tx.auditLog.create({data:{tenantId:u.tenantId,userId:u.id,action:'contacts.bulk_delete',entityType:'contact',metadata:{count:contacts.length,retainedCampaignHistory:true}}});return contacts.length;
      });
      return {action:dto.action,affectedCount:count};
    }
    throw new BadRequestException('Choose a supported bulk action.');
  }
  async update(req:Request,id:string,dto:UpdateContactDto){
    const u=await this.actor(req);if(u.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');
    const c=await prisma.contact.findFirst({where:{id,tenantId:u.tenantId,deletedAt:null}});if(!c)throw new NotFoundException('Contact not found.');
    const email=dto.email?.trim().toLowerCase(),emailChanged=!!email&&email!==c.normalizedEmail;
    let consentAt:Date|undefined;
    if(emailChanged){
      consentAt=dto.consentAt?new Date(dto.consentAt):undefined;
      if(!dto.consentConfirmed||!dto.consentSource?.trim()||!consentAt||Number.isNaN(consentAt.getTime())||consentAt>new Date())throw new BadRequestException('Confirm documented permission for this email address and provide when and how it was collected.');
    }
    const definitions=await prisma.customFieldDefinition.findMany({where:{tenantId:u.tenantId,archived:false}});
    const current=c.customFields&&typeof c.customFields==='object'&&!Array.isArray(c.customFields)?c.customFields as Record<string,unknown>:{};
    const allowed=new Set(definitions.map(field=>field.key));
    if(Object.keys(dto.customFields??{}).some(key=>!allowed.has(key)))throw new BadRequestException('One or more custom fields are not defined for this workspace.');
    for(const field of definitions){if(!Object.prototype.hasOwnProperty.call(dto.customFields??{},field.key))continue;const value=dto.customFields![field.key];if(value===undefined||value===null||value==='')continue;if(!isValidCustomFieldValue(field.type,value))throw new BadRequestException(`${field.label} has an invalid value.`);}
    const customFields=dto.company===undefined&&dto.customFields===undefined?undefined:{...current,...(dto.company===undefined?{}:{company:dto.company}),...(dto.customFields??{})};
    try{const result=await prisma.$transaction(async tx=>{
      if(emailChanged){
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.tenantId}, 0))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
        const latest=await tx.contact.findFirst({where:{id,tenantId:u.tenantId,deletedAt:null},select:{normalizedEmail:true}});
        if(!latest)throw new NotFoundException('Contact not found.');
        if(latest.normalizedEmail!==c.normalizedEmail)throw new ConflictException('This contact changed while you were editing it. Refresh and try again.');
        const [suppressed,duplicate,tenant]=await Promise.all([
          tx.suppression.findUnique({where:{tenantId_normalizedEmail:{tenantId:u.tenantId,normalizedEmail:email!}},select:{id:true}}),
          tx.contact.findFirst({where:{tenantId:u.tenantId,normalizedEmail:email,id:{not:id}},select:{id:true}}),
          tx.tenant.findUnique({where:{id:u.tenantId},select:{doubleOptInEnabled:true}}),
        ]);
        if(suppressed)throw new ForbiddenException('This address is suppressed and cannot be added.');
        if(duplicate)throw new ConflictException('A contact with this email address already exists in this workspace.');
        const pending=!!tenant?.doubleOptInEnabled;
        const recipients=await tx.campaignRecipient.findMany({where:{tenantId:u.tenantId,contactId:id,status:{in:['PENDING','QUEUED','SENDING']}},select:{id:true,campaignId:true,status:true,quotaReserved:true,quotaDate:true}});
        const queued=recipients.filter(row=>row.status==='PENDING'||row.status==='QUEUED');
        if(queued.length){
          await tx.campaignRecipient.updateMany({where:{id:{in:queued.map(row=>row.id)},status:{in:['PENDING','QUEUED']}},data:{status:'SUPPRESSED',quotaReserved:false}});
          const reserved=queued.filter(row=>row.quotaReserved),byDay=new Map<string,{date:Date;count:number}>();
          for(const row of reserved){const date=row.quotaDate;const key=date.toISOString().slice(0,10);const entry=byDay.get(key)??{date,count:0};entry.count++;byDay.set(key,entry);}
          for(const entry of byDay.values()){await tx.dailyUsage.updateMany({where:{tenantId:u.tenantId,usageDate:entry.date},data:{reservedCount:{decrement:entry.count}}});await tx.platformDailyUsage.updateMany({where:{usageDate:entry.date},data:{reservedCount:{decrement:entry.count}}});}
          for(const campaignId of new Set(queued.map(row=>row.campaignId))){const active=await tx.campaignRecipient.count({where:{tenantId:u.tenantId,campaignId,status:{in:['PENDING','QUEUED','SENDING']}}});if(active===0){const accepted=await tx.campaignRecipient.count({where:{tenantId:u.tenantId,campaignId,sentAt:{not:null}}});await tx.campaign.updateMany({where:{id:campaignId,tenantId:u.tenantId,status:{in:['SCHEDULED','QUEUED','SENDING']}},data:{status:accepted?'COMPLETED':'FAILED',completedAt:new Date()}});}}
        }
        if(pending)await tx.contactConfirmationToken.updateMany({where:{tenantId:u.tenantId,contactId:id,confirmedAt:null,expiresAt:{gt:new Date()}},data:{expiresAt:new Date()}});
        const updated=await tx.contact.update({where:{id},data:{firstName:dto.firstName?.trim(),lastName:dto.lastName?.trim(),email,normalizedEmail:email,status:pending?'PENDING_CONFIRMATION':'SUBSCRIBED',consentSource:dto.consentSource!.trim(),consentAt,customFields:customFields as any}});
        if(pending)await createContactConfirmation(tx,u.tenantId,id);
        return {contact:updated,confirmationRequired:pending,inFlightRecipientIds:recipients.filter(row=>row.status==='SENDING').map(row=>row.id)};
      }
      return {contact:await tx.contact.update({where:{id},data:{firstName:dto.firstName?.trim(),lastName:dto.lastName?.trim(),customFields:customFields as any}}),confirmationRequired:false,inFlightRecipientIds:[] as string[]};
    });
    if(result.inFlightRecipientIds.length)await Promise.all(result.inFlightRecipientIds.map(recipientId=>publishSendInterrupt({scope:'recipient',recipientId})));
    return {...result.contact,...(emailChanged?{confirmationRequired:result.confirmationRequired}:{})};
    }catch(error){if(emailChanged&&error&&typeof error==='object'&&'code'in error&&error.code==='P2002')throw new ConflictException('A contact with this email address already exists in this workspace.');throw error;}
  }
  async resendConfirmation(req:Request,id:string){
    const user=await this.actor(req);if(user.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');
    return prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId}, 0))`;
      const contact=await tx.contact.findFirst({where:{id,tenantId:user.tenantId,deletedAt:null},select:{id:true,status:true,consentAt:true,consentSource:true}});
      if(!contact)throw new NotFoundException('Contact not found.');
      if(contact.status!=='PENDING_CONFIRMATION'||!contact.consentAt||!contact.consentSource)throw new BadRequestException('Only a contact awaiting confirmation with recorded permission can receive a new confirmation link.');
      const now=new Date();
      const invalidated=await tx.contactConfirmationToken.updateMany({where:{tenantId:user.tenantId,contactId:id,confirmedAt:null,expiresAt:{gt:now}},data:{expiresAt:now}});
      await createContactConfirmation(tx,user.tenantId,id);
      await tx.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'contact.double_opt_in.resent',entityType:'contact',entityId:id,metadata:{invalidatedTokens:invalidated.count}}});
      return {confirmationRequired:true};
    });
  }
  async reactivate(req:Request,id:string,dto:ReactivateContactDto){
    const user=await this.actor(req);if(user.role==='VIEWER')throw new ForbiddenException('You have read-only access to this workspace.');
    const source=dto.consentSource.trim(),consentAt=new Date(dto.consentAt);
    if(!dto.consentConfirmed||!source||source.includes(String.fromCharCode(0))||Number.isNaN(consentAt.getTime())||consentAt>new Date())throw new BadRequestException('Confirm fresh documented permission and provide when and how it was collected.');
    return prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(19302831)`;
      const contact=await tx.contact.findFirst({where:{id,tenantId:user.tenantId,deletedAt:null},select:{id:true,normalizedEmail:true,status:true}});
      if(!contact)throw new NotFoundException('Contact not found.');
      if(contact.status!=='UNSUBSCRIBED')throw new BadRequestException('Only unsubscribed contacts can use the fresh-permission reactivation flow.');
      const suppression=await tx.suppression.findUnique({where:{tenantId_normalizedEmail:{tenantId:user.tenantId,normalizedEmail:contact.normalizedEmail}},select:{id:true,reason:true}});
      if(suppression&&suppression.reason!=='unsubscribe')throw new ForbiddenException('This address has a bounce or complaint suppression and cannot be reactivated.');
      const tenant=await tx.tenant.findUnique({where:{id:user.tenantId},select:{doubleOptInEnabled:true}});
      const pending=!!tenant?.doubleOptInEnabled;
      const updated=await tx.contact.update({where:{id},data:{status:pending?'PENDING_CONFIRMATION':'SUBSCRIBED',consentSource:source,consentAt}});
      if(pending){
        const now=new Date();
        await tx.contactConfirmationToken.updateMany({where:{tenantId:user.tenantId,contactId:id,confirmedAt:null,expiresAt:{gt:now}},data:{expiresAt:now}});
        await createContactConfirmation(tx,user.tenantId,id);
      }else if(suppression){
        await tx.suppression.deleteMany({where:{id:suppression.id,tenantId:user.tenantId,reason:'unsubscribe'}});
      }
      await tx.auditLog.create({data:{tenantId:user.tenantId,userId:user.id,action:'contact.reactivated_with_fresh_permission',entityType:'contact',entityId:id,metadata:{consentSource:source,permissionRecordedAt:consentAt.toISOString(),doubleOptInRequired:pending}}});
      return {...updated,confirmationRequired:pending};
    });
  }
  async remove(req:Request,id:string){const result=await this.bulk(req,{contactIds:[id],action:'delete'});return {success:true,...result};}
}

@ApiTags('contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private contacts: ContactsService) {}
  @Post('bulk') @HttpCode(200) async bulk(@Req()req:Request,@Body()dto:BulkContactsDto){return {data:await this.contacts.bulk(req,dto)}}
  @Post('bulk/export') @HttpCode(200) async exportSelected(@Req()req:Request,@Body()dto:ContactSelectionDto,@Res()response:Response){return this.contacts.exportSelected(req,dto,response)}
  @Get('export') async export(@Req()req:Request,@Query('q')q='',@Query('tag')tag='',@Res()response:Response){return this.contacts.export(req,q,tag,response);}
  @Get('tags') async tags(@Req()req:Request){return {data:await this.contacts.tags(req)}}
  @Get(':id') async get(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.contacts.get(req,id)}}
  @Post(':id/confirmation/resend') @Throttle({default:{limit:5,ttl:60*60*1000}}) async resendConfirmation(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.contacts.resendConfirmation(req,id)}}
  @Post(':id/reactivate') @Throttle({default:{limit:5,ttl:60*60*1000}}) async reactivate(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string,@Body()dto:ReactivateContactDto){return {data:await this.contacts.reactivate(req,id,dto)}}
  @Get() async list(@Req() req: Request, @Query('page') rawPage?: string, @Query('q') q = '',@Query('tag')tag='') { const page = Math.max(1, Number(rawPage) || 1); return { data: await this.contacts.list(req, page, q.slice(0, 150),tag.slice(0,32)) }; }
  @Post() async create(@Req() req: Request, @Body() dto: CreateContactDto) { return { data: await this.contacts.create(req, dto) }; }
  @Patch(':id') async update(@Req() req: Request, @Param('id',ParseUUIDPipe) id:string,@Body() dto:UpdateContactDto){return {data:await this.contacts.update(req,id,dto)};}
  @Delete(':id') async remove(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string){return {data:await this.contacts.remove(req,id)};}
}

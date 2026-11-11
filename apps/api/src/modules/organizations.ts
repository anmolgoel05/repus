import {Body,Controller,Get,Patch,Req,Injectable,ForbiddenException,NotFoundException,Post,Param,UnauthorizedException,ConflictException,Delete,ParseUUIDPipe,BadRequestException} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {IsBoolean,IsEmail,IsIn,IsOptional,IsString,MaxLength,MinLength} from 'class-validator';
import {Request} from 'express';
import {prisma,withAuthUserEmail,withOneTimeToken,withOrganizationCreation} from '@repus/database';
import {AuthService} from './auth';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import * as argon2 from 'argon2';
import {encryptToken} from '@repus/token-security';
import {defaultTenantLimits} from './tenant-default-limits';
class UpdateOrganizationDto{@IsOptional() @IsString() @MaxLength(160) name?:string;@IsOptional() @IsString() @MaxLength(80) timezone?:string;@IsOptional() @IsBoolean() doubleOptInEnabled?:boolean;}
class CreateOrganizationDto{@IsString() @MinLength(2) @MaxLength(160) name!:string;@IsOptional() @IsString() @MaxLength(80) timezone?:string;}
class InviteMemberDto{@IsEmail() email!:string;@IsString() @MaxLength(120) name!:string;@IsIn(['ADMIN','MARKETER','VIEWER']) role!:string;}
class AcceptInvitationDto{@IsString() @MinLength(30) token!:string;@IsOptional() @IsString() @MinLength(12) password?:string;}
class UpdateMemberRoleDto{@IsIn(['ADMIN','MARKETER','VIEWER']) role!:string;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
@Injectable() export class OrganizationsService{
 constructor(private auth:AuthService){}
 async list(req:Request){const u=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);const memberships=await prisma.organizationMembership.findMany({where:{userId:u.id,status:'ACTIVE'},orderBy:{createdAt:'asc'}});const organizations=[];for(const membership of memberships){await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${membership.tenantId}, true)`;const tenant=await prisma.tenant.findUnique({where:{id:membership.tenantId},select:{id:true,name:true,timezone:true,status:true}});if(tenant)organizations.push({...tenant,role:membership.role});}return organizations;}
 async create(req:Request,d:CreateOrganizationDto){
  if(!req.cookies?.repus_session)throw new ForbiddenException('Sign in with a workspace account to create a workspace.');
  const actor=await this.auth.authenticate(req.cookies.repus_session as string);
  const timezone=d.timezone??'Asia/Kolkata';try{new Intl.DateTimeFormat('en-US',{timeZone:timezone})}catch{throw new BadRequestException('Choose a valid timezone.');}
  const base=d.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'workspace';
  const tenantId=randomUUID();
  const limits=await defaultTenantLimits();
  return withOrganizationCreation(tenantId,async()=>{
   const tenant=await prisma.tenant.create({data:{id:tenantId,name:d.name.trim(),slug:`${base}-${randomBytes(3).toString('hex')}`,timezone}});
   await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
   await prisma.organizationMembership.create({data:{tenantId:tenant.id,userId:actor.id,role:'OWNER',status:'ACTIVE'}});
   await prisma.tenantSendingLimit.create({data:{tenantId:tenant.id,...limits}});
   await prisma.auditLog.create({data:{tenantId:tenant.id,userId:actor.id,action:'organization.created',entityType:'tenant',entityId:tenant.id,metadata:{name:tenant.name}}});
   return {id:tenant.id,name:tenant.name,slug:tenant.slug,timezone:tenant.timezone,role:'OWNER'};
  });
 }
 private async deliverInvitation(email:string,name:string,role:string,organization:string,rawToken:string){
  const link=`${new URL('/accept-invitation',process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000')}?token=${encodeURIComponent(rawToken)}`;
  if(process.env.NODE_ENV==='production'&&process.env.EMAIL_PROVIDER!=='ses')throw new Error('Configure SES before inviting production workspace members.');
  if(process.env.EMAIL_PROVIDER!=='ses')console.info('[development account email: invite_member] queued; recipient and capability omitted.');
  return link;
 }
 async current(req:Request){const u=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);const [org,user]=await Promise.all([prisma.tenant.findUnique({where:{id:u.tenantId},include:{sendingLimit:true}}),prisma.user.findUnique({where:{id:u.id},select:{id:true,name:true,email:true,emailVerifiedAt:true}})]);if(!org||!user)throw new NotFoundException('Workspace not found.');return {organization:org,user:{...user,role:u.role}};}
 async update(req:Request,d:UpdateOrganizationDto){const u=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(u.role))throw new ForbiddenException('Only workspace owners and admins can update settings.');if(d.doubleOptInEnabled&&(process.env.SESSION_SECRET?.length??0)<32)throw new ForbiddenException('Configure a 32-character session secret before enabling double opt-in.');if(d.timezone){try{new Intl.DateTimeFormat('en-US',{timeZone:d.timezone})}catch{throw new ForbiddenException('Choose a valid timezone.') }}const org=await prisma.tenant.update({where:{id:u.tenantId},data:{name:d.name?.trim(),timezone:d.timezone,doubleOptInEnabled:d.doubleOptInEnabled}});await prisma.auditLog.create({data:{tenantId:u.tenantId,userId:u.id,action:'organization.updated',entityType:'tenant',entityId:org.id,metadata:{fields:Object.keys(d)}}});return org;}
 async members(req:Request){const u=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);const memberships=await prisma.organizationMembership.findMany({where:{tenantId:u.tenantId},include:{user:{select:{id:true,name:true,email:true,status:true,emailVerifiedAt:true,createdAt:true}}},orderBy:{createdAt:'asc'}});return memberships.map(({user,role,status})=>({...user,role,status}));}
 async invite(req:Request,d:InviteMemberDto){
  const actor=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(actor.role))throw new ForbiddenException('Only owners and admins can invite workspace members.');
  if(actor.role==='ADMIN'&&d.role==='ADMIN')throw new ForbiddenException('Admins can invite marketers and viewers; only the owner can invite another admin.');
  const email=d.email.trim().toLowerCase();const existing=await withAuthUserEmail(email,()=>prisma.user.findUnique({where:{normalizedEmail:email}}));
  if(existing?.status==='DISABLED')throw new ConflictException('This account is disabled and cannot be invited.');
  const membership=existing?await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:actor.tenantId,userId:existing.id}}}):null;
  if(membership&&membership.status!=='DISABLED')throw new ConflictException('This person already has workspace access or a pending invitation.');
  const passwordHash=existing?undefined:await argon2.hash(randomBytes(32).toString('base64url'),{type:argon2.argon2id});
  const result=await prisma.$transaction(async tx=>{
   const user=existing??await tx.user.create({data:{tenantId:actor.tenantId,name:d.name.trim(),email,normalizedEmail:email,passwordHash:passwordHash!,role:d.role as any,status:'PENDING'}});
   if(membership)await tx.organizationMembership.update({where:{tenantId_userId:{tenantId:actor.tenantId,userId:user.id}},data:{role:d.role as any,status:'PENDING'}});
   else await tx.organizationMembership.create({data:{tenantId:actor.tenantId,userId:user.id,role:d.role as any,status:'PENDING'}});
   const raw=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+7*24*60*60*1000);
   if(user.tenantId!==actor.tenantId)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, true)`;
   await tx.oneTimeToken.create({data:{tenantId:actor.tenantId,userId:user.id,tokenHash:hash(raw),tokenEncrypted:encryptToken(raw,process.env.SESSION_SECRET??''),purpose:'invite_member',expiresAt}});
   if(user.tenantId!==actor.tenantId)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${actor.tenantId}, true)`;
   return {user,raw,expiresAt};
  });
  const link=await this.deliverInvitation(email,d.name.trim(),d.role,actor.organization,result.raw);
  await prisma.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'organization.member_invited',entityType:'user',entityId:result.user.id,metadata:{email,role:d.role}}});
  return {id:result.user.id,email:result.user.email,role:d.role,status:'PENDING',...(process.env.NODE_ENV==='development'?{developmentInvitationUrl:link}:{})};
 }
 async resendInvitation(req:Request,id:string){
  const actor=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(actor.role))throw new ForbiddenException('Only owners and admins can resend invitations.');
  const target=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:actor.tenantId,userId:id}},include:{user:true}});if(!target)throw new NotFoundException('Workspace member not found.');
  if(target.role==='OWNER'||(actor.role==='ADMIN'&&target.role==='ADMIN'))throw new ForbiddenException('You cannot resend this member invitation.');
  if(!['PENDING','DISABLED'].includes(target.status))throw new ConflictException('Only a pending or revoked workspace invitation can be resent.');
  const raw=randomBytes(32).toString('base64url'),tokenHash=hash(raw),expiresAt=new Date(Date.now()+7*24*60*60*1000);
  await prisma.$transaction(async tx=>{
   if(target.user.tenantId!==actor.tenantId)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${target.user.tenantId}, true)`;
   await tx.oneTimeToken.updateMany({where:{tenantId:actor.tenantId,userId:id,purpose:'invite_member',usedAt:null},data:{usedAt:new Date()}});
   await tx.oneTimeToken.create({data:{tenantId:actor.tenantId,userId:id,tokenHash,tokenEncrypted:encryptToken(raw,process.env.SESSION_SECRET??''),purpose:'invite_member',expiresAt}});
   if(target.user.tenantId!==actor.tenantId)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${actor.tenantId}, true)`;
   const claimed=await tx.organizationMembership.updateMany({where:{tenantId:actor.tenantId,userId:id,role:target.role,status:target.status},data:{status:'PENDING'}});
   if(!claimed.count)throw new ConflictException('This member invitation changed. Refresh and try again.');
   await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'organization.invitation_resent',entityType:'user',entityId:id,metadata:{email:target.user.email,role:target.role,expiresAt}}});
  });
  const link=await this.deliverInvitation(target.user.email,target.user.name,target.role,actor.organization,raw);
  return {success:true,status:'PENDING',...(process.env.NODE_ENV==='development'?{developmentInvitationUrl:link}:{})};
 }
 async restoreMember(req:Request,id:string){const actor=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(actor.role))throw new ForbiddenException('Only owners and admins can restore workspace members.');const target=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:actor.tenantId,userId:id}},include:{user:true}});if(!target)throw new NotFoundException('Workspace member not found.');if(target.role==='OWNER'||(actor.role==='ADMIN'&&target.role==='ADMIN'))throw new ForbiddenException('You cannot restore this member.');if(target.status!=='DISABLED'||target.user.status!=='ACTIVE'||!target.user.emailVerifiedAt)throw new ConflictException('Only a previously verified, revoked member can be restored.');return prisma.$transaction(async tx=>{const restored=await tx.organizationMembership.updateMany({where:{tenantId:actor.tenantId,userId:id,role:target.role,status:'DISABLED'},data:{status:'ACTIVE'}});if(!restored.count)throw new ConflictException('This member access changed. Refresh and try again.');await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'organization.member_access_restored',entityType:'user',entityId:id,metadata:{email:target.user.email,role:target.role}}});return {success:true,status:'ACTIVE'};});}
 async acceptInvitation(d:AcceptInvitationDto){
  return withOneTimeToken(hash(d.token),async()=>{
   const token=await prisma.oneTimeToken.findUnique({where:{tokenHash:hash(d.token)}});
   if(!token||token.purpose!=='invite_member'||token.usedAt||token.expiresAt<new Date())throw new UnauthorizedException('This invitation has expired or was already used.');
   const account=await prisma.user.findUnique({where:{id:token.userId},select:{status:true,tenantId:true}});
   if(!account||account.status==='DISABLED')throw new UnauthorizedException('This invitation is no longer available.');
   if(account.status==='PENDING'&&!d.password)throw new BadRequestException('Choose a password to finish setting up your Repus account.');
   const passwordHash=account.status==='PENDING'?await argon2.hash(d.password!,{type:argon2.argon2id}):undefined;
   await prisma.$transaction(async tx=>{
    const invitationTenant=token.tenantId;
    // Account capabilities are writable only within their account owner's home scope.
    if(account.tenantId!==invitationTenant)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${account.tenantId}, true)`;
    const consumed=await tx.oneTimeToken.updateMany({where:{id:token.id,purpose:'invite_member',usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
    if(!consumed.count)throw new UnauthorizedException('This invitation has expired or was already used.');
    if(passwordHash){
     await tx.user.update({where:{id:token.userId},data:{passwordHash,status:'ACTIVE',emailVerifiedAt:new Date()}});
     if(account.tenantId!==invitationTenant)await tx.organizationMembership.updateMany({where:{tenantId:account.tenantId,userId:token.userId,status:'PENDING',role:'OWNER'},data:{status:'ACTIVE'}});
    }
    if(account.tenantId!==invitationTenant)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${invitationTenant}, true)`;
    const activated=await tx.organizationMembership.updateMany({where:{tenantId:invitationTenant,userId:token.userId,status:'PENDING'},data:{status:'ACTIVE'}});
    if(!activated.count)throw new UnauthorizedException('This workspace invitation is no longer available.');
   });
   return {success:true};
  });
 }
 async updateMemberRole(req:Request,id:string,d:UpdateMemberRoleDto){const actor=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(actor.role))throw new ForbiddenException('Only owners and admins can manage member roles.');const target=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:actor.tenantId,userId:id}},include:{user:true}});if(!target)throw new NotFoundException('Workspace member not found.');if(target.role==='OWNER')throw new ForbiddenException('The workspace owner role cannot be changed.');if(actor.role==='ADMIN'&&target.role==='ADMIN'&&id!==actor.id)throw new ForbiddenException('Admins cannot change another admin\'s role.');if(actor.role==='ADMIN'&&d.role==='ADMIN'&&id!==actor.id)throw new ForbiddenException('Admins cannot promote other members to admin.');await prisma.$transaction(async tx=>{const changed=await tx.organizationMembership.updateMany({where:{tenantId:actor.tenantId,userId:id,role:target.role,status:target.status},data:{role:d.role as any}});if(!changed.count)throw new ConflictException('This member changed while you were editing. Refresh the member list and try again.');await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'organization.member_role_updated',entityType:'user',entityId:id,metadata:{from:target.role,to:d.role}}});});return {id,email:target.user.email,role:d.role,status:target.status};}
 async removeMember(req:Request,id:string){const actor=await this.auth.authenticate(req.cookies?.repus_session as string|undefined);if(!['OWNER','ADMIN'].includes(actor.role))throw new ForbiddenException('Only owners and admins can remove workspace members.');if(actor.id===id)throw new ForbiddenException('You cannot remove your own account.');const target=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:actor.tenantId,userId:id}},include:{user:true}});if(!target)throw new NotFoundException('Workspace member not found.');if(target.role==='OWNER')throw new ForbiddenException('The workspace owner cannot be removed.');if(actor.role==='ADMIN'&&target.role==='ADMIN')throw new ForbiddenException('Only the workspace owner can remove an admin.');await prisma.$transaction(async tx=>{const changed=await tx.organizationMembership.updateMany({where:{tenantId:actor.tenantId,userId:id,role:target.role,status:target.status},data:{status:'DISABLED'}});if(!changed.count)throw new ConflictException('This member changed while you were editing. Refresh the member list and try again.');await tx.session.deleteMany({where:{userId:id,tenantId:actor.tenantId}});if(target.user.tenantId!==actor.tenantId)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${target.user.tenantId}, true)`;await tx.oneTimeToken.updateMany({where:{tenantId:actor.tenantId,userId:id,purpose:'invite_member',usedAt:null},data:{usedAt:new Date()}});if(target.user.tenantId!==actor.tenantId)await tx.$executeRaw`SELECT set_config('app.tenant_id', ${actor.tenantId}, true)`;const revokedKeys=await tx.apiKey.updateMany({where:{tenantId:actor.tenantId,createdByUserId:id,revokedAt:null},data:{revokedAt:new Date()}});await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'organization.member_access_revoked',entityType:'user',entityId:id,metadata:{email:target.user.email,role:target.role,status:target.status,apiKeysRevoked:revokedKeys.count}}});});return {success:true,status:'DISABLED'};}
}
@ApiTags('organizations') @Controller('organizations') export class OrganizationsController{
 constructor(private service:OrganizationsService){}
 @Get() async list(@Req()r:Request){return {data:await this.service.list(r)}}
 @Post() async create(@Req()r:Request,@Body()d:CreateOrganizationDto){return {data:await this.service.create(r,d)}}
 @Get('current') async current(@Req()r:Request){return {data:await this.service.current(r)}}
 @Patch('current') async update(@Req()r:Request,@Body()d:UpdateOrganizationDto){return {data:await this.service.update(r,d)}}
 @Get('members') async members(@Req()r:Request){return {data:await this.service.members(r)}}
 @Post('invite') async invite(@Req()r:Request,@Body()d:InviteMemberDto){return {data:await this.service.invite(r,d)}}
 @Post('members/:id/invitation') async resendInvitation(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.resendInvitation(r,id)}}
 @Post('members/:id/restore') async restoreMember(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.restoreMember(r,id)}}
 @Patch('members/:id/role') async updateMemberRole(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string,@Body()d:UpdateMemberRoleDto){return {data:await this.service.updateMemberRole(r,id,d)}}
 @Delete('members/:id') async removeMember(@Req()r:Request,@Param('id',ParseUUIDPipe)id:string){return {data:await this.service.removeMember(r,id)}}
 @Post('invitations/accept') async accept(@Body()d:AcceptInvitationDto){return {data:await this.service.acceptInvitation(d)}}
}


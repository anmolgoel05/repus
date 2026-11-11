import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException, ConflictException, BadRequestException, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import * as argon2 from 'argon2';
import { prisma,withAuthUserEmail,withOneTimeToken,withSessionToken,withOrganizationCreation } from '@repus/database';
import {encryptToken} from '@repus/token-security';
import {defaultTenantLimits} from './tenant-default-limits';
import {Throttle} from '@nestjs/throttler';
import {setSensitiveResponseHeaders} from './sensitive-response.js';

export const AUTH_RATE_LIMITS={register:{limit:5,ttl:60_000},login:{limit:5,ttl:60_000},passwordResetRequest:{limit:3,ttl:60_000},verificationResend:{limit:3,ttl:60_000}} as const;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const isPlatformAdminEmail = (email:string) => (process.env.PLATFORM_ADMIN_EMAILS??'').split(',').map(normalizeEmail).filter(Boolean).includes(normalizeEmail(email));

class RegisterDto {
  @IsString() @MinLength(2) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) password!: string;
  @IsString() @MinLength(2) organizationName!: string;
}
class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(1) password!: string; }
class TokenDto { @IsString() @MinLength(30) token!: string; }
class ResetRequestDto { @IsEmail() email!: string; }
class VerificationResendDto { @IsEmail() email!: string; }
class ResetPasswordDto { @IsString() @MinLength(30) token!: string; @IsString() @MinLength(12) password!: string; }
class WorkspaceSwitchDto { @IsUUID('4') tenantId!:string; }
class UpdateProfileDto { @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S/) name!:string; }

@Injectable()
export class AuthService {
  private async deliverOneTimeLink(email:string, name:string, purpose:string, url:string, token:string) {
    const link = `${new URL(url,process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')}?token=${encodeURIComponent(token)}`;
    if(process.env.NODE_ENV==='production'&&process.env.EMAIL_PROVIDER!=='ses')throw new Error('Configure SES before enabling production account emails.');
    if(process.env.EMAIL_PROVIDER!=='ses')console.info(`[development account email: ${purpose}] queued; recipient and capability omitted.`);
    return process.env.NODE_ENV==='development'?link:undefined;
  }
  private async sendOneTimeLink(email:string, name:string, purpose:string, url:string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (purpose === 'verify_email' ? 24 : 1) * 60 * 60 * 1000);
    await withAuthUserEmail(email,async()=>{const user=await prisma.user.findUniqueOrThrow({where:{normalizedEmail:email},select:{id:true,tenantId:true}});return prisma.oneTimeToken.create({data:{tenantId:user.tenantId,userId:user.id,tokenHash:hashToken(token),tokenEncrypted:encryptToken(token,process.env.SESSION_SECRET??''),purpose,expiresAt}});});
    return this.deliverOneTimeLink(email,name,purpose,url,token);
  }
  async register(input: RegisterDto) {
    const limits=await defaultTenantLimits();
    const email = normalizeEmail(input.email);
    const tenant = await withAuthUserEmail(email,async()=>{
      const exists = await prisma.user.findUnique({ where: { normalizedEmail: email } });
      if (exists) throw new ConflictException('An account with this email already exists.');
      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const base = input.organizationName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'workspace';
      const tenantId=randomUUID();
      return withOrganizationCreation(tenantId,()=>prisma.$transaction(async (tx) => {
        const slug = `${base}-${randomBytes(3).toString('hex')}`;
        const org = await tx.tenant.create({ data: { id:tenantId,name: input.organizationName.trim(), slug } });
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${org.id}, true)`;
        const user=await tx.user.create({ data: { tenantId: org.id, name: input.name.trim(), email, normalizedEmail: email, passwordHash, status: 'PENDING' } });
        await tx.organizationMembership.create({data:{tenantId:org.id,userId:user.id,role:'OWNER',status:'PENDING'}});
        await tx.tenantSendingLimit.create({ data: { tenantId: org.id,...limits } });
        return org;
      }));
    });
    const verificationUrl = await this.sendOneTimeLink(email, input.name.trim(), 'verify_email', '/verify-email');
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, ...(verificationUrl ? { developmentVerificationUrl: verificationUrl } : {}) };
  }

  async verifyEmail(rawToken:string) {
    return withOneTimeToken(hashToken(rawToken),async()=>{
      const token=await prisma.oneTimeToken.findUnique({where:{tokenHash:hashToken(rawToken)}});
      if(!token||token.purpose!=='verify_email'||token.usedAt||token.expiresAt<new Date())throw new UnauthorizedException('This verification link has expired or was already used.');
      await prisma.$transaction(async tx=>{
        const consumed=await tx.oneTimeToken.updateMany({where:{id:token.id,purpose:'verify_email',usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
        if(consumed.count!==1)throw new UnauthorizedException('This verification link has expired or was already used.');
        await tx.user.update({where:{id:token.userId},data:{status:'ACTIVE',emailVerifiedAt:new Date()}});
        const account=await tx.user.findUnique({where:{id:token.userId},select:{tenantId:true}});
        if(account)await tx.organizationMembership.updateMany({where:{tenantId:account.tenantId,userId:token.userId,status:'PENDING'},data:{status:'ACTIVE'}});
      });
      return {success:true};
    });
  }
  async resendVerification(emailInput:string) {
    const email=normalizeEmail(emailInput);
    const issued=await withAuthUserEmail(email,async()=>{
      const user=await prisma.user.findUnique({where:{normalizedEmail:email}});
      if(!user||user.status!=='PENDING')return undefined;
      await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;
      const now=new Date();
      await prisma.oneTimeToken.updateMany({where:{userId:user.id,purpose:'verify_email',usedAt:null},data:{usedAt:now}});
      const token=randomBytes(32).toString('base64url');
      await prisma.oneTimeToken.create({data:{tenantId:user.tenantId,userId:user.id,tokenHash:hashToken(token),tokenEncrypted:encryptToken(token,process.env.SESSION_SECRET??''),purpose:'verify_email',expiresAt:new Date(now.getTime()+24*60*60*1000)}});
      return {name:user.name,token};
    });
    if(!issued)return {success:true};
    try {
      const developmentVerificationUrl=await this.deliverOneTimeLink(email,issued.name,'verify_email','/verify-email',issued.token);
      return {success:true,...(developmentVerificationUrl?{developmentVerificationUrl}:{})};
    } catch {
      console.error('Account verification email delivery failed.');
      return {success:true};
    }
  }
  async requestPasswordReset(emailInput:string) {
    const email=normalizeEmail(emailInput);const user=await withAuthUserEmail(email,()=>prisma.user.findUnique({where:{normalizedEmail:email}}));
    let developmentResetUrl:string|undefined;
    if(user&&user.status==='ACTIVE')developmentResetUrl=await this.sendOneTimeLink(email,user.name,'reset_password','/reset-password');
    else if(process.env.NODE_ENV==='development')developmentResetUrl=`${new URL('/reset-password',process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000')}?token=${randomBytes(32).toString('base64url')}`;
    return {success:true,...(developmentResetUrl?{developmentResetUrl}:{})};
  }
  async resetPassword(rawToken:string,password:string) {
    return withOneTimeToken(hashToken(rawToken),async()=>{
      const token=await prisma.oneTimeToken.findUnique({where:{tokenHash:hashToken(rawToken)}});
      if(!token||token.purpose!=='reset_password'||token.usedAt||token.expiresAt<new Date())throw new UnauthorizedException('This password reset link has expired or was already used.');
      const passwordHash=await argon2.hash(password,{type:argon2.argon2id});
      await prisma.$transaction(async tx=>{
        const consumed=await tx.oneTimeToken.updateMany({where:{id:token.id,purpose:'reset_password',usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
        if(consumed.count!==1)throw new UnauthorizedException('This password reset link has expired or was already used.');
        await tx.user.update({where:{id:token.userId},data:{passwordHash}});
        await tx.session.deleteMany({where:{userId:token.userId}});
      });
      return {success:true};
    });
  }

  async login(emailInput: string, password: string) {
    const email=normalizeEmail(emailInput);return withAuthUserEmail(email,async()=>{
      const user = await prisma.user.findUnique({ where: { normalizedEmail: email } });
      if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, password))) throw new UnauthorizedException('Email or password is incorrect.');
      const membership=await prisma.organizationMembership.findFirst({where:{userId:user.id,status:'ACTIVE'},orderBy:{createdAt:'asc'}});
      if(!membership)throw new UnauthorizedException('This account has no active workspace. Contact a workspace administrator.');
      await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${membership.tenantId}, true)`;
      const organization=await prisma.tenant.findUniqueOrThrow({where:{id:membership.tenantId}});
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      await prisma.session.create({ data: { userId: user.id, tenantId:membership.tenantId, tokenHash: hashToken(token), expiresAt } });
      return { token, expiresAt, user: { id: user.id, name: user.name, email: user.email, role: membership.role }, organization: { id: organization.id, name: organization.name } };
    });
  }

  async refresh(rawToken?: string) {
    if (!rawToken || rawToken.startsWith('rps_live_')) throw new UnauthorizedException('Please sign in to continue.');
    return withSessionToken(hashToken(rawToken), async () => {
      const tokenHash = hashToken(rawToken);
      const now = new Date();
      const session = await prisma.session.findUnique({ where: { tokenHash }, select: { id: true, userId: true, tenantId:true, expiresAt: true } });
      if (!session || session.expiresAt <= now) throw new UnauthorizedException('Your session has expired. Please sign in again.');
      const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { status: true } });
      if (user?.status !== 'ACTIVE') throw new UnauthorizedException('Your session has expired. Please sign in again.');
      const membership=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:session.tenantId,userId:session.userId}},select:{status:true}});
      if(membership?.status!=='ACTIVE')throw new UnauthorizedException('Your workspace access has changed. Please sign in again.');
      const nextToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);
      const rotated = await prisma.session.updateMany({ where: { id: session.id, tokenHash, expiresAt: { gt: now } }, data: { tokenHash: hashToken(nextToken), expiresAt } });
      if (rotated.count !== 1) throw new UnauthorizedException('Your session changed. Please sign in again.');
      return { token: nextToken, expiresAt };
    });
  }

  async authenticate(token?: string) {
    if (!token) throw new UnauthorizedException('Please sign in to continue.');
    if(token.startsWith('rps_live_')){
      const key=await prisma.apiKey.findUnique({where:{keyHash:hashToken(token)},include:{tenant:true,createdBy:{select:{name:true,email:true}}}});
      if(!key||key.revokedAt||(key.expiresAt&&key.expiresAt<=new Date()))throw new UnauthorizedException('This API key is invalid, expired, or revoked.');
      return {id:key.createdByUserId,name:key.name||key.createdBy.name,email:key.createdBy.email,role:key.role,tenantId:key.tenantId,organization:key.tenant.name,platformAdmin:false};
    }
    return withSessionToken(hashToken(token),async()=>{
      const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
      if (!session || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') throw new UnauthorizedException('Your session has expired. Please sign in again.');
      const membership=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:session.tenantId,userId:session.userId}}});
      if(!membership||membership.status!=='ACTIVE')throw new UnauthorizedException('Your workspace access has changed. Please sign in again.');
      const organization=await prisma.tenant.findUnique({where:{id:session.tenantId},select:{name:true}});
      if(!organization)throw new UnauthorizedException('Your workspace is no longer available. Please sign in again.');
      return { id: session.user.id, name: session.user.name, email: session.user.email, role: membership.role, tenantId: session.tenantId, organization: organization.name, platformAdmin:isPlatformAdminEmail(session.user.email) };
    });
  }

  async switchWorkspace(rawToken:string|undefined,targetTenantId:string){
    if(!rawToken||rawToken.startsWith('rps_live_'))throw new UnauthorizedException('Please sign in to continue.');
    return withSessionToken(hashToken(rawToken),async()=>{
      const tokenHash=hashToken(rawToken),now=new Date();
      const session=await prisma.session.findUnique({where:{tokenHash},select:{id:true,userId:true,expiresAt:true}});
      if(!session||session.expiresAt<=now)throw new UnauthorizedException('Your session has expired. Please sign in again.');
      const user=await prisma.user.findUnique({where:{id:session.userId},select:{id:true,name:true,email:true,status:true}});
      if(!user||user.status!=='ACTIVE')throw new UnauthorizedException('Your session has expired. Please sign in again.');
      const membership=await prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:targetTenantId,userId:user.id}}});
      if(!membership||membership.status!=='ACTIVE')throw new UnauthorizedException('You do not have active access to that workspace.');
      await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${targetTenantId}, true)`;
      const organization=await prisma.tenant.findUnique({where:{id:targetTenantId},select:{id:true,name:true}});
      if(!organization)throw new UnauthorizedException('That workspace is no longer available.');
      const nextToken=randomBytes(32).toString('base64url');
      const expiresAt=new Date(now.getTime()+7*24*60*60*1000);
      const changed=await prisma.session.updateMany({where:{id:session.id,tokenHash,expiresAt:{gt:now}},data:{tenantId:targetTenantId,tokenHash:hashToken(nextToken),expiresAt}});
      if(changed.count!==1)throw new UnauthorizedException('Your session changed. Please sign in again.');
      return {token:nextToken,expiresAt,organization:{id:organization.id,name:organization.name}};
    });
  }

  async updateProfile(rawToken:string|undefined,nameInput:string){
    if(!rawToken||rawToken.startsWith('rps_live_'))throw new UnauthorizedException('Please sign in to continue.');
    const actor=await this.authenticate(rawToken);
    const name=nameInput.trim();
    if(name.length<2||name.length>120)throw new BadRequestException('Enter a name between 2 and 120 characters.');
    return prisma.$transaction(async tx=>{
      const account=await tx.user.findUnique({where:{id:actor.id},select:{tenantId:true}});
      if(!account)throw new UnauthorizedException('Please sign in to continue.');
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${account.tenantId}, true)`;
      const user=await tx.user.update({where:{id:actor.id},data:{name},select:{id:true,name:true,email:true,emailVerifiedAt:true}});
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${actor.tenantId}, true)`;
      await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.id,action:'account.profile_updated',entityType:'user',entityId:actor.id,metadata:{fields:['name']}}});
      return user;
    });
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register') @Throttle({default:AUTH_RATE_LIMITS.register}) async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) { setSensitiveResponseHeaders(res); return { data: await this.auth.register(dto) }; }
  @Post('login') @Throttle({default:AUTH_RATE_LIMITS.login}) @HttpCode(200) async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    setSensitiveResponseHeaders(res);
    const result = await this.auth.login(dto.email, dto.password);
    res.cookie('repus_session', result.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', expires: result.expiresAt, path: '/' });
    return { data: { user: result.user, organization: result.organization } };
  }
  @Post('logout') @HttpCode(200) async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setSensitiveResponseHeaders(res);
    const token = req.cookies?.repus_session as string | undefined;
    if (token) await withSessionToken(hashToken(token),async()=>prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }));
    res.clearCookie('repus_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    return { data: { success: true } };
  }
  @Post('refresh') @HttpCode(200) async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setSensitiveResponseHeaders(res);
    const result = await this.auth.refresh(req.cookies?.repus_session as string | undefined);
    res.cookie('repus_session', result.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', expires: result.expiresAt, path: '/' });
    return { data: { success: true, expiresAt: result.expiresAt } };
  }
  @Post('switch-workspace') @HttpCode(200) async switchWorkspace(@Body() dto:WorkspaceSwitchDto,@Req() req:Request,@Res({passthrough:true}) res:Response){
    setSensitiveResponseHeaders(res);
    const result=await this.auth.switchWorkspace(req.cookies?.repus_session as string|undefined,dto.tenantId);
    res.cookie('repus_session',result.token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',expires:result.expiresAt,path:'/'});
    return {data:{success:true,organization:result.organization}};
  }
  @Patch('profile') @HttpCode(200) async updateProfile(@Body() dto:UpdateProfileDto,@Req() req:Request,@Res({passthrough:true}) res:Response){setSensitiveResponseHeaders(res);return {data:await this.auth.updateProfile(req.cookies?.repus_session as string|undefined,dto.name)};}
  @Get('me') async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) { setSensitiveResponseHeaders(res); return { data: await this.auth.authenticate(req.cookies?.repus_session as string | undefined) }; }
  @Post('verify-email') async verify(@Body() dto: TokenDto, @Res({ passthrough: true }) res: Response) { setSensitiveResponseHeaders(res); return { data: await this.auth.verifyEmail(dto.token) }; }
  @Post('verification/resend') @Throttle({default:AUTH_RATE_LIMITS.verificationResend}) async resendVerification(@Body() dto: VerificationResendDto, @Res({ passthrough: true }) res: Response) { setSensitiveResponseHeaders(res); return { data: await this.auth.resendVerification(dto.email) }; }
  @Post('password-reset/request') @Throttle({default:AUTH_RATE_LIMITS.passwordResetRequest}) async requestReset(@Body() dto: ResetRequestDto, @Res({ passthrough: true }) res: Response) { setSensitiveResponseHeaders(res); return { data: await this.auth.requestPasswordReset(dto.email) }; }
  @Post('password-reset/confirm') async confirmReset(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response) { setSensitiveResponseHeaders(res); return { data: await this.auth.resetPassword(dto.token,dto.password) }; }
}


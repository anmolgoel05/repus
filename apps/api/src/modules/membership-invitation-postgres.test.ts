import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
const databaseUrl=process.env.RLS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('existing-account invitation under PostgreSQL RLS',()=>{
 let database:typeof import('@repus/database'),service:import('./organizations').OrganizationsService;
 let invitedTenant:string,homeTenant:string,userId:string;
 const token=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex');
 const oldUrl=process.env.DATABASE_URL;
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl!;database=await import('@repus/database');
  const suffix=randomUUID();
  invitedTenant=(await database.withPlatformAdmin(()=>database.prisma.tenant.create({data:{name:'Inviting workspace',slug:`inviting-${suffix}`}}))).id;
  homeTenant=(await database.withPlatformAdmin(()=>database.prisma.tenant.create({data:{name:'Account home',slug:`invite-home-${suffix}`}}))).id;
  await database.withTenant(homeTenant,async()=>{
   const email=`invite-${suffix}@example.test`;
   const user=await database.prisma.user.create({data:{tenantId:homeTenant,name:'Existing member',email,normalizedEmail:email,passwordHash:'unchanged-test-hash',role:'OWNER',status:'ACTIVE',emailVerifiedAt:new Date()}});userId=user.id;
   await database.prisma.organizationMembership.create({data:{tenantId:homeTenant,userId,role:'OWNER',status:'ACTIVE'}});
   await database.prisma.oneTimeToken.create({data:{tenantId:invitedTenant,userId,tokenHash,purpose:'invite_member',expiresAt:new Date(Date.now()+3600000)}});
  });
  await database.withTenant(invitedTenant,()=>database.prisma.organizationMembership.create({data:{tenantId:invitedTenant,userId,role:'VIEWER',status:'PENDING'}}));
  const {OrganizationsService}=await import('./organizations');service=new OrganizationsService({} as any);
 });
 afterAll(async()=>{
  for(const id of [invitedTenant,homeTenant].filter(Boolean))await database.withPlatformAdmin(()=>database.prisma.tenant.delete({where:{id}}));
  if(database)await database.prisma.$disconnect();
  if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;
 });
 it('consumes the invitation once and activates only the invited membership',async()=>{
  await expect(service.acceptInvitation({token})).resolves.toEqual({success:true});
  await database.withTenant(homeTenant,async()=>{
   expect(await database.prisma.user.findUnique({where:{id:userId},select:{tenantId:true,passwordHash:true,role:true,status:true}})).toEqual({tenantId:homeTenant,passwordHash:'unchanged-test-hash',role:'OWNER',status:'ACTIVE'});
   expect((await database.prisma.oneTimeToken.findUnique({where:{tokenHash}}))?.usedAt).toBeInstanceOf(Date);
  });
  expect(await database.withTenant(invitedTenant,()=>database.prisma.organizationMembership.findUnique({where:{tenantId_userId:{tenantId:invitedTenant,userId}},select:{status:true,role:true}}))).toEqual({status:'ACTIVE',role:'VIEWER'});
  await expect(service.acceptInvitation({token})).rejects.toThrow('already used');
 });
});

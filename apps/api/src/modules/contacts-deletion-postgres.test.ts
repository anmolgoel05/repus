import {randomUUID} from 'node:crypto';
import {ConflictException} from '@nestjs/common';
import type {Request} from 'express';
import {expect,it,vi} from 'vitest';

vi.mock('./send-interrupts',()=>({publishSendInterrupt:vi.fn()}));

const databaseUrl=process.env.RLS_TEST_DATABASE_URL;

it.skipIf(!databaseUrl)('preserves unsubscribe history and suppression when deleting a contact',async()=>{
 const previousUrl=process.env.DATABASE_URL;
 process.env.DATABASE_URL=databaseUrl!;
 const {prisma,withPlatformAdmin,withTenant}=await import('@repus/database');
 let tenantId:string|undefined;
 try{
  const {ContactsService}=await import('./contacts');
  const tenant=await withPlatformAdmin(()=>prisma.tenant.create({data:{name:'Contact deletion regression',slug:`delete-${randomUUID()}`}}));
  tenantId=tenant.id;
  const email='unsubscribed@example.test';
  const auth={authenticate:async()=>({tenantId:tenant.id,role:'OWNER'})} as ConstructorParameters<typeof ContactsService>[0];
  const service=new ContactsService(auth);
  await withTenant(tenant.id,async()=>{
   const contact=await prisma.contact.create({data:{tenantId:tenant.id,email,normalizedEmail:email,status:'UNSUBSCRIBED'}});
   const suppression=await prisma.suppression.create({data:{tenantId:tenant.id,email,normalizedEmail:email,reason:'unsubscribe',source:'test'}});
   const history=await prisma.unsubscribe.create({data:{tenantId:tenant.id,contactId:contact.id,email,reason:'unsubscribe'}});
   await expect(service.remove({} as Request,contact.id)).resolves.toMatchObject({affectedCount:1});
   expect(await prisma.contact.findUnique({where:{id:contact.id}})).toMatchObject({
    email:`deleted+${contact.id}@redacted.repus.invalid`,deletedAt:expect.any(Date),
   });
   expect(await prisma.suppression.findUnique({where:{id:suppression.id}})).toEqual(suppression);
   expect(await prisma.unsubscribe.findUnique({where:{id:history.id}})).toEqual(history);
  });
  await expect(withTenant(tenant.id,()=>service.create({} as Request,{
   email:email.toUpperCase(),consentSource:'Manual entry',consentAt:new Date().toISOString(),
  }))).rejects.toBeInstanceOf(ConflictException);
 }finally{
  try{
   if(tenantId){
    const id=tenantId;
    await withTenant(id,()=>prisma.unsubscribe.deleteMany({where:{tenantId:id}}));
    await withPlatformAdmin(()=>prisma.tenant.delete({where:{id}}));
   }
  }finally{
   await prisma.$disconnect();
   if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
  }
 }
},30_000);

import {createOpaqueToken,encryptToken,tokenHash} from '@repus/token-security';

export async function createContactConfirmation(tx:any,tenantId:string,contactId:string){
 const token=createOpaqueToken(),hash=tokenHash(token),encrypted=encryptToken(token,process.env.SESSION_SECRET??'');
 await tx.contactConfirmationToken.create({data:{tenantId,contactId,tokenHash:hash,tokenEncrypted:encrypted,expiresAt:new Date(Date.now()+48*60*60*1000)}});
}

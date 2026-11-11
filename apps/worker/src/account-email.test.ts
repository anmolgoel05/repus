import {afterEach,describe,expect,it,vi} from 'vitest';
import {encryptToken,tokenHash} from '@repus/token-security';
import {publishPendingAccountEmails,sendAccountEmail} from './account-email';
import {ProviderOutcomeUnknownError} from './provider-failure';
const secret='account-email-tests-secret-at-least-32-characters';
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 vi.stubEnv('SESSION_SECRET',secret);vi.stubEnv('NEXT_PUBLIC_APP_URL','https://repus.example.test/');vi.stubEnv('EMAIL_FROM_ADDRESS','hello@example.test');
 const token={id:'token-a',tenantId:'tenant-a',userId:'user-a',purpose:'verify_email',usedAt:null,expiresAt:new Date(Date.now()+3600000),deliveryStatus:'PENDING',deliveryAttempts:0,deliveryNextAttemptAt:null,tokenHash:tokenHash('raw-capability'),tokenEncrypted:encryptToken('raw-capability',secret),user:{name:'<Reader>',email:'reader@example.test',status:'PENDING'},tenant:{name:'Workspace'}};
 const db={oneTimeToken:{findUnique:vi.fn().mockResolvedValue(token),findMany:vi.fn().mockResolvedValue([{id:'token-a',deliveryAttempts:0}]),updateMany:vi.fn().mockResolvedValue({count:1})},organizationMembership:{findUnique:vi.fn().mockResolvedValue({role:'VIEWER',status:'PENDING'})}};
 const provider={sendEmail:vi.fn().mockResolvedValue({messageId:'dev-message',acceptedAt:new Date()}),getSendingQuota:vi.fn()};
 return {db,provider,token};
}
describe('durable account email delivery',()=>{
 it('clears unusable claimed capabilities while preserving provider reconciliation state', async () => {
  const {db} = fixture();
  const now = new Date('2026-11-04T00:00:00Z');
  db.oneTimeToken.findMany.mockResolvedValue([]);
  const queue = {addBulk: vi.fn(), getJob: vi.fn()};
  await publishPendingAccountEmails(db as any, queue as any, now);
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith({
   where: {deliveryStatus: 'SENDING', tokenEncrypted: {not: null}, OR: [{usedAt: {not: null}}, {expiresAt: {lte: now}}]},
   data: {tokenEncrypted: null},
  });
  expect(queue.addBulk).not.toHaveBeenCalled();
 });
 it('publishes only token IDs, keeping encrypted and raw capabilities out of Redis',async()=>{
  const {db}=fixture();const queue={addBulk:vi.fn(),getJob:vi.fn().mockResolvedValue(null)};await publishPendingAccountEmails(db as any,queue as any);
  expect(queue.addBulk).toHaveBeenCalledWith([{name:'send-account',data:{tokenId:'token-a'},opts:{priority:1,jobId:'account-token-a-0',attempts:1,removeOnComplete:true,removeOnFail:false}}]);
 });
 it('repairs a job that failed before claiming the still-pending outbox row',async()=>{
  const {db}=fixture();const failed={getState:vi.fn().mockResolvedValue('failed'),retry:vi.fn().mockResolvedValue(undefined)};const queue={getJob:vi.fn().mockResolvedValue(failed),addBulk:vi.fn()};
  await publishPendingAccountEmails(db as any,queue as any);expect(failed.retry).toHaveBeenCalledOnce();expect(queue.addBulk).not.toHaveBeenCalled();
 });
 it('sends escaped content and clears encrypted payload after provider acceptance',async()=>{
  const {db,provider}=fixture();await sendAccountEmail(db as any,provider,'token-a');
  expect(provider.sendEmail).toHaveBeenCalledWith(expect.objectContaining({to:'reader@example.test',html:expect.stringContaining('&lt;Reader&gt;'),text:expect.stringContaining('/verify-email?token=raw-capability'),tags:{tenant_id:'tenant-a',kind:'account',account_token_id:'token-a'}}));
  expect(db.oneTimeToken.updateMany).toHaveBeenLastCalledWith({where:{id:'token-a',deliveryStatus:'SENDING'},data:expect.objectContaining({deliveryStatus:'SENT',deliveryMessageId:'dev-message',tokenEncrypted:null})});
 });
 it('does not resubmit an already claimed token after a worker restart',async()=>{
  const {db,provider,token}=fixture();token.deliveryStatus='SENDING';await sendAccountEmail(db as any,provider,'token-a');expect(provider.sendEmail).not.toHaveBeenCalled();
 });
 it('refuses an encrypted capability that belongs to a different token record',async()=>{
  const {db,provider,token}=fixture();token.tokenHash=tokenHash('another-capability');await expect(sendAccountEmail(db as any,provider,'token-a')).rejects.toThrow('requires review');expect(provider.sendEmail).not.toHaveBeenCalled();
  expect(db.oneTimeToken.updateMany).toHaveBeenLastCalledWith({where:{id:'token-a',deliveryStatus:'SENDING'},data:{deliveryStatus:'FAILED',tokenEncrypted:null}});
 });
 it('retains uncertain outcomes without automatic resubmission',async()=>{
  const {db,provider}=fixture();provider.sendEmail.mockRejectedValue(new ProviderOutcomeUnknownError());await expect(sendAccountEmail(db as any,provider,'token-a')).rejects.toThrow('requires review');
  expect(db.oneTimeToken.updateMany).toHaveBeenLastCalledWith({where:{id:'token-a',deliveryStatus:'SENDING'},data:{deliveryStatus:'UNCERTAIN',tokenEncrypted:null}});
 });
 it('backs off definite throttling and waits for the persisted retry deadline',async()=>{
  const {db,provider,token}=fixture();provider.sendEmail.mockRejectedValue({name:'TooManyRequestsException'});await sendAccountEmail(db as any,provider,'token-a');
  expect(db.oneTimeToken.updateMany).toHaveBeenLastCalledWith({where:{id:'token-a',deliveryStatus:'SENDING'},data:expect.objectContaining({deliveryStatus:'PENDING',deliveryNextAttemptAt:expect.any(Date)})});
  provider.sendEmail.mockClear();token.deliveryNextAttemptAt=new Date(Date.now()+60000) as any;await sendAccountEmail(db as any,provider,'token-a');expect(provider.sendEmail).not.toHaveBeenCalled();
 });
 it('skips invitations whose membership is no longer pending',async()=>{
  const {db,provider,token}=fixture();token.purpose='invite_member';db.organizationMembership.findUnique.mockResolvedValue({role:'VIEWER',status:'DISABLED'});await sendAccountEmail(db as any,provider,'token-a');expect(provider.sendEmail).not.toHaveBeenCalled();
  expect(db.oneTimeToken.updateMany).toHaveBeenCalledWith({where:{id:'token-a',deliveryStatus:'PENDING'},data:{deliveryStatus:'SKIPPED',tokenEncrypted:null}});
  db.organizationMembership.findUnique.mockResolvedValue({role:'VIEWER',status:'PENDING'});token.user.status='DISABLED';await sendAccountEmail(db as any,provider,'token-a');expect(provider.sendEmail).not.toHaveBeenCalled();
 });
});


import {describe,expect,it} from 'vitest';
import {sendingDomainSendBlock,workspaceSendBlock,TEST_SEND_RATE_LIMIT} from './domain-readiness';

describe('campaign sending-domain readiness',()=>{
  it('blocks unverified identities and pending SES DKIM',()=>{
    expect(sendingDomainSendBlock(null,'ses')).toContain('Verify your sender domain');
    expect(sendingDomainSendBlock({verificationStatus:'verified',dkimStatus:'pending'},'ses')).toContain('DKIM');
  });

  it('requires verified DKIM in SES mode and preserves the development adapter flow',()=>{
    expect(sendingDomainSendBlock({verificationStatus:'verified',dkimStatus:'verified'},'ses')).toBeNull();
    expect(sendingDomainSendBlock({verificationStatus:'verified',dkimStatus:'development'},'development')).toBeNull();
  });
});

describe('workspace sending readiness',()=>{
  it('blocks test or marketing sends for inactive or disabled workspaces',()=>{
    expect(workspaceSendBlock('suspended',true)).toContain('paused');
    expect(workspaceSendBlock('active',false)).toContain('paused');
    expect(workspaceSendBlock('active',true)).toBeNull();
    expect(workspaceSendBlock(null,true)).toContain('paused');
  });
  it('keeps test sends tightly rate limited',()=>{
    expect(TEST_SEND_RATE_LIMIT).toEqual({limit:5,ttl:60_000});
  });
});

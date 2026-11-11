import {describe,expect,it} from 'vitest';
import {buildOnboardingSnapshot,onboardingCompletion} from './onboarding-progress';

describe('onboarding snapshot',()=>{
  it('preserves the authenticated workspace user and normalizes the organization',()=>{
    const workspace={organization:{id:'workspace-a',name:'Studio'},user:{id:'user-a'}};
    expect(buildOnboardingSnapshot(workspace,[{verificationStatus:'verified'}],[],{contacts:0},[])).toEqual({
      organization:workspace.organization,
      user:workspace.user,
      domains:[{verificationStatus:'verified'}],
      lists:[],
      analytics:{contacts:0},
      campaigns:[],
    });
  });
});

describe('onboarding progress',()=>{
  it('counts required setup steps and completes only when each is ready',()=>{
    expect(onboardingCompletion({workspaceReady:true,senderDomainVerified:false,hasList:false,hasContacts:false,hasCampaign:false})).toEqual({completed:1,total:5,complete:false});
    expect(onboardingCompletion({workspaceReady:true,senderDomainVerified:true,hasList:true,hasContacts:true,hasCampaign:true})).toEqual({completed:5,total:5,complete:true});
  });
});

export type OnboardingSignals={
  workspaceReady:boolean;
  senderDomainVerified:boolean;
  hasList:boolean;
  hasContacts:boolean;
  hasCampaign:boolean;
};

export type OnboardingSnapshot={
  organization:{id:string;name:string};
  user:{id:string};
  domains:Array<{verificationStatus:string}>;
  lists:Array<unknown>;
  analytics:{contacts:number};
  campaigns:Array<{id:string}>;
};

export function buildOnboardingSnapshot(
  workspace:{organization:{id:string;name:string};user:{id:string}},
  domains:Array<{verificationStatus:string}>,
  lists:Array<unknown>,
  analytics:{contacts:number},
  campaigns:Array<{id:string}>,
):OnboardingSnapshot{
  return {organization:workspace.organization,user:workspace.user,domains,lists,analytics,campaigns};
}

export function onboardingCompletion(signals:OnboardingSignals){
  const required=[signals.workspaceReady,signals.senderDomainVerified,signals.hasList,signals.hasContacts,signals.hasCampaign];
  return {completed:required.filter(Boolean).length,total:required.length,complete:required.every(Boolean)};
}

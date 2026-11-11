export type ContactConsentEvidence={consentSource:string;consentAt:Date};

export function parseContactConsentEvidence(source:string,value:string,now=new Date()):ContactConsentEvidence|null{
 const consentSource=source.trim();
 const consentAt=new Date(value);
 if(!consentSource||consentSource.includes('\u0000')||consentSource.length>240||Number.isNaN(consentAt.getTime())||consentAt>now)return null;
 return {consentSource,consentAt};
}

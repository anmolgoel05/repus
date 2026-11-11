export type ContactConsentSnapshot={
 normalizedEmail:string;
 status:string;
 consentAt:Date|null;
 consentSource:string|null;
 deletedAt:Date|null;
};

export function recipientConsentAllowsSend(recipientEmail:string,contact:ContactConsentSnapshot|null|undefined):boolean{
 return !!contact&&!contact.deletedAt&&contact.status==='SUBSCRIBED'&&!!contact.consentAt&&!!contact.consentSource?.trim()&&recipientEmail.trim().toLowerCase()===contact.normalizedEmail.toLowerCase();
}

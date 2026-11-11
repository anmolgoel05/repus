const suppressionPriority:Record<string,number>={unsubscribe:1,hard_bounce:2,complaint:3,manual:4};

/** Provider evidence may strengthen a suppression, but never weaken an existing reason. */
export function shouldPromoteProviderSuppression(existingReason:string|undefined,incomingReason:'hard_bounce'|'complaint'){
 if(!existingReason)return true;
 return (suppressionPriority[incomingReason]??0)>(suppressionPriority[existingReason]??Number.MAX_SAFE_INTEGER);
}

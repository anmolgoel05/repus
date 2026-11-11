export function campaignCancellationPrompt(status:string){
 if(status==='QUEUED'||status==='PAUSED')return 'Cancel this campaign? Queued emails will stop and their reserved quota will be released. A request already submitted to the email provider may still be accepted.';
 return 'Cancel this scheduled campaign? It will not send, and its reserved sending quota will be released.';
}

export function campaignCancellationResultMessage(status:string,interruptionPublished:boolean){
 if(status!=='QUEUED'&&status!=='PAUSED')return 'Scheduled campaign cancelled and reserved sending quota released.';
 if(interruptionPublished)return 'Campaign cancelled. Repus sent workers an interruption signal. SES may already have accepted a message; check campaign results before resending.';
 return 'Campaign cancelled. Queued sends stopped and quota was released, but Repus could not confirm a worker interruption. An active provider request may still complete; check campaign results before resending.';
}

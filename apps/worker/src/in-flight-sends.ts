import type {SendInterrupt} from '@repus/validation';

export type InFlightSend = {campaignId:string|null;tenantId:string|null;controller:AbortController};

export function abortInFlightSends(sends:Map<string,InFlightSend>,interrupt:SendInterrupt):number{
 let aborted=0;
 for(const [key,send] of sends){
  if(interrupt.scope==='campaign'&&send.campaignId!==interrupt.campaignId)continue;
  if(interrupt.scope==='tenant'&&send.tenantId!==interrupt.tenantId)continue;
  if(interrupt.scope==='recipient'&&key!==interrupt.recipientId)continue;
  if(send.controller.signal.aborted)continue;
  send.controller.abort('Repus sending control interrupted the provider request.');
  aborted++;
 }
 return aborted;
}

export async function withInFlightAbort<T>(
 sends:Map<string,InFlightSend>,
 key:string,
 campaignId:string|null,
 tenantId:string|null,
 submit:(signal:AbortSignal)=>Promise<T>,
):Promise<T>{
 const controller=new AbortController();
 const entry={campaignId,tenantId,controller};
 sends.set(key,entry);
 try{return await submit(controller.signal);}
 finally{if(sends.get(key)===entry)sends.delete(key);}
}

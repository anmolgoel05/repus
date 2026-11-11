import type {PrivateImageObject} from '@repus/import-storage';

export async function sweepOrphanedImages(input:{
 list:(cursor?:string)=>Promise<{objects:PrivateImageObject[];nextCursor?:string}>;
 findRegistered:(keys:string[])=>Promise<string[]>;
 remove:(key:string)=>Promise<void>;
 cursor?:string;
 now?:Date;
 minimumAgeMs?:number;
}){
 const page=await input.list(input.cursor);
 const cutoff=(input.now??new Date()).getTime()-(input.minimumAgeMs??24*60*60*1000);
 const stale=page.objects.filter(object=>object.lastModified.getTime()<=cutoff);
 const registered=new Set(stale.length?await input.findRegistered(stale.map(object=>object.key)):[]);
 let removed=0,failed=0;
 for(const object of stale){
  if(registered.has(object.key))continue;
  try{await input.remove(object.key);removed++;}catch{failed++;}
 }
 return {nextCursor:page.nextCursor,scanned:page.objects.length,stale:stale.length,removed,failed};
}

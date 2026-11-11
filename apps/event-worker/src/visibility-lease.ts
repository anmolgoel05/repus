export async function withVisibilityLease<T>(
  work:()=>Promise<T>,
  extend:()=>Promise<unknown>,
  onFailure:(error:unknown)=>void,
  intervalMs=45_000,
):Promise<T>{
  let renewal:Promise<void>|undefined;
  const timer=setInterval(()=>{
    if(renewal)return;
    renewal=Promise.resolve().then(extend).then(()=>{},onFailure).finally(()=>{renewal=undefined;});
  },intervalMs);
  timer.unref?.();
  try{return await work();}
  finally{
    clearInterval(timer);
    await renewal;
  }
}

export type ReadinessCheck=()=>Promise<unknown>;

export async function checkApiReadiness(checks:Record<string,ReadinessCheck>,timeoutMs=2500){
 const dependencies:Record<string,'available'|'unavailable'>={};
 await Promise.all(Object.entries(checks).map(async([name,check])=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([check(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Readiness check timed out.')),timeoutMs);})]);
   dependencies[name]='available';
  }catch{dependencies[name]='unavailable';}
  finally{if(timer)clearTimeout(timer);}
 }));
 const status=Object.values(dependencies).some(value=>value==='unavailable')?'unavailable':'ok';
 return {status,service:'repus-api',dependencies,checkedAt:new Date().toISOString()};
}

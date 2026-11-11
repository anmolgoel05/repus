export function singleFlight<T>(operation:()=>Promise<T>):()=>Promise<T|undefined>{
  let running=false;
  return async()=>{
    if(running)return undefined;
    running=true;
    try{return await operation();}
    finally{running=false;}
  };
}

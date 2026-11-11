export function assertProductionEmailConfig(env:Record<string,string|undefined>){
 if(env.NODE_ENV!=='production')return;
 const missing=['AWS_REGION','AWS_SES_CONFIGURATION_SET','AWS_S3_BUCKET'].filter(name=>!env[name]?.trim());
 if(env.EMAIL_PROVIDER!=='ses')missing.unshift('EMAIL_PROVIDER=ses');
 if((env.SESSION_SECRET?.trim().length??0)<32)missing.push('SESSION_SECRET (at least 32 non-whitespace characters)');
 if(!env.EMAIL_FROM_ADDRESS||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM_ADDRESS))missing.push('EMAIL_FROM_ADDRESS (valid email address)');
 for(const name of ['NEXT_PUBLIC_APP_URL','TRACKING_BASE_URL','PUBLIC_MEDIA_URL']){
  const value=env[name];
  try{
   const url=new URL(value??'');
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||isLoopbackHost(url.hostname))throw new Error();
  }catch{missing.push(`${name} (HTTPS origin)`);}
 }
 if(missing.length)throw new Error(`Production email configuration is incomplete or invalid: ${missing.join(', ')}.`);
}

export function assertProductionInfrastructureConfig(env:Record<string,string|undefined>){
 if(env.NODE_ENV!=='production')return;
 const missing:string[]=[];
 try{new Intl.DateTimeFormat('en-US',{timeZone:env.PLATFORM_TIMEZONE??'Asia/Kolkata'});}catch{missing.push('PLATFORM_TIMEZONE (valid IANA timezone)');}
 const databaseUrl=validProductionUrl(env.DATABASE_URL,['postgresql:','postgres:']);
 if(!databaseUrl||isLoopbackHost(databaseUrl.hostname))missing.push('DATABASE_URL (remote PostgreSQL connection)');
 const redisUrl=validProductionUrl(env.REDIS_URL,['redis:','rediss:']);
 if(!redisUrl||isLoopbackHost(redisUrl.hostname))missing.push('REDIS_URL (remote Redis connection)');
 if(missing.length)throw new Error(`Production infrastructure configuration is incomplete or invalid: ${missing.join(', ')}.`);
}

export function trustedProxyHops(env:Record<string,string|undefined>){
 const raw=env.TRUST_PROXY_HOPS;
 const value=raw===undefined||raw.trim()===''?(env.NODE_ENV==='production'?NaN:0):Number(raw);
 if(!Number.isInteger(value)||value<0||value>4||(env.NODE_ENV==='production'&&value===0)){
  throw new Error('TRUST_PROXY_HOPS must be an integer from 1 to 4 in production and from 0 to 4 in development.');
 }
 return value;
}

function validProductionUrl(value:string|undefined,protocols:string[]){
 try{const url=new URL(value??'');return protocols.includes(url.protocol)&&url.hostname?url:null;}catch{return null;}
}
function isLoopbackHost(hostname:string){
 const host=hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.localhost')||host==='::1'||host==='[::1]')return true;
 const octets=host.split('.');
 return octets.length===4&&octets.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255)&&Number(octets[0])===127;
}

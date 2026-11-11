import IORedis from 'ioredis';
import {SEND_INTERRUPT_CHANNEL,type SendInterrupt} from '@repus/validation';

type Publisher=Pick<IORedis,'publish'|'quit'|'disconnect'>;
type PublisherFactory=(url:string,options:{maxRetriesPerRequest:number;connectTimeout:number;commandTimeout:number;lazyConnect:boolean})=>Publisher;
const createPublisher:PublisherFactory=(url,options)=>{
 const publisher=new IORedis(url,options);
 // The publish failure path logs a safe message without the connection error.
 publisher.on('error',()=>{});
 return publisher;
};

export async function publishSendInterrupt(interrupt:SendInterrupt,factory:PublisherFactory=createPublisher):Promise<number|null>{
 let publisher:Publisher|undefined;
 try{
  publisher=factory(process.env.REDIS_URL??'redis://localhost:6379',{maxRetriesPerRequest:1,connectTimeout:3000,commandTimeout:5000,lazyConnect:true});
  const subscribers=await publisher.publish(SEND_INTERRUPT_CHANNEL,JSON.stringify(interrupt));
  await publisher.quit();
  return subscribers;
 }
 catch{publisher?.disconnect();console.warn('Could not publish provider-send interrupt to Redis.');return null;}
}

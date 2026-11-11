const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {resolveLaunch}=require('./command-launch.cjs');
const root=path.resolve(__dirname,'..');
const candidates=[path.join(root,'.env'),path.join(process.cwd(),'.env')];
const envFile=candidates.find(candidate=>fs.existsSync(candidate));
if(envFile){
 try{require('dotenv').config({path:envFile,override:false,quiet:true});}
 catch(error){console.error(`Could not load ${envFile}; install workspace dependencies first.`,error);process.exit(1);}
}
const args=process.argv.slice(2);
let databaseMode=null;
while(args[0]?.startsWith('--')){
 const option=args.shift();
 if(option==='--migration-db')databaseMode='migration';
 else if(option==='--worker-db')databaseMode='worker';
 else if(option==='--production')process.env.NODE_ENV='production';
 else if(option==='--web')process.env.PORT=process.env.WEB_PORT??'3000';
 else{console.error(`Unknown launcher option: ${option}`);process.exit(2);}
}
if(databaseMode==='migration'&&process.env.MIGRATION_DATABASE_URL)process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL;
if(databaseMode==='worker'){
 if(!process.env.WORKER_DATABASE_URL){console.error('Set WORKER_DATABASE_URL to the trusted worker database role before starting queue workers.');process.exit(2);}
 process.env.DATABASE_URL=process.env.WORKER_DATABASE_URL;
}
const [command,...commandArgs]=args;
if(!command){console.error('Usage: run-with-env [--migration-db|--worker-db] [--production] [--web] <command> [arguments...]');process.exit(2);}
let launch;
try{launch=resolveLaunch(command,commandArgs,{root});}
catch(error){console.error(error.message);process.exit(1);}
const child=spawn(launch.file,launch.args,{stdio:'inherit',env:process.env,shell:false});
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(`Could not start ${command}:`,error);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});

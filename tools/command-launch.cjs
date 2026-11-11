'use strict';

const fs=require('node:fs');
const path=require('node:path');
const packages={concurrently:['concurrently'],prisma:['prisma'],nest:['@nestjs/cli'],next:['next'],tsx:['tsx'],tsc:['typescript'],playwright:['@playwright/test','playwright']};

function resolveLaunch(command,args,{platform=process.platform,cwd=process.cwd(),root=path.resolve(__dirname,'..'),env=process.env,execPath=process.execPath}={}){
 if(command==='node'||command==='node.exe')return {file:execPath,args};
 if(platform!=='win32')return {file:command,args};
 if(['npm','npm.cmd','npm.exe'].includes(command.toLowerCase())){
  const candidates=[env.npm_execpath,path.join(path.dirname(execPath),'node_modules/npm/bin/npm-cli.js')];
  const cli=candidates.find(candidate=>candidate&&path.isAbsolute(candidate)&&/\.[cm]?js$/i.test(candidate)&&fs.existsSync(candidate));
  if(!cli)throw new Error('Could not locate npm-cli.js. Start this command with npm or install npm alongside Node.js.');
  return {file:execPath,args:[cli,...args]};
 }
 const packageNames=packages[command];
 if(!packageNames)return {file:command,args};
 const locations=[];
 for(let directory=path.resolve(cwd);;directory=path.dirname(directory)){
  locations.push(path.join(directory,'node_modules'));
  if(path.relative(path.resolve(root),directory)==='')break;
  if(path.dirname(directory)===directory)break;
 }
 locations.push(path.join(root,'node_modules'));
 for(const packageName of packageNames)for(const location of locations){
  const manifestPath=path.join(location,packageName,'package.json');
  if(!fs.existsSync(manifestPath))continue;
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const bin=typeof manifest.bin==='string'?manifest.bin:manifest.bin?.[command];
  if(typeof bin!=='string')continue;
  const cli=path.resolve(path.dirname(manifestPath),bin);
  if(fs.existsSync(cli)&&fs.statSync(cli).isFile())return {file:execPath,args:[cli,...args]};
 }
 throw new Error(`Could not locate the ${command} CLI. Install the workspace dependencies first.`);
}

module.exports={resolveLaunch};

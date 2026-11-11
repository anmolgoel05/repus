'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {resolveLaunch}=require('./command-launch.cjs');

function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repus-launcher-'));
 t.after(()=>{assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'repus-launcher-'));fs.rmSync(directory,{recursive:true,force:true});});
 return directory;
}

test('Windows workspace CLIs receive literal arguments without shell expansion',t=>{
 const root=fixture(t),folder=path.join(root,'node_modules/next');
 fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({bin:{next:'cli'}}));
 fs.writeFileSync(path.join(folder,'cli'),'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
 const sentinel=path.join(root,'unexpected.txt');
 const args=['a path with spaces','quote " text',`value & echo expanded > "${sentinel}"`,'%PATH%','$(echo expanded)','x|y','^caret'];
 const launch=resolveLaunch('next',args,{platform:'win32',root,cwd:root});
 const result=spawnSync(launch.file,launch.args,{shell:false,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),args);
 assert.equal(fs.existsSync(sentinel),false);
});

test('npm uses its JavaScript entry point and preserves script arguments',t=>{
 const root=fixture(t),cli=path.join(root,'npm-cli.js');fs.writeFileSync(cli,'');
 const args=['run','dev','--','literal & value'];
 assert.deepEqual(resolveLaunch('npm',args,{platform:'win32',root,cwd:root,env:{npm_execpath:cli}}),{file:process.execPath,args:[cli,...args]});
});

test('Windows TypeScript builds resolve the compiler JavaScript entry point',t=>{
 const root=fixture(t),folder=path.join(root,'node_modules/typescript');
 fs.mkdirSync(path.join(folder,'bin'),{recursive:true});
 fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({bin:{tsc:'bin/tsc'}}));
 fs.writeFileSync(path.join(folder,'bin/tsc'),'');
 assert.deepEqual(resolveLaunch('tsc',['-p','tsconfig.json'],{platform:'win32',root,cwd:root}),{file:process.execPath,args:[path.join(folder,'bin/tsc'),'-p','tsconfig.json']});
});

test('Node and native executables do not require a command shell',()=>{
 assert.deepEqual(resolveLaunch('node',['file.cjs']),{file:process.execPath,args:['file.cjs']});
 assert.deepEqual(resolveLaunch('native.exe',['literal&argument'],{platform:'win32'}),{file:'native.exe',args:['literal&argument']});
});

test('missing Windows workspace binaries fail with installation guidance',t=>{
 const root=fixture(t);
 assert.throws(()=>resolveLaunch('next',[],{platform:'win32',root,cwd:root}),/Install the workspace dependencies/);
});

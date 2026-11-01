import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import wxmlValidator from './validate-wxml.cjs';
import moduleLoader from './wechat-module-loader.cjs';
const root=fileURLToPath(new URL('../miniprogram/',import.meta.url));
function walk(dir){return readdirSync(dir).flatMap(n=>statSync(resolve(dir,n)).isDirectory()?walk(resolve(dir,n)):[resolve(dir,n)]);}
const version=JSON.parse(readFileSync(resolve(root,'config/version.json')));
const pkg=JSON.parse(readFileSync(resolve(root,'../package.json')));
assert.equal(version.version,pkg.version,'Product and package versions differ');
assert.deepEqual(createRequire(import.meta.url)(resolve(root,'config/version.js')),version,'Run npm run version:sync to update runtime version');
const files=walk(root);const app=JSON.parse(readFileSync(resolve(root,'app.json')));
for(const route of [...app.pages,'custom-tab-bar/index']){
 for(const ext of ['js','json','wxml','wxss'])assert(existsSync(resolve(root,route+'.'+ext)),`${route}.${ext} missing`);
 let definition;
 const script=resolve(root,route+'.js');
 moduleLoader.createWechatLoader(root,{Page:d=>definition=d,Component:d=>definition=d}).load(script);
 const handlers=definition.methods||definition;
 const template=readFileSync(resolve(root,route+'.wxml'),'utf8');
 if(JSON.parse(readFileSync(resolve(root,route+'.json'))).component){
  const css=readFileSync(resolve(root,route+'.wxss'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  for(const match of css.matchAll(/([^{}]+)\{/g)){
   const selector=match[1].trim();
   assert(/^[.][\w.-]+(?:\s+[.][\w.-]+)*$/.test(selector),`${route}: component selector must use classes: ${selector}`);
  }
 }
 wxmlValidator.validateWxml(template, route);
 for(const match of template.matchAll(/(?:bind|catch)(?::)?[a-zA-Z]+="([A-Za-z_$][\w$]*)"/g))assert.equal(typeof handlers[match[1]],'function',`${route}: missing handler ${match[1]}`);
 for(const match of template.matchAll(/wx:(?:if|elif|for)="([^"]*)"/g))assert(match[1].includes('{{'),`${route}: literal directive ${match[0]}`);
 for(const match of template.matchAll(/src="(\/[^"{]+)"/g))assert(existsSync(resolve(root,'.'+match[1])),`asset missing ${match[1]}`);
}
for(const file of files){
 if(file.endsWith('.json'))JSON.parse(readFileSync(file));
 if(file.endsWith('.js')){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
}
for(const tab of app.tabBar.list)assert(app.pages.includes(tab.pagePath));
const size=files.reduce((s,f)=>s+statSync(f).size,0);assert(size<2*1024*1024,'Main package exceeds 2MiB');
console.log(`Checked ${app.pages.length} pages, custom tab bar, handlers, literal asset references, JSON, JS syntax; package ${(size/1024).toFixed(0)} KiB.`);
console.log('This is a static check, not a WeChat Developer Tools compilation or visual test.');

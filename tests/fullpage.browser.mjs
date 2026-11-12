import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { THEMES, DETAIL_GROUPS, DETAIL_FIELDS } from '../core.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base=fileURLToPath(new URL('../', import.meta.url));
const artifacts=await fs.mkdtemp(path.join(tmpdir(), 'persona-forge-ui-'));
const mock = `
window.fixture={failAI:false,failUpload:false,selected:'original',saves:0,requests:[]};
const power={personas:{original:'原有用户'},persona_descriptions:{original:{description:'原有设定内容',title:'原设定'}},default_persona:'original'};
const c={powerUserSettings:power,extensionSettings:{st_persona_forge_v1:{form:{gender:'旧版自填性别'}}},onlineStatus:'connected',characters:[{name:'对手角色',description:'CHARACTER SECRET',scenario:'world'}],characterId:0,getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'test'}),saveSettingsDebounced:()=>fixture.saves++,eventTypes:{APP_READY:'ready'},eventSource:{on:(_e,fn)=>queueMicrotask(fn)},SlashCommand:{fromProps:x=>x},SlashCommandParser:{addCommandObject:x=>window.command=x},generateRaw:async(options={})=>{fixture.requests.push(options);if(fixture.failAI)throw new Error('模拟模型连接失败');return JSON.stringify({name:'AI 林澈',title:'生成结果',description:'由AI生成的完整用户设定 {{user}} 与 {{char}}。'});},generateQuietPrompt:async(options={})=>{fixture.requests.push(options);return JSON.stringify({name:'上下文用户',description:'chat result'});}};
window.SillyTavern={getContext:()=>c};window.fixture.power=power;
`;
const pm = `export async function initPersona(id,name,description,title){fixture.power.personas[id]=name;fixture.power.persona_descriptions[id]={description,title};} export async function getUserAvatars(){return Object.keys(fixture.power.personas);}export async function setUserAvatar(id){fixture.selected=id;}`;
const server=createServer(async(req,res)=>{
try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/scripts/extensions/third-party/st-persona-forge/style.css"></head><body style="margin:0;background:#eee;transform:translateZ(0);font-size:30px"><style>input,textarea,select{background:#fff8ed!important;color:#2b241b!important;font-size:32px!important}dialog{max-height:450px!important;margin:40px!important}section{max-height:500px!important}</style><div id="extensions_settings2"></div><script>${mock}</script><script type="module" src="/scripts/extensions/third-party/st-persona-forge/index.js"></script></body></html>`);return;}
 if(req.url==='/scripts/personas.js'){res.setHeader('Content-Type','text/javascript');res.end(pm);return;}
 const prefix='/scripts/extensions/third-party/st-persona-forge/';
 if(req.url.startsWith(prefix)) {const file=req.url.slice(prefix.length).split('?')[0];if(!['index.js','core.js','style.css'].includes(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(base+'/'+file));return;}
 res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {}),args:['--no-sandbox']});
const errors=[];const page=await browser.newPage({viewport:{width:1360,height:1000}});page.on('pageerror',e=>errors.push(String(e)));
let uploads=0;
await page.route('**/api/avatars/upload',async route=>{
 const bad=await page.evaluate(()=>fixture.failUpload);uploads++;
 if(bad){await route.fulfill({status:500,body:'fail'});return;}
 const body=route.request().postDataBuffer().toString();
 const id=body.match(/persona-forge-[a-zA-Z0-9-]+\.png/)?.[0];
 assert.ok(id);assert.equal(route.request().headers()['x-csrf-token'],'test');
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({path:id})});
});
try {
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByText('打开用户设定生成器',{exact:true}).click();
 // Old free-text values survive migration to the new gender selector.
 assert.equal(await page.locator('#pf-gender').inputValue(),'自定义');
 assert.equal(await page.locator('#pf-genderCustom').inputValue(),'旧版自填性别');
 assert.equal(await page.locator('#pf-gender-custom-field').isVisible(),true);
 await page.locator('#pf-gender').selectOption('女');
 assert.equal(await page.locator('#pf-gender-custom-field').isVisible(),false);
 assert.equal(await page.locator('#pf-theme option').count(),20);
 for(const [key, theme] of Object.entries(THEMES)){
  await page.locator('#pf-theme').selectOption(key);await page.locator('#pf-template').click();
  const description=await page.locator('#pf-description').inputValue();
  assert.ok(description.includes(theme[0]));assert.ok(description.includes('性别：女'));assert.ok(!description.includes('称谓'));
 }
 await page.locator('#pf-gender').selectOption('自定义');
 await page.locator('#pf-genderCustom').fill('流体性别');await page.locator('#pf-template').click();
 assert.ok((await page.locator('#pf-description').inputValue()).includes('性别：流体性别'));
 await page.locator('#pf-gender').selectOption('女');await page.locator('#pf-theme').selectOption('modern');
 // Each optional fact has a real input and participates in both output routes.
 for(const group of DETAIL_GROUPS){
  await page.locator('#pf-detail-group-'+group.id+' > summary').click();
  for(const [key] of group.fields) await page.locator('#pf-detail-'+key).fill('DETAIL_VALUE_'+key);
  await page.locator('#pf-detail-group-'+group.id+' > summary').click();
 }
 assert.equal(await page.locator('#pf-detail-count').textContent(),'25/25 已填写');
 await page.locator('#pf-clear-details').click();assert.equal(await page.locator('#pf-detail-count').textContent(),'0/25 已填写');
 assert.equal(await page.locator('#pf-detail-features').inputValue(),'');
 await page.locator('#pf-clear-details').click();assert.equal(await page.locator('#pf-detail-features').inputValue(),'DETAIL_VALUE_features');
 assert.equal(await page.locator('#pf-detail-count').textContent(),'25/25 已填写');
 await page.locator('#pf-length').selectOption('dossier');
 await page.locator('#pf-template').click();
 for(const [key] of DETAIL_FIELDS) assert.ok((await page.locator('#pf-description').inputValue()).includes('DETAIL_VALUE_'+key));
 assert.ok((await page.locator('#pf-description').inputValue()).length>200);
 await page.locator('#pf-out-name').fill('林澈');
 await page.locator('#pf-save').click();
 await page.screenshot({path:path.join(artifacts, 'fullpage-desktop.png')});
 // Full-page layout is isolated from hostile themes and transformed page ancestors.
 assert.deepEqual(await page.locator('#pf-overlay').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,modal:el.matches(':modal')};}),{x:0,y:0,width:1360,height:1000,modal:true});
 assert.equal(await page.locator('#pf-name').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 19, 29)');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
 // Native export round trip, preserving macros and no active-persona override.
 const downloaded=page.waitForEvent('download');await page.locator('#pf-export').click();const d=await downloaded;
 const json=JSON.parse(await fs.readFile(await d.path(),'utf8'));assert.equal(Object.values(json.personas)[0],'林澈');assert.equal(json.default_persona,undefined);
 await page.locator('#pf-install').click();await page.locator('#pf-status').filter({hasText:'已新增'}).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(fixture.power.personas).length),2);
 assert.equal(await page.evaluate(()=>fixture.selected),'original');
 // Failed avatar upload must not create a phantom persona.
 await page.evaluate(()=>fixture.failUpload=true);await page.locator('#pf-install').click();await page.locator('#pf-status').filter({hasText:'头像上传失败'}).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(fixture.power.personas).length),2);
 await page.evaluate(()=>fixture.failUpload=false);
 // Failure leaves edited work intact.
 const prior=await page.locator('#pf-description').inputValue();
 await page.evaluate(()=>fixture.failAI=true);await page.locator('#pf-generate').click();await page.locator('#pf-status').filter({hasText:'模拟模型连接失败'}).waitFor();
 assert.equal(await page.locator('#pf-description').inputValue(),prior);
 await page.evaluate(()=>fixture.failAI=false);await page.locator('#pf-generate').click();await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 assert.equal(await page.locator('#pf-out-name').inputValue(),'AI 林澈');
 const request=await page.evaluate(()=>fixture.requests.at(-1));assert.equal(request.responseLength,5000);for(const [key] of DETAIL_FIELDS)assert.ok(request.prompt.includes('DETAIL_VALUE_'+key));assert.ok(!request.prompt.includes('CHARACTER SECRET'));assert.ok(request.prompt.includes('\"性别\": \"女\"'));assert.ok(!request.prompt.includes('称谓'));
 // Import HTML-looking content only as textarea text.
 await page.locator('#pf-file').setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'<img src=x onerror=alert(1)>',description:'<script>window.hacked=true</script> {{user}}'}))});
 await page.locator('#pf-status').filter({hasText:'已读取1条'}).waitFor();assert.equal(await page.evaluate(()=>window.hacked),undefined);
 assert.equal(await page.locator('#pf-description').inputValue(),'<script>window.hacked=true</script> {{user}}');
 await page.locator('#pf-close').click();await page.getByText('打开用户设定生成器',{exact:true}).click();
 assert.match(await page.locator('#pf-description').inputValue(),/window.hacked/);
 assert.equal(await page.locator('#pf-detail-features').inputValue(),'DETAIL_VALUE_features');
 assert.equal(await page.locator('#pf-detail-count').textContent(),'25/25 已填写');
 // Read native personas into a draft, create a separate persona and explicitly select it.
 await page.locator('summary').filter({hasText:'从酒馆读取已有用户设定'}).click();
 await page.locator('#pf-existing').selectOption('original');await page.locator('#pf-load-existing').click();
 assert.equal(await page.locator('#pf-description').inputValue(),'原有设定内容');
 await page.locator('#pf-activate').check();await page.locator('#pf-install').click();await page.locator('#pf-status').filter({hasText:'已新增'}).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(fixture.power.personas).length),3);assert.notEqual(await page.evaluate(()=>fixture.selected),'original');
 assert.equal(await page.evaluate(()=>fixture.power.persona_descriptions.original.description),'原有设定内容');
 // Exercise the chat API with explicit current-character context.
 await page.locator('summary').filter({hasText:'生成参考与连接'}).click();await page.locator('#pf-mode').selectOption('chat');await page.locator('#pf-characterContext').check();
 await page.locator('#pf-generate').click();await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 assert.ok((await page.evaluate(()=>fixture.requests.at(-1))).quietPrompt.includes('CHARACTER SECRET'));
 assert.equal(await page.locator('#pf-out-name').inputValue(),'上下文用户');
 // Mobile full-page, navigation and viewport resize regressions.
 for(const size of [{width:360,height:800},{width:393,height:760},{width:320,height:568},{width:800,height:360}]){
  await page.setViewportSize(size);
  await page.locator('#pf-nav-create').click();
  assert.equal(await page.locator('.pf-window').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.locator('.pf-body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  const rect=await page.locator('#pf-overlay').boundingBox();assert.ok(Math.abs(rect.height-size.height)<=1);assert.equal(rect.y,0);
  await page.locator('#pf-nav-editor').click();assert.ok(await page.locator('#pf-out-name').isVisible());
  await page.locator('#pf-install').scrollIntoViewIfNeeded();assert.ok(await page.locator('#pf-install').isVisible());
  await page.locator('#pf-nav-drafts').click();assert.equal(await page.locator('#pf-draft-section').evaluate(el=>el.open),true);
 }
 await page.setViewportSize({width:393,height:800});
 await page.locator('#pf-nav-create').click();
 await page.screenshot({path:path.join(artifacts, 'fullpage-mobile-create.png')});
 await page.locator('#pf-detail-group-appearance > summary').click();
 await page.locator('.pf-body').evaluate(el=>{const target=el.querySelector('.pf-detail-panel');el.scrollTop+=target.getBoundingClientRect().top-el.getBoundingClientRect().top;});
 assert.equal(await page.locator('.pf-body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:path.join(artifacts, 'fullpage-mobile-details.png')});
 await page.locator('#pf-template').click();
 assert.ok((await page.locator('#pf-out-name').boundingBox()).y<400);
 await page.screenshot({path:path.join(artifacts, 'fullpage-mobile-editor.png')});
 await page.locator('#pf-close').click();assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 await page.getByText('打开用户设定生成器',{exact:true}).click();
 assert.equal(await page.locator('#pf-page-content').evaluate(el=>el.scrollTop),0);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#pf-overlay').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,artifacts,checks:['25 optional detail inputs','facts in template and AI request','detail clear and undo','detail persistence','full dossier length','desktop mount','20 selectable world templates','gender dropdown','custom gender','legacy gender migration','template','draft','native JSON export','actual browser multipart upload','no auto-switch by default','upload failure preserves persona count','AI failure preserves editor','AI object API','opt-in character context','JSON import/XSS','reopen persistence','full-viewport native modal','hostile theme isolation','transformed body isolation','320/360/393px and landscape layouts','section navigation','reduced viewport height','scroll restoration','automatic editor reveal','Escape close'],uploads,pageErrors:errors},null,2));
} catch(e){console.log(await page.locator('#pf-status').textContent());console.log(await page.evaluate(()=>fixture.requests));console.log(errors);await page.screenshot({path:path.join(artifacts, 'fullpage-failure.png')});throw e;} finally {await browser.close();server.close();}

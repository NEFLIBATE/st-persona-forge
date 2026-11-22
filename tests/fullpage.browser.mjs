import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { THEMES, DETAIL_GROUPS, DETAIL_FIELDS, getGenerationBudget } from '../core.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base=fileURLToPath(new URL('../', import.meta.url));
const artifacts=await fs.mkdtemp(path.join(tmpdir(), 'persona-forge-ui-'));
const mock = `
window.fixture={failAI:false,failUpload:false,override:null,selected:'original',saves:0,requests:[]};
const power={personas:{original:'原有用户'},persona_descriptions:{original:{description:'原有设定内容',title:'原设定'}},default_persona:'original'};
const subscribers={};
fixture.emit=(name)=>{for(const fn of subscribers[name]||[])fn();};
const c={chatId:'first-chat',chat:[],powerUserSettings:power,extensionSettings:{st_persona_forge_v1:{form:{gender:'旧版自填性别',details:{features:'旧版灰瞳',hooks:'旧版迟来的信'}}}},onlineStatus:'connected',characters:[{avatar:'current.png',name:'对手角色',description:'CHARACTER SECRET',scenario:'world'},{avatar:'cloud.png',name:'云霁',shallow:true},{avatar:'world.png',name:'暮色群岛',data:{tags:['大世界'],description:'你是世界主持人，玩家可以自由探索地图和各方势力。'}}],getWorldInfoNames:()=>['青岚城','北境'],loadWorldInfo:async name=>fixture.books[name],characterId:0,getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'test'}),saveSettingsDebounced:()=>fixture.saves++,eventTypes:{APP_READY:'ready',CHAT_CHANGED:'chat_changed',MESSAGE_RECEIVED:'message_received'},eventSource:{on:(event,fn)=>{if(event==='ready')queueMicrotask(fn);else(subscribers[event]??=[]).push(fn);}},SlashCommand:{fromProps:x=>x},SlashCommandParser:{addCommandObject:x=>window.command=x},generateRaw:async(options={})=>{fixture.requests.push(options);if(fixture.failAI)throw new Error('模拟模型连接失败');if(fixture.override!==null)return fixture.override;return ['[PERSONA_NAME]','AI 林澈','[PERSONA_TITLE]','生成结果','[PERSONA_DESCRIPTION]','由AI生成的完整用户设定 {{user}} 与 {{char}}。'].join('\\n');},generateQuietPrompt:async(options={})=>{fixture.requests.push(options);return JSON.stringify({name:'上下文用户',description:'chat result'});}};
window.SillyTavern={getContext:()=>c};window.fixture.power=power;
fixture.books={
 '青岚城':{entries:{42:{comment:'药铺与居民',key:['医疗'],content:'柳掌柜经营药铺，阿芷经常来帮忙。NPC_LORE_A'},43:{comment:'未选区域',content:'UNSELECTED_LORE'}}},
 '北境':{entries:{0:{comment:'北境驿站',content:'NORTH_LORE'}}}
};
`;
const pm = `export async function initPersona(id,name,description,title){fixture.power.personas[id]=name;fixture.power.persona_descriptions[id]={description,title};} export async function getUserAvatars(){return Object.keys(fixture.power.personas);}export async function setUserAvatar(id){fixture.selected=id;}`;
const server=createServer(async(req,res)=>{
try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/scripts/extensions/third-party/st-persona-forge/style.css"></head><body style="margin:0;background:#eee;transform:translateZ(0);font-size:30px"><style>input,textarea,select{background:#fff8ed!important;color:#2b241b!important;font-size:32px!important}dialog{max-height:450px!important;margin:40px!important}section{max-height:500px!important}</style><div id="extensions_settings2"></div><script>${mock}</script><script type="module" src="/scripts/extensions/third-party/st-persona-forge/index.js"></script></body></html>`);return;}
 if(req.url==='/scripts/personas.js'){res.setHeader('Content-Type','text/javascript');res.end(pm);return;}
 if(req.url==='/api/characters/get'){
  let body=''; for await (const chunk of req) body+=chunk;
  if(req.headers['x-csrf-token']!=='test'||JSON.parse(body).avatar_url!=='cloud.png'){res.statusCode=400;res.end();return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({name:'云霁',data:{name:'云霁',description:'SECOND_CARD',first_mes:'MAIN_GREETING',alternate_greetings:['GREETING_ONE','GREETING_TWO'],group_only_greetings:['GROUP_GREETING'],extensions:{world:'青岚城'},character_book:{name:'旅行札记',entries:[{id:7,comment:'旧桥',keys:['桥'],content:'EMBEDDED_LORE'}]}}}));return;
 }
 const prefix='/scripts/extensions/third-party/st-persona-forge/';
 if(req.url.startsWith(prefix)) {const file=req.url.slice(prefix.length).split('?')[0];if(!['index.js','core.js','catalog.js','references.js','play-context.js','style.css'].includes(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(base+'/'+file));return;}
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
 assert.equal(await page.locator('#pf-theme option').count(),Object.keys(THEMES).length);
 for(const [key, theme] of Object.entries(THEMES)){
  await page.locator('#pf-theme').selectOption(key);await page.locator('#pf-template').click();
  const description=await page.locator('#pf-description').inputValue();
  assert.ok(description.includes(theme[0]));assert.ok(description.includes('性别：女'));assert.ok(!description.includes('称谓'));
 }
 await page.locator('#pf-gender').selectOption('自定义');
 await page.locator('#pf-genderCustom').fill('流体性别');await page.locator('#pf-template').click();
 assert.ok((await page.locator('#pf-description').inputValue()).includes('性别：流体性别'));
 await page.locator('#pf-gender').selectOption('女');await page.locator('#pf-theme').selectOption('modern');
 // The catalogue offers search, theme recommendations, multi-select and custom worlds.
 await page.locator('#pf-identity-picker > summary').click();
 await page.locator('#pf-identity-options').getByRole('button',{name:'咖啡师',exact:true}).click();
 assert.equal(await page.locator('#pf-identity').inputValue(),'咖啡师');
 await page.locator('#pf-theme').selectOption('space');
 assert.equal(await page.locator('#pf-identity').inputValue(),'咖啡师');
 assert.equal(await page.locator('#pf-identity-options').getByRole('button',{name:'咖啡师',exact:true}).count(),0);
 await page.locator('#pf-identity-search').fill('飞船');
 await page.locator('#pf-identity-options').getByRole('button',{name:'飞船领航员',exact:true}).click();
 assert.equal(await page.locator('#pf-identity').inputValue(),'飞船领航员');
 await page.locator('#pf-identity-category').selectOption('all');
 await page.locator('#pf-identity-search').fill('no-such-option');
 assert.match(await page.locator('#pf-identity-results').textContent(),/没有匹配/);
 assert.equal(await page.locator('#pf-identity').inputValue(),'飞船领航员');
 await page.locator('#pf-identity-search').fill('');
 assert.equal(await page.locator('#pf-identity-options button').count(),36);
 await page.locator('#pf-identity-more').click();
 assert.equal(await page.locator('#pf-identity-options button').count(),72);
 await page.locator('#pf-identity-category').selectOption('ancient');
 assert.equal(await page.locator('#pf-identity-options button').count(),12);
 await page.locator('#pf-identity-picker > summary').click();
 await page.locator('#pf-traits').fill('自定义气质');
 await page.locator('#pf-traits-picker > summary').click();
 await page.locator('#pf-traits-search').fill('慢热');
 const traitButton = page.locator('#pf-traits-options').getByRole('button',{name:'慢热',exact:true});
 await traitButton.click();assert.equal(await page.locator('#pf-traits').inputValue(),'自定义气质、慢热');
 assert.equal(await traitButton.getAttribute('aria-pressed'),'true');
 await traitButton.click();assert.equal(await page.locator('#pf-traits').inputValue(),'自定义气质');
 await traitButton.click();
 await page.locator('#pf-traits-picker > summary').click();
 await page.locator('#pf-relation-picker > summary').click();
 await page.locator('#pf-relation-category').selectOption('rivals');
 await page.locator('#pf-relation-options').getByRole('button',{name:'同一行业的竞争者',exact:true}).click();
 assert.equal(await page.locator('#pf-relation').inputValue(),'同一行业的竞争者');
 await page.locator('#pf-relation-picker > summary').click();
 await page.locator('#pf-theme').selectOption('custom');
 assert.equal(await page.locator('#pf-theme-custom-field').isVisible(),true);
 await page.locator('#pf-themeCustom').fill('海底古城与蒸汽机械');
 await page.locator('#pf-template').click();
 const customDescription=await page.locator('#pf-description').inputValue();
 for(const fact of ['海底古城与蒸汽机械','飞船领航员','自定义气质','慢热','同一行业的竞争者'])assert.ok(customDescription.includes(fact));
 await page.locator('#pf-generate').click();await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 const customRequest=await page.evaluate(()=>fixture.requests.at(-1).prompt);
 for(const fact of ['海底古城与蒸汽机械','飞船领航员','自定义气质','慢热','同一行业的竞争者'])assert.ok(customRequest.includes(fact));
 await page.locator('#pf-close').click();await page.getByText('打开用户设定生成器',{exact:true}).click();
 assert.equal(await page.locator('#pf-themeCustom').inputValue(),'海底古城与蒸汽机械');
 assert.equal(await page.locator('#pf-identity').inputValue(),'飞船领航员');
 assert.equal(await page.locator('#pf-traits').inputValue(),'自定义气质、慢热');
 assert.equal(await page.locator('#pf-relation').inputValue(),'同一行业的竞争者');
 await page.locator('#pf-theme').selectOption('modern');
 assert.equal(await page.locator('#pf-theme-custom-field').isVisible(),false);
 await page.locator('#pf-identity').fill('');await page.locator('#pf-traits').fill('');await page.locator('#pf-relation').fill('');
 // Old detail facts migrate intact. Filters are views, never generation exclusions.
 assert.equal(await page.locator('#pf-detail-features').inputValue(),'旧版灰瞳');
 assert.equal(await page.locator('#pf-detail-count').textContent(),`2/${DETAIL_FIELDS.length} 已填写`);
 await page.locator('#pf-detail-filled').check();
 assert.equal(await page.locator('.pf-detail-panel textarea:visible').count(),2);
 await page.locator('#pf-detail-search').fill('灰瞳');
 assert.equal(await page.locator('.pf-detail-panel textarea:visible').count(),1);
 await page.locator('#pf-detail-search').fill('no-such-field');
 assert.equal(await page.locator('.pf-detail-panel textarea:visible').count(),0);
 assert.match(await page.locator('#pf-detail-results').textContent(),/没有匹配/);
 await page.locator('#pf-detail-search').fill('');await page.locator('#pf-detail-filled').uncheck();
 assert.equal(await page.locator('.pf-detail-panel details[open]').count(),0);
 await page.locator('#pf-expand-details').click();
 assert.equal(await page.locator('.pf-detail-panel textarea:visible').count(),DETAIL_FIELDS.length);
 await page.locator('#pf-collapse-details').click();
 assert.equal(await page.locator('.pf-detail-panel details[open]').count(),0);
 await page.locator('#pf-detail-search').fill('能力');
 await page.locator('#pf-detail-jump').selectOption('daily');
 assert.equal(await page.locator('#pf-detail-search').inputValue(),'');
 assert.equal(await page.locator('#pf-detail-group-daily').evaluate(el=>el.open),true);
 assert.equal(await page.locator('#pf-detail-group-daily > summary').evaluate(el=>el.getRootNode().activeElement===el),true);
 await page.locator('#pf-collapse-details').click();
 // Each optional fact has a real input and participates in both output routes.
 for(const group of DETAIL_GROUPS){
  await page.locator('#pf-detail-group-'+group.id+' > summary').click();
  for(const [key] of group.fields) await page.locator('#pf-detail-'+key).fill('DETAIL_VALUE_'+key);
  await page.locator('#pf-detail-group-'+group.id+' > summary').click();
 }
 assert.equal(await page.locator('#pf-detail-count').textContent(),`${DETAIL_FIELDS.length}/${DETAIL_FIELDS.length} 已填写`);
 await page.locator('#pf-clear-details').click();assert.equal(await page.locator('#pf-detail-count').textContent(),`0/${DETAIL_FIELDS.length} 已填写`);
 assert.equal(await page.locator('#pf-detail-features').inputValue(),'');
 await page.locator('#pf-clear-details').click();assert.equal(await page.locator('#pf-detail-features').inputValue(),'DETAIL_VALUE_features');
 assert.equal(await page.locator('#pf-detail-count').textContent(),`${DETAIL_FIELDS.length}/${DETAIL_FIELDS.length} 已填写`);
 await page.locator('#pf-length').selectOption('ultra');
 await page.locator('#pf-detail-search').fill('声音');
 await page.locator('#pf-template').click();
 await page.locator('#pf-detail-search').fill('');
 for(const [key] of DETAIL_FIELDS) assert.ok((await page.locator('#pf-description').inputValue()).includes('DETAIL_VALUE_'+key));
 assert.ok((await page.locator('#pf-description').inputValue()).length>200);
 await page.locator('#pf-out-name').fill('林澈');
 await page.locator('#pf-save').click();
 await page.screenshot({path:path.join(artifacts, 'fullpage-desktop.png')});
 // Full-page layout is isolated from hostile themes and transformed page ancestors.
 assert.deepEqual(await page.locator('#pf-overlay').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,modal:el.matches(':modal')};}),{x:0,y:0,width:1360,height:1000,modal:true});
 assert.equal(await page.locator('#pf-name').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(11, 28, 21)');
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
 const request=await page.evaluate(()=>fixture.requests.at(-1));assert.equal(request.responseLength,getGenerationBudget('ultra'));for(const [key] of DETAIL_FIELDS)assert.ok(request.prompt.includes('DETAIL_VALUE_'+key));assert.ok(!request.prompt.includes('CHARACTER SECRET'));assert.ok(request.prompt.includes('\"性别\": \"女\"'));assert.ok(!request.prompt.includes('称谓'));
 // Reproduce the incomplete-JSON screenshot without making an automatic retry.
 const cutResponse='{"name":"恢复草稿","title":"测试","description":"已经生成的正文\\n末尾尚未';
 let calls=await page.evaluate(()=>fixture.requests.length);
 await page.evaluate(value=>fixture.override=value,cutResponse);await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'可能被截断'}).waitFor();
 assert.equal(await page.locator('#pf-description').inputValue(),'已经生成的正文\n末尾尚未');
 assert.equal(await page.locator('#pf-raw-output').inputValue(),cutResponse);
 assert.equal(await page.evaluate(()=>fixture.requests.length),calls+1);
 const multiline='{"name":"格式恢复","description":"第一行\n他说："你好"。"}';
 await page.evaluate(value=>fixture.override=value,multiline);await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'格式不规范'}).waitFor();
 assert.equal(await page.locator('#pf-description').inputValue(),'第一行\n他说："你好"。');
 const beforeInvalid=await page.locator('#pf-description').inputValue();
 await page.evaluate(()=>fixture.override='{"name":"没有正文"}');await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'未返回可恢复'}).waitFor();
 assert.equal(await page.locator('#pf-description').inputValue(),beforeInvalid);
 assert.equal(await page.locator('#pf-raw-output').inputValue(),'{"name":"没有正文"}');
 const diagnosticResponse='[PERSONA_NAME]\n输出测试\n[PERSONA_TITLE]\n测试\n[PERSONA_DESCRIPTION]\n<script>window.hacked=true</script> {{user}}';
 await page.evaluate(value=>fixture.override=value,diagnosticResponse);await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();assert.equal(await page.evaluate(()=>window.hacked),undefined);
 await page.locator('#pf-model-output > summary').click();
 const rawDownloaded=page.waitForEvent('download');await page.locator('#pf-download-output').click();const rawFile=await rawDownloaded;
 assert.equal(await fs.readFile(await rawFile.path(),'utf8'),diagnosticResponse);
 await page.evaluate(()=>fixture.override=null);
 // Import HTML-looking content only as textarea text.
 await page.locator('#pf-file').setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'<img src=x onerror=alert(1)>',description:'<script>window.hacked=true</script> {{user}}'}))});
 await page.locator('#pf-status').filter({hasText:'已读取1条'}).waitFor();assert.equal(await page.evaluate(()=>window.hacked),undefined);
 assert.equal(await page.locator('#pf-description').inputValue(),'<script>window.hacked=true</script> {{user}}');
 await page.locator('#pf-close').click();await page.getByText('打开用户设定生成器',{exact:true}).click();
 assert.match(await page.locator('#pf-description').inputValue(),/window.hacked/);
 assert.equal(await page.locator('#pf-raw-output').inputValue(),diagnosticResponse);
 assert.equal(await page.locator('#pf-detail-features').inputValue(),'DETAIL_VALUE_features');
 assert.equal(await page.locator('#pf-detail-count').textContent(),`${DETAIL_FIELDS.length}/${DETAIL_FIELDS.length} 已填写`);
 // Read native personas into a draft, create a separate persona and explicitly select it.
 await page.locator('summary').filter({hasText:'从酒馆读取已有用户设定'}).click();
 await page.locator('#pf-existing').selectOption('original');await page.locator('#pf-load-existing').click();
 assert.equal(await page.locator('#pf-description').inputValue(),'原有设定内容');
 await page.locator('#pf-activate').check();await page.locator('#pf-install').click();await page.locator('#pf-status').filter({hasText:'已新增'}).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(fixture.power.personas).length),3);assert.notEqual(await page.evaluate(()=>fixture.selected),'original');
 assert.equal(await page.evaluate(()=>fixture.power.persona_descriptions.original.description),'原有设定内容');
 // Exercise the chat API with explicit current-character context.
 await page.locator('summary').filter({hasText:'生成参考与连接'}).click();await page.locator('#pf-mode').selectOption('chat');await page.locator('#pf-reference-panel > summary').click();await page.locator('#pf-characterContext').check();
 await page.locator('#pf-generate').click();await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 assert.ok((await page.evaluate(()=>fixture.requests.at(-1))).quietPrompt.includes('CHARACTER SECRET'));
 assert.equal(await page.locator('#pf-out-name').inputValue(),'上下文用户');
 // Pick a non-active shallow card, one greeting, and NPCs from multiple books.
 await page.locator('#pf-mode').selectOption('raw');
 await page.locator('#pf-relation').fill('与云霁一起查找旧信');
 await page.locator('#pf-ref-card').selectOption('avatar:cloud.png');
 await page.locator('#pf-ref-card-status').filter({hasText:'已读取 云霁'}).waitFor();
 await page.locator('#pf-ref-card-preview > summary').click();
 assert.match(await page.locator('#pf-ref-card-text').inputValue(),/SECOND_CARD/);
 assert.equal(await page.locator('#pf-ref-greeting option').count(),5);
 await page.locator('#pf-ref-greeting').selectOption('main');
 assert.equal(await page.locator('#pf-ref-greeting-preview').inputValue(),'MAIN_GREETING');
 await page.locator('#pf-ref-greeting').selectOption('group:0');
 assert.equal(await page.locator('#pf-ref-greeting-preview').inputValue(),'GROUP_GREETING');
 await page.locator('#pf-ref-greeting').selectOption('alt:1');
 assert.equal(await page.locator('#pf-ref-greeting-preview').inputValue(),'GREETING_TWO');
 await page.locator('#pf-ref-book').selectOption('world:青岚城');
 await page.locator('#pf-ref-search').fill('阿芷');
 await page.locator('#pf-ref-entry').selectOption('42');
 assert.match(await page.locator('#pf-ref-entry-preview').inputValue(),/柳掌柜/);
 await page.locator('#pf-ref-npc-add').click();
 await page.locator('#pf-ref-npcs input').nth(0).fill('柳掌柜');
 await page.locator('#pf-ref-npcs textarea').nth(0).fill('我的药材供货人');
 await page.locator('#pf-ref-npc-add').click();
 await page.locator('#pf-ref-npcs input').nth(1).fill('阿芷');
 await page.locator('#pf-ref-npcs textarea').nth(1).fill('曾一起学过识字的邻居');
 await page.locator('#pf-ref-book').selectOption('world:北境');
 await page.locator('#pf-ref-entry').selectOption('0');
 await page.locator('#pf-ref-lore-add').click();
 await page.locator('#pf-ref-book').selectOption('embedded:avatar:cloud.png');
 await page.locator('#pf-ref-entry').selectOption('7');
 await page.locator('#pf-ref-lore-add').click();
 await page.locator('#pf-ref-manual').click();
 await page.locator('#pf-ref-npcs input').nth(2).fill('沈舟');
 await page.locator('#pf-ref-npcs textarea').nth(2).fill('儿时朋友');
 await page.locator('#pf-template').click();
 await page.locator('#pf-status').filter({hasText:'已载入中文模板'}).waitFor();
 const persona = await page.locator('#pf-description').inputValue();
 for(const value of ['备选开场白 2','与{{char}}（云霁）','柳掌柜：我的药材供货人','阿芷：曾一起学过识字的邻居','沈舟：儿时朋友']) assert.ok(persona.includes(value), value);
 assert.doesNotMatch(persona,/GREETING_TWO|EMBEDDED_LORE/);
 await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 const composedPrompt = await page.evaluate(()=>fixture.requests.at(-1).prompt);
 for(const value of ['SECOND_CARD','GREETING_TWO','NPC_LORE_A','NORTH_LORE','EMBEDDED_LORE','柳掌柜','阿芷','沈舟','与云霁一起查找旧信']) assert.ok(composedPrompt.includes(value));
 assert.equal(composedPrompt.match(/NPC_LORE_A/g).length,1);
 assert.doesNotMatch(composedPrompt,/MAIN_GREETING|GREETING_ONE|GROUP_GREETING|UNSELECTED_LORE|CHARACTER SECRET/);
 assert.equal(await page.evaluate(()=>SillyTavern.getContext().characterId),0);
 const savedRefs=await page.evaluate(()=>SillyTavern.getContext().extensionSettings.st_persona_forge_v1.references);
 assert.equal(savedRefs.greeting,'alt:1');
 assert.equal(savedRefs.npcs.length,3);
 assert.doesNotMatch(JSON.stringify(savedRefs),/GREETING_TWO|NPC_LORE_A/);
 const callsBeforeMissingLore = await page.evaluate(()=>fixture.requests.length);
 const beforeMissingLore = await page.locator('#pf-description').inputValue();
 await page.evaluate(()=>delete fixture.books['北境'].entries[0]);
 await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'找不到世界书条目'}).waitFor();
 assert.equal(await page.evaluate(()=>fixture.requests.length),callsBeforeMissingLore);
 assert.equal(await page.locator('#pf-description').inputValue(),beforeMissingLore);
 await page.getByRole('button',{name:/移除世界参考 北境/}).click();
 await page.locator('#pf-close').click();
 await page.getByText('打开用户设定生成器',{exact:true}).click();
 assert.equal(await page.locator('#pf-ref-npcs input').nth(1).inputValue(),'阿芷');
 await page.getByRole('button',{name:'解除来源',exact:true}).nth(1).click();
 assert.equal(await page.locator('#pf-ref-npcs textarea').nth(1).inputValue(),'曾一起学过识字的邻居');
 await page.setViewportSize({width:393,height:800});
 await page.locator('#pf-ref-npcs').scrollIntoViewIfNeeded();
 assert.equal(await page.locator('.pf-body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:path.join(artifacts,'references-mobile.png')});
 await page.locator('#pf-reference-panel > summary').click();
 // Preview only visible messages, explicitly add them to a raw request, and detect scope.
 await page.locator('#pf-reference-panel > summary').click();
 await page.locator('#pf-ref-card').selectOption('avatar:world.png');
 await page.locator('#pf-card-type-status').filter({hasText:'自动判断：大世界'}).waitFor();
 assert.equal(await page.getByLabel('在世界中的身份与联系',{exact:true}).inputValue(),'与云霁一起查找旧信');
 await page.locator('#pf-card-type').selectOption('multi');
 await page.locator('#pf-card-type-status').filter({hasText:'已指定：多角色'}).waitFor();
 await page.locator('#pf-template').click();
 await page.locator('#pf-status').filter({hasText:'已载入中文模板'}).waitFor();
 assert.match(await page.locator('#pf-description').inputValue(),/在群像中的位置/);
 await page.locator('#pf-card-type').selectOption('auto');
 await page.locator('#pf-card-type-status').filter({hasText:'自动判断：大世界'}).waitFor();
 await page.locator('#pf-reference-panel > summary').click();
 await page.evaluate(()=>{
    const c = SillyTavern.getContext();
    c.chat = [
       {name:'系统', is_system:true, mes:'PRIVATE_SYSTEM'},
       {name:'玩家', is_user:true, mes:'PLAYER_RECENT 我先查看地图'},
       {name:'柳掌柜', mes:'<think>PRIVATE_THOUGHT</think>NPC_RECENT 请走水路', extra:{reasoning:'HIDDEN_EXTRA'}},
       {name:'工具', mes:'TOOL_PAYLOAD', extra:{tool_invocations:[{}]}},
    ];
 });
 await page.locator('#pf-chat-panel > summary').click();
 await page.locator('#pf-chat-status').filter({hasText:'已读取 2 条消息'}).waitFor();
 const previewText = await page.locator('#pf-chat-preview').inputValue();
 assert.match(previewText,/玩家 · 玩家[\s\S]*PLAYER_RECENT[\s\S]*柳掌柜 · 角色[\s\S]*NPC_RECENT/);
 assert.doesNotMatch(previewText,/PRIVATE_SYSTEM|PRIVATE_THOUGHT|HIDDEN_EXTRA|TOOL_PAYLOAD/);
 await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 assert.doesNotMatch(await page.evaluate(()=>fixture.requests.at(-1).prompt),/PLAYER_RECENT|NPC_RECENT/);
 await page.locator('#pf-chat-include').check();
 await page.evaluate(()=>{
    SillyTavern.getContext().chat.push({name:'阿芷',mes:'NEW_VISIBLE 码头见'});
    fixture.emit('message_received');
 });
 assert.match(await page.locator('#pf-chat-preview').inputValue(),/NEW_VISIBLE/);
 await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 const withChat = await page.evaluate(()=>fixture.requests.at(-1).prompt);
 assert.match(withChat,/PLAYER_RECENT[\s\S]*NPC_RECENT[\s\S]*NEW_VISIBLE/);
 assert.match(withChat,/大世界：围绕玩家在世界中的身份/);
 assert.doesNotMatch(withChat,/PRIVATE_SYSTEM|PRIVATE_THOUGHT|HIDDEN_EXTRA|TOOL_PAYLOAD/);
 assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(SillyTavern.getContext().extensionSettings)),/PLAYER_RECENT|NPC_RECENT/);
 await page.evaluate(()=>{
    const c = SillyTavern.getContext();
    c.chatId = 'second-chat';
    c.chat = [{name:'沈舟',mes:'SECOND_CHAT_TOKEN'}];
    fixture.emit('chat_changed');
 });
 assert.equal(await page.locator('#pf-chat-include').isChecked(),false);
 assert.match(await page.locator('#pf-chat-preview').inputValue(),/SECOND_CHAT_TOKEN/);
 await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 assert.doesNotMatch(await page.evaluate(()=>fixture.requests.at(-1).prompt),/SECOND_CHAT_TOKEN|PLAYER_RECENT/);
 await page.locator('#pf-mode').selectOption('chat');
 assert.equal(await page.locator('#pf-chat-include-field').isVisible(),false);
 await page.locator('#pf-generate').click();
 await page.locator('#pf-status').filter({hasText:'生成完成'}).waitFor();
 assert.doesNotMatch(await page.evaluate(()=>fixture.requests.at(-1).quietPrompt),/当前聊天摘录|SECOND_CHAT_TOKEN/);
 await page.locator('#pf-mode').selectOption('raw');
 await page.locator('#pf-reference-panel > summary').click();
 await page.locator('#pf-ref-card').selectOption('');
 await page.evaluate(()=>{
    SillyTavern.getContext().groupId = 'test-group';
    fixture.emit('chat_changed');
 });
 await page.locator('#pf-card-type-status').filter({hasText:'自动判断：多角色'}).waitFor();
 await page.evaluate(()=>{
    delete SillyTavern.getContext().groupId;
    fixture.emit('chat_changed');
 });
 await page.locator('#pf-reference-panel > summary').click();
 await page.locator('#pf-chat-panel > summary').click();
 // Mobile full-page, navigation and viewport resize regressions.
 for(const size of [{width:360,height:800},{width:393,height:760},{width:320,height:568},{width:800,height:360}]){
  await page.setViewportSize(size);
  await page.locator('#pf-nav-create').click();
  await page.locator('#pf-identity-picker > summary').click();
  await page.locator('#pf-identity-category').selectOption('special');
  await page.locator('#pf-identity-options').getByRole('button',{name:'意外穿越的外来者',exact:true}).click();
  assert.equal(await page.locator('#pf-identity').inputValue(),'意外穿越的外来者');
  assert.equal(await page.locator('.pf-body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  if(size.width===393)await page.screenshot({path:path.join(artifacts,'fullpage-mobile-picker.png')});
  await page.locator('#pf-identity-picker > summary').click();
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
 // Capture documentation previews with fictional sample data after the regressions.
 const preview=await browser.newPage({viewport:{width:1360,height:1000}});
 await preview.goto(`http://127.0.0.1:${server.address().port}`);
 await preview.getByText('打开用户设定生成器',{exact:true}).click();
 await preview.locator('#pf-gender').selectOption('女');
 await preview.locator('#pf-name').fill('林见青');
 await preview.locator('#pf-identity').fill('经营旧书店的古籍修复师');
 await preview.locator('#pf-traits').fill('温和、慢热、善于观察、嘴硬心软');
 await preview.locator('#pf-relation').fill('因旧书里的一封留言相识');
 await preview.locator('#pf-keywords').fill('喜欢雨天和植物。正在寻找一本失踪多年的手写日记；遇到未知情况先观察，不擅长正面冲突。');
 await preview.locator('#pf-clear-details').click();
 await preview.locator('#pf-template').click();
 await preview.locator('#pf-nav-create').click();
 await preview.screenshot({path:path.join(artifacts,'forest-desktop.png')});
 await preview.setViewportSize({width:393,height:800});
 await preview.locator('#pf-nav-create').click();
 await preview.screenshot({path:path.join(artifacts,'forest-mobile.png')});
 await preview.close();
 console.log(JSON.stringify({passed:true,artifacts,checks:['marker text generation','truncated JSON recovery and warning','malformed JSON recovery','invalid response preserves editor','raw response persistence and download','one model call per click','120 optional detail inputs','facts in template and AI request','detail clear and undo','detail persistence','full dossier length','desktop mount','64 selectable world templates plus custom','192 professions','120 multi-select traits','120 relationship options','search, categories and more choices','theme recommendations preserve user input','gender dropdown','custom gender','legacy gender migration','template','draft','native JSON export','actual browser multipart upload','no auto-switch by default','upload failure preserves persona count','AI failure preserves editor','AI object API','opt-in character context','shallow cards and chosen greeting','native and embedded books','NPCs across books','missing lore preserves editor','card type auto and manual','selected chat excerpts','chat consent reset','no duplicate quiet-mode chat','JSON import/XSS','reopen persistence','full-viewport native modal','hostile theme isolation','transformed body isolation','320/360/393px and landscape layouts','section navigation','reduced viewport height','scroll restoration','automatic editor reveal','Escape close'],uploads,pageErrors:errors},null,2));
} catch(e){console.log(await page.locator('#pf-status').textContent());console.log(await page.evaluate(()=>({modelCalls:fixture.requests.length})));console.log(errors);await page.screenshot({path:path.join(artifacts, 'fullpage-failure.png')});throw e;} finally {await browser.close();server.close();}

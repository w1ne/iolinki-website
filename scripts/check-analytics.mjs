import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const browser = process.env.ANALYTICS_CDP_URL
  ? await chromium.connectOverCDP(process.env.ANALYTICS_CDP_URL)
  : await chromium.launch();
const origin = 'https://iolinki.com';
const key = 'iolinki-analytics-consent';
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.xml':'application/xml','.svg':'image/svg+xml'};
const contexts = [];
async function fixture({choice, signals = {}, noStorage = false, viewport} = {}) {
  const context = await browser.newContext({viewport}); contexts.push(context);
  const google = [];
  await context.route('https://iolinki.com/**', async route => {
    if (process.env.SITE_URL) return route.continue();
    try {
      const url = new URL(route.request().url());
      const p = resolve(root, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
      assert.ok(p.startsWith(root + '/'));
      await route.fulfill({body:await readFile(p),contentType:types[extname(p)] || 'application/octet-stream'});
    } catch { await route.fulfill({status:404,body:'not found'}); }
  });
  await context.route(/https:\/\/[^/]*(googletagmanager|google-analytics)\.com\//, async route => {
    google.push(route.request().url());
    await route.fulfill({contentType:'application/javascript',body:''});
  });
  await context.addInitScript(({choice,key,signals,noStorage}) => {
    for(const [name,value] of Object.entries({doNotTrack:"0",globalPrivacyControl:false,...signals})) Object.defineProperty(navigator,name,{value});
    if(choice) localStorage.setItem(key,JSON.stringify(choice));
    if(noStorage) for(const name of ['getItem','setItem']) Storage.prototype[name] = () => {throw Error('storage denied');};
  }, {choice,key,signals,noStorage});
  const page = await context.newPage();
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  return {page, google, context};
}
async function visit(f, path = '') { await f.page.goto(origin + '/' + path); }
async function events(page) {return page.evaluate(() => (window.dataLayer || []).filter(x=>x[0]==='event').map(x=>[...x]));}
const accepted = {choice:'granted',expires:Date.now()+86400000};
try {
  const f=await fixture(); await visit(f,'?token=SECRET#private');
  await f.page.getByRole('button',{name:'Accept analytics',exact:true}).waitFor({timeout:5000});
  assert.equal(f.google.length,0,'no Google before consent');
  await f.page.getByRole('button',{name:'Decline analytics',exact:true}).click();
  await f.page.reload(); assert.equal(f.google.length,0,'decline survives navigation');
  await f.page.getByRole('button',{name:'Analytics settings',exact:true}).click();
  await f.page.getByRole('button',{name:'Accept analytics',exact:true}).click();
  await f.page.waitForFunction(()=>window.dataLayer?.some(x=>x[0]==='event'));
  assert.equal(f.google.length,1,'Google loads after consent');
  let sent=await events(f.page); assert.equal(sent[0][1],'page_view');
  assert.equal(sent[0][2].page_location,origin+'/'); assert.equal(sent[0][2].page_referrer,'');
  assert.ok(!JSON.stringify(sent).includes('SECRET'));
  await f.page.evaluate(()=>window.iolinkiAnalytics.track('iodd_export',{format:'xml',filename:'PRIVATE',xml:'SECRET'}));
  sent=await events(f.page); assert.equal(sent.at(-1)[2].format,'xml');
  assert.ok(!JSON.stringify(sent).includes('PRIVATE')); assert.ok(!JSON.stringify(sent).includes('SECRET'));
  await f.page.evaluate(()=>window.iolinkiAnalytics.track('invented_event',{format:'xml'}));
  assert.equal((await events(f.page)).length,sent.length,'unknown events rejected');
  await f.page.goto(origin+'/iodd-mcp.html');
  await f.page.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.pathname==='/downloads/iolinki-agent-plugin.zip');a.addEventListener('click',e=>e.preventDefault());a.click();});
  assert.equal((await events(f.page)).at(-1)[1],'file_download');
  assert.equal((await events(f.page)).at(-1)[2].artifact,'agent-plugin');
  await f.page.evaluate(()=>{document.cookie='_ga=test; path=/';document.cookie='_ga_TEST=test; path=/; domain=.iolinki.com';});
  await f.page.getByRole('button',{name:'Analytics settings',exact:true}).click();
  await f.page.getByRole('button',{name:'Decline analytics',exact:true}).click();
  assert.equal(await f.page.evaluate(()=>document.cookie.includes('_ga')),false,'withdrawal removes cookies');
  await f.page.evaluate(()=>window.iolinkiAnalytics.track('iodd_export',{format:'xml'}));
  assert.equal((await events(f.page)).length,0,'withdrawal clears queued events and prevents collection');
  await f.page.reload(); assert.equal(f.google.length,2,'no Google after withdrawal reload');
  for(const signals of [{doNotTrack:'1'},{globalPrivacyControl:true}]) {
    const x=await fixture({choice:accepted,signals}); await visit(x);
    assert.equal(x.google.length,0,'privacy signal suppresses prior consent');
  }
  for(const path of ['?analytics_internal=1','?lw_internal=1']) {
    const x=await fixture({choice:accepted}); await visit(x,path); await x.page.goto(origin+'/hardware.html');
    assert.equal(x.google.length,0,'internal exclusion persists');
  }
  const nonprod=await fixture({choice:accepted});
  await nonprod.context.route('https://preview.example/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const file=path.endsWith('/')?'index.html':path.slice(1);
    try {await route.fulfill({body:await readFile(resolve(root,file)),contentType:types[extname(file)]||'text/plain'});}catch{await route.fulfill({status:404,body:''});}
  });
  await nonprod.page.goto('https://preview.example/');
  assert.equal(nonprod.google.length,0,'nonproduction host never collects');
  const embedded=await fixture({choice:accepted});
  await embedded.page.goto(origin+'/');
  const beforeFrame=embedded.google.length;
  await embedded.page.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/hardware.html';document.body.append(frame);});
  await embedded.page.frameLocator('iframe').locator('#analytics-choice').waitFor({state:'attached'});
  assert.equal(embedded.google.length,beforeFrame,'embedded page never collects');
  const expired=await fixture({choice:{choice:'granted',expires:1}}); await visit(expired);
  assert.equal(expired.google.length,0,'expired consent does not collect');
  assert.equal(await expired.page.getByRole('button',{name:'Accept analytics',exact:true}).isVisible(),true);
  const blocked=await fixture({noStorage:true}); await visit(blocked);
  await blocked.page.getByRole('button',{name:'Accept analytics',exact:true}).click();
  await blocked.page.waitForFunction(()=>window.dataLayer?.some(x=>x[0]==='event'));
  assert.equal(blocked.google.length,1,'storage-denied consent works for current page');
  await blocked.page.reload(); assert.equal(blocked.google.length,1,'storage-denied reload does not infer consent');
  const x=await fixture({choice:accepted,viewport:{width:320,height:800}});
  await visit(x,'iodd-editor.html?token=SECRET');
  await x.page.getByRole('button',{name:'Counter / button / LED',exact:true}).click();
  await x.page.waitForFunction(()=>window.dataLayer?.some(v=>v[1]==='iodd_create'));
  await x.page.locator('#download').click();
  await x.page.waitForFunction(()=>window.dataLayer?.some(v=>v[1]==='iodd_export'));
  const upload=Buffer.from('<broken');
  await x.page.locator('#import-file').setInputFiles({name:'PRIVATE.xml',mimeType:'application/xml',buffer:upload});
  assert.equal((await events(x.page)).filter(e=>e[1]==='iodd_import').length,0,'failed import is not success');
  const xml=await readFile(resolve(root,'assets/iodd/counter.xml'));
  await x.page.locator('#import-file').setInputFiles({name:'PRIVATE.xml',mimeType:'application/xml',buffer:xml});
  await x.page.waitForFunction(()=>window.dataLayer?.some(v=>v[1]==='iodd_import'));
  assert.ok(!JSON.stringify(await events(x.page)).includes('PRIVATE'));
  await x.page.goto(origin+'/iodd-mcp.html');
  await x.page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}}));
  await x.page.locator('[data-copy="client-config"]').click();
  await x.page.waitForFunction(()=>window.dataLayer?.some(v=>v[1]==='mcp_setup_copy'));
  const copies=(await events(x.page)).filter(e=>e[1]==='mcp_setup_copy').length;
  await x.page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));
  await x.page.locator('[data-copy="client-config"]').click();
  assert.equal((await events(x.page)).filter(e=>e[1]==='mcp_setup_copy').length,copies,'failed copy is not success');
  await x.page.goto(origin+'/purchase-success.html?session_id=SECRET');
  assert.equal((await events(x.page)).filter(e=>e[1]==='purchase').length,0,'success URL cannot prove payment');
  await x.page.goto(origin+'/docs/');
  assert.equal((await events(x.page))[0]?.[1],'page_view','documentation uses shared analytics');
  await x.page.getByRole('button',{name:'Analytics settings',exact:true}).click();
  assert.ok(await x.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile consent fits');
  console.log('PASS consent, withdrawal, expiry, storage failure, DNT/GPC, staff exclusion, sanitized payloads, editor outcomes, setup and docs');
} finally {
  for(const c of contexts) await c.close();
  if(!process.env.ANALYTICS_CDP_URL) await browser.close();
  else await browser.close(); // CDP disconnect leaves the existing Chrome process running.
}

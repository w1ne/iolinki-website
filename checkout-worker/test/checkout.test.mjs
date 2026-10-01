import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import Stripe from 'stripe';
const endpoint='https://checkout.example';
const origin='http://localhost';
const secret='whsec_checkout_fixture_only';
const text='Fixture purchase terms for automated tests only. Perpetual rights to the licensed version.';
const terms={approved:true,scopeModel:'business-family-v3',version:'fixture-v1',sha256:createHash('sha256').update(text).digest('hex'),text,url:origin+'/terms/fixture-v1.html'};
const base={PURCHASES_ENABLED:'true',DELIVERY_ENABLED:'true',MODE:'test',SITE_ORIGIN:origin,STRIPE_SECRET_KEY:'sk_test_fixture_only',STRIPE_WEBHOOK_SECRET:secret,SINGLE_PRICE_ID:'price_single',TEAM_PRICE_ID:'price_team',TERMS_JSON:JSON.stringify(terms),ISSUER_JSON:JSON.stringify({name:'Fixture Merchant',address:'Fixture address',email:'issuer@example.com'}),TAX_POLICY:'none',LICENSED_VERSION:'fixture-version',OWNER_EMAIL:'owner@example.com',EMAIL_FROM:'Fixture Merchant <licenses@example.com>',EMAIL_API_KEY:'re_fixture_only'};
let bundle;
before(async()=>{const result=await build({stdin:{contents:"import Worker from './src/index'; export default class extends Worker {async fetch(r){if(new URL(r.url).pathname==='/__test_delivery'){await this.scheduled();return new Response('done');}return super.fetch(r);}}",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:*'],loader:{'.ttf':'binary'}});bundle=result.outputFiles[0].text;});
const payment=(order,tier='single',overrides={})=>({id:'cs_test_'+order,object:'checkout.session',livemode:false,mode:'payment',payment_status:'paid',metadata:{order_id:order},status:'open',url:'https://checkout.stripe.com/c/pay/'+order,currency:'eur',amount_subtotal:tier==='single'?139900:469900,amount_total:tier==='single'?139900:469900,total_details:{amount_discount:0,amount_tax:0},line_items:{data:[{quantity:1,price:{id:'price_'+tier,currency:'eur',unit_amount:tier==='single'?139900:469900,livemode:false}}],has_more:false},customer_details:{email:'buyer@example.com',name:'Zoë Example — Тест'},payment_intent:{id:'pi_test_'+order,status:'succeeded',currency:'eur',amount_received:tier==='single'?139900:469900,latest_charge:{id:'ch_test_'+order,receipt_url:'https://pay.stripe.com/receipts/fixture'}},...overrides});
async function fixture(bindings={},sessionOverride={}) {
 const sent=[],requests=[]; let failEmails=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{...base,...bindings},outboundService:async req=>{
  const url=new URL(req.url);requests.push({url:url.href,method:req.method});
  if(url.hostname==='api.stripe.com') {
   if(url.pathname.startsWith('/v1/prices/')) {const tier=url.pathname.includes('team')?'team':'single';return Response.json({id:'price_'+tier,object:'price',active:true,livemode:false,currency:'eur',unit_amount:tier==='single'?139900:469900,recurring:null});}
   if(req.method==='POST') {const body=new URLSearchParams(await req.text());requests.at(-1).body=body; const order=body.get('metadata[order_id]');return Response.json({id:'cs_test_'+order,status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/'+order});}
   const order=url.pathname.split('/').at(-1).replace('cs_test_','');const row=await (await mf.getD1Database('DB')).prepare('SELECT tier FROM orders WHERE id=?').bind(order).first();return Response.json(payment(order,row?.tier,sessionOverride));
  }
  if(url.hostname==='api.resend.com') {const message=await req.json();sent.push({message,key:req.headers.get('Idempotency-Key')});if(failEmails-->0)return Response.json({error:'temporary'}, {status:503});return Response.json({id:'email_'+sent.length});}
  throw Error('Unexpected outbound request '+url);
 }}));
 const db=await mf.getD1Database('DB');for(const file of ['0001_checkout.sql','0002_approved_quotes.sql','0003_business_quote_scope.sql'])await db.exec((await readFile('migrations/'+file,'utf8')).replace(/^--.*$/gm,'').replaceAll('\n',' '));
 const api=await mf.getWorker();
 const post=(path,body,headers={})=>api.fetch(endpoint+path,{method:'POST',headers:{Origin:origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const acceptedTerms=JSON.parse(bindings.TERMS_JSON??base.TERMS_JSON);
 const checkout=async(tier='single',id=randomUUID(),holder={kind:'company',name:'Example Devices Ltd',contact:'Contact Engineer'},productFamily='Range Alpha',quoteReference='quote_'+id)=>{
 const normalized={...holder,name:holder.name.trim(),...(holder.contact?{contact:holder.contact.trim()}:{})};
 await db.prepare('INSERT INTO approved_quotes(id,tier,holder,family_name,family_scope,approved_at,expires_at,scope_model) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(quoteReference,tier,JSON.stringify(normalized),'Range Alpha','Named commercial range Alpha, including its variants, successors and hardware revisions. Unrelated lines excluded.',Date.now(),Date.now()+3600000,'business-family-v3').run();
 const response=await post('/checkout',{tier,holder,productFamily,quoteReference,attemptId:id,termsVersion:acceptedTerms.version,termsHash:acceptedTerms.sha256,acceptTerms:true});return {id,response,data:await response.json()};};
 const webhook=async(order,eventId='evt_'+randomUUID(),type='checkout.session.completed')=>{const payload=JSON.stringify({id:eventId,object:'event',type,livemode:false,data:{object:{id:'cs_test_'+order}}});const signature=Stripe.webhooks.generateTestHeaderString({payload,secret});return api.fetch(endpoint+'/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':signature},body:payload});};
 return {mf,db,api,post,checkout,webhook,requests,sent,setFailEmails:n=>{failEmails=n;}};
}
async function withFixture(fn,bindings={},session={}) {const f=await fixture(bindings,session);try{await fn(f);}finally{await f.mf.dispose();}}
test('missing approved terms closes checkout without a Stripe request',()=>withFixture(async f=>{const r=await f.checkout();assert.equal(r.response.status,503);assert.equal(f.requests.length,0);},{TERMS_JSON:'{}'}));
test('live mode requires separate explicit activation',()=>withFixture(async f=>{const r=await f.checkout();assert.equal(r.response.status,503);},{MODE:'live',STRIPE_SECRET_KEY:'sk_live_fixture'}));
test('checkout controls product, quantity and redirect and reuses an attempt',()=>withFixture(async f=>{
 const id=randomUUID();const a=await f.checkout('team',id);assert.equal(a.response.status,200);assert.equal(a.data.url.startsWith('https://checkout.stripe.com/'),true);const b=await f.checkout('team',id);assert.equal(b.data.url,a.data.url);const calls=f.requests.filter(x=>x.method==='POST');assert.equal(calls.length,1);assert.equal(calls[0].body.get('line_items[0][price]'),'price_team');assert.equal(calls[0].body.get('line_items[0][quantity]'),'1');assert.equal(calls[0].body.get('success_url'),origin+'/purchase-success.html');
 const rejected=await f.post('/checkout',{tier:'single',attemptId:randomUUID(),termsVersion:terms.version,termsHash:terms.sha256,acceptTerms:true,amount:1});assert.equal(rejected.status,400);
 const stale=await f.post('/checkout',{tier:'single',attemptId:randomUUID(),termsVersion:'stale',termsHash:terms.sha256,acceptTerms:true});assert.equal(stale.status,400);
},{},{payment_status:'unpaid'}));
test('signed paid webhook atomically issues one license under concurrent and distinct events',()=>withFixture(async f=>{
 const {id}=await f.checkout();const responses=await Promise.all([f.webhook(id,'evt_one'),f.webhook(id,'evt_one'),f.webhook(id,'evt_two')]);for(const r of responses)assert.equal(r.status,200);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM licenses').first()).n,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM delivery_jobs').first()).n,2);
}));
test('raw signature verification rejects modified and stale bodies',()=>withFixture(async f=>{
 const payload=JSON.stringify({id:'evt_x',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_unknown'}}});let h=Stripe.webhooks.generateTestHeaderString({payload,secret});let r=await f.api.fetch(endpoint+'/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':h},body:payload+' '});assert.equal(r.status,400);
 h=Stripe.webhooks.generateTestHeaderString({payload,secret,timestamp:1});r=await f.api.fetch(endpoint+'/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':h},body:payload});assert.equal(r.status,400);assert.equal(f.requests.length,0);
}));
for(const [name,changes] of [['unpaid',{payment_status:'unpaid'}],['wrong quantity',{line_items:{data:[{quantity:2,price:{id:'price_single',currency:'eur',unit_amount:139900,livemode:false}}],has_more:false}}],['wrong mode',{livemode:true}],['wrong total',{amount_total:1}],['wrong currency',{currency:'usd'}]])test('does not issue for '+name,()=>withFixture(async f=>{const{id}=await f.checkout();const r=await f.webhook(id);assert.equal(r.status,200);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM licenses').first()).n,0);},{},changes));
test('outbox retries failures and produces a Unicode PDF plus receipt',()=>withFixture(async f=>{
 const{id}=await f.checkout();assert.equal((await f.webhook(id)).status,200);f.setFailEmails(1);await f.api.fetch(endpoint+'/__test_delivery');assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM delivery_jobs WHERE state='sent'").first()).n,1);await f.db.prepare("UPDATE delivery_jobs SET next_attempt=0 WHERE state='pending'").run();await f.api.fetch(endpoint+'/__test_delivery');assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM delivery_jobs WHERE state='sent'").first()).n,2);const buyer=f.sent.find(x=>x.message.to[0]==='buyer@example.com');assert.match(buyer.message.text,/https:\/\/pay.stripe.com\/receipts\/fixture/);const attempts=f.sent.filter(x=>x.message.to[0]==='buyer@example.com');assert.equal(attempts.length,2);assert.equal(attempts[0].key,attempts[1].key);assert.equal(attempts[0].message.attachments[0].content,attempts[1].message.attachments[0].content,'retry must use identical PDF bytes');const bytes=Buffer.from(buyer.message.attachments[0].content,'base64');assert.equal(bytes.subarray(0,4).toString(),'%PDF');await writeFile('/tmp/iolinki-license-test.pdf',bytes);const count=f.sent.length;await f.api.fetch(endpoint+'/__test_delivery');assert.equal(f.sent.length,count);
}));

test('buyer certificate failure on an unrenderable legacy record does not prevent owner notification',()=>withFixture(async f=>{const{id}=await f.checkout();await f.webhook(id);await f.db.prepare("UPDATE licenses SET snapshot=json_set(snapshot,'$.holder.name','Unsupported 漢字')").run();await f.api.fetch(endpoint+'/__test_delivery');const jobs=(await f.db.prepare('SELECT role,state,last_error FROM delivery_jobs').all()).results;assert.equal(jobs.find(j=>j.role==='buyer').state,'failed');assert.equal(jobs.find(j=>j.role==='owner').state,'sent');assert.equal(f.sent.length,1);}));
test('Stripe billing name outside certificate glyph coverage still delivers the named-holder certificate',()=>withFixture(async f=>{
 const{id}=await f.checkout();await f.webhook(id);await f.api.fetch(endpoint+'/__test_delivery');
 assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM delivery_jobs WHERE state='sent'").first()).n,2);
 const license=await f.db.prepare('SELECT payment FROM licenses').first();assert.equal(JSON.parse(license.payment).buyerName,'漢字');
 const buyer=f.sent.find(x=>x.message.to[0]==='buyer@example.com');const path='/tmp/iolinki-billing-script-test.pdf';await writeFile(path,Buffer.from(buyer.message.attachments[0].content,'base64'));
 const pdf=execFileSync('pdftotext',[path,'-'],{encoding:'utf8'});assert.match(pdf,/Example Devices Ltd/);assert.match(pdf,/payment receipt/);
},{},{customer_details:{name:'漢字',email:'buyer@example.com'}}));
test('merchant certificate fields must render before checkout opens',()=>withFixture(async f=>{
 const result=await f.checkout();assert.equal(result.response.status,503);assert.equal(f.requests.length,0);
},{ISSUER_JSON:JSON.stringify({name:'漢字',address:'Fixture address',email:'issuer@example.com'})}));
test('fulfillment transaction rolls back license and jobs on database failure',()=>withFixture(async f=>{const{id}=await f.checkout();await f.db.exec("CREATE TRIGGER block_delivery BEFORE INSERT ON delivery_jobs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");assert.equal((await f.webhook(id)).status,503);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM licenses').first()).n,0);assert.equal((await f.db.prepare('SELECT state FROM orders WHERE id=?').bind(id).first()).state,'pending');await f.db.exec('DROP TRIGGER block_delivery;');assert.equal((await f.webhook(id)).status,200);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM licenses').first()).n,1);}));
test('concurrent delivery handlers claim each job once',()=>withFixture(async f=>{const{id}=await f.checkout();await f.webhook(id);await Promise.all([f.api.fetch(endpoint+'/__test_delivery'),f.api.fetch(endpoint+'/__test_delivery')]);assert.equal(f.sent.length,2);assert.equal(new Set(f.sent.map(x=>x.key)).size,2);}));
test('old ambiguous delivery stops before provider idempotency expires',()=>withFixture(async f=>{const{id}=await f.checkout();await f.webhook(id);await f.db.prepare('UPDATE delivery_jobs SET first_attempt=?').bind(Date.now()-24*3600000).run();await f.api.fetch(endpoint+'/__test_delivery');assert.equal(f.sent.length,0);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM delivery_jobs WHERE state='failed'").first()).n,2);}));
test('checkout rejects unaccepted terms and cross-origin requests',()=>withFixture(async f=>{const body={tier:'single',attemptId:randomUUID(),termsVersion:terms.version,termsHash:terms.sha256,acceptTerms:false};assert.equal((await f.post('/checkout',body)).status,400);body.acceptTerms=true;assert.equal((await f.post('/checkout',body,{Origin:'https://evil.example'})).status,403);assert.equal(f.requests.length,0);}));
test('purchase attempts are rate limited before Stripe calls',()=>withFixture(async f=>{for(let i=0;i<10;i++)assert.equal((await f.checkout()).response.status,200);const count=f.requests.length;assert.equal((await f.checkout()).response.status,429);assert.equal(f.requests.length,count);}));
test('paid or quarantined attempts never return a fresh payment URL',()=>withFixture(async f=>{const{id}=await f.checkout();await f.webhook(id);await f.db.prepare('UPDATE orders SET checkout_url=NULL WHERE id=?').bind(id).run();const count=f.requests.length;assert.equal((await f.checkout('single',id)).response.status,409);assert.equal(f.requests.length,count);await f.db.prepare("UPDATE orders SET state='quarantined' WHERE id=?").bind(id).run();assert.equal((await f.checkout('single',id)).response.status,409);}));
test('unresolved attempts stop before Stripe idempotency expiration',()=>withFixture(async f=>{const{id}=await f.checkout();await f.db.prepare('UPDATE orders SET session_id=NULL,checkout_url=NULL,created_at=? WHERE id=?').bind(Date.now()-24*3600000,id).run();const count=f.requests.length;assert.equal((await f.checkout('single',id)).response.status,409);assert.equal(f.requests.length,count);}));

test('checkout never exposes a new URL when its database link is not saved',()=>withFixture(async f=>{await f.db.exec("CREATE TRIGGER block_order_link BEFORE UPDATE OF checkout_url ON orders BEGIN SELECT RAISE(IGNORE); END;");const{id,response}=await f.checkout();assert.equal(response.status,503);assert.equal((await f.db.prepare('SELECT session_id FROM orders WHERE id=?').bind(id).first()).session_id,null);}));
test('recorded open checkout is recovered without another creation',()=>withFixture(async f=>{const{id}=await f.checkout();await f.db.prepare('UPDATE orders SET checkout_url=NULL WHERE id=?').bind(id).run();assert.equal((await f.checkout('single',id)).response.status,200);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);},{},{payment_status:'unpaid'}));
test('expired recorded checkout is rejected without another creation',()=>withFixture(async f=>{const{id}=await f.checkout();assert.equal((await f.checkout('single',id)).response.status,503);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);},{},{status:'expired',payment_status:'unpaid'}));

const purchaseBody=(tier,holder,attemptId=randomUUID())=>({tier,holder,attemptId,termsVersion:terms.version,termsHash:terms.sha256,acceptTerms:true});
test('requires the correct named holder before creating an order or contacting Stripe',()=>withFixture(async f=>{
 for(const [tier,holder] of [['single',undefined],['single',{kind:'company',name:'Company',contact:'Person'}],['single',{kind:'individual',name:' '}],['single',{kind:'individual',name:'Name\nInjected'}],['single',{kind:'individual',name:'x'.repeat(201)}],['single',{kind:'individual',name:'Name',contact:'Other'}],['single',{kind:'individual',name:'张伟'}],['team',{kind:'company',name:'张伟',contact:'Contact'}],['team',{kind:'company',name:'Company',contact:'张伟'}],['team',{kind:'company',name:'Company'}],['team',{kind:'individual',name:'Person'}],['team',{kind:'company',name:'Company',contact:' '}]]) assert.equal((await f.post('/checkout',purchaseBody(tier,holder))).status,400);
 assert.equal(f.requests.length,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n,0);
}));
test('holder changes require a new attempt and cannot change accepted order snapshots',()=>withFixture(async f=>{
 const{id}=await f.checkout('single',randomUUID(),{kind:'sole-trader',name:'  Zoë Business  ',contact:'  Zoë Contact  '});
 const original=JSON.parse((await f.db.prepare('SELECT snapshot FROM orders WHERE id=?').bind(id).first()).snapshot);
 assert.deepEqual(original.holder,{kind:'sole-trader',name:'Zoë Business',contact:'Zoë Contact'});assert.equal(original.assistance.hours,2);assert.equal(original.assistance.kind,'onboarding');assert.match(original.assistance.scope,/checklist/);assert.equal(original.terms.text,text);assert.equal(original.terms.version,terms.version);assert.equal(original.terms.sha256,terms.sha256);
 assert.equal((await f.checkout('single',id,{kind:'sole-trader',name:'Other Business',contact:'Other Contact'})).response.status,409);
 await f.webhook(id);const issued=JSON.parse((await f.db.prepare('SELECT snapshot FROM licenses WHERE order_id=?').bind(id).first()).snapshot);assert.deepEqual(issued,original);
}));
for(const tier of ['single','team']) test('certificate records accepted '+tier+' holder and total assistance, distinct from payer',()=>withFixture(async f=>{
 const holder=tier==='single'?{kind:'sole-trader',name:'Zoë Business Тест',contact:'Zoë Contact Тест'}:{kind:'company',name:'Example Devices Ltd Тест',contact:'Zoë Contact Тест'};
 const{id}=await f.checkout(tier,randomUUID(),holder);await f.webhook(id);await f.api.fetch(endpoint+'/__test_delivery');
 const row=await f.db.prepare('SELECT snapshot FROM licenses WHERE order_id=?').bind(id).first();const snap=JSON.parse(row.snapshot);assert.deepEqual(snap.holder,holder);assert.equal(snap.assistance.hours,tier==='single'?2:8);
 const bytes=Buffer.from(f.sent.find(x=>x.message.to[0]==='buyer@example.com').message.attachments[0].content,'base64');const path='/tmp/iolinki-'+tier+'-holder-test.pdf';await writeFile(path,bytes);const content=execFileSync('pdftotext',[path,'-'],{encoding:'utf8'});
 assert.ok(content.includes('License holder ('+(tier==='single'?'business sole trader':'legal company')+'): '+holder.name));assert.ok(content.includes('Technical contact: '+holder.contact));assert.equal('seats' in snap,false);assert.ok(!content.includes('developer seats'));assert.match(content,/Unlimited authorized employees and contractors/);assert.match(content,/Purchaser: Zoë Example/);assert.match(content,new RegExp('Included assistance: '+(tier==='single'?2:8)+' hours'));assert.ok(content.includes('Terms version: '+terms.version));
}));

test('prepared offering stays disabled and can be rendered in a test certificate after explicit fixture approval',async()=>{
 const prepared=JSON.parse(await readFile('terms.template.json','utf8'));assert.equal(prepared.approved,false);assert.equal(prepared.sha256,createHash('sha256').update(prepared.text).digest('hex'));
 const wrangler=await readFile('wrangler.jsonc','utf8');for(const flag of ['PURCHASES_ENABLED','LIVE_PURCHASES_ENABLED','DELIVERY_ENABLED'])assert.match(wrangler,new RegExp('"'+flag+'"\\s*:\\s*"false"'));
 await withFixture(async f=>{const{id}=await f.checkout();assert.equal(id.length,36);await f.webhook(id);await f.api.fetch(endpoint+'/__test_delivery');const buyer=f.sent.find(x=>x.message.to[0]==='buyer@example.com');assert.ok(buyer,'actual prepared terms must render and deliver through the fixture');const path='/tmp/iolinki-prepared-terms-test.pdf';await writeFile(path,Buffer.from(buyer.message.attachments[0].content,'base64'));const content=execFileSync('pdftotext',[path,'-'],{encoding:'utf8'});assert.match(content,/Two onboarding hours/);assert.match(content,/Unlimited authorized employees and contractors/);assert.ok(content.replace(/\s/g,'').includes(prepared.sha256));},{TERMS_JSON:JSON.stringify({...prepared,approved:true,url:origin+'/terms/'+prepared.version+'.html'})});
});

const quotedBody=(overrides={})=>({tier:'single',holder:{kind:'company',name:'Example Devices Ltd',contact:'Contact Engineer'},productFamily:'Range Alpha',quoteReference:'quote_fixture',attemptId:randomUUID(),termsVersion:terms.version,termsHash:terms.sha256,acceptTerms:true,...overrides});
test('family and quote are mandatory and unsupported names reject before any order or Stripe call',()=>withFixture(async f=>{
 for(const fields of [{productFamily:undefined},{productFamily:''},{productFamily:'  '},{productFamily:'Range\nAll'},{productFamily:'x'.repeat(201)},{productFamily:'张伟'},{quoteReference:undefined},{quoteReference:''}])assert.equal((await f.post('/checkout',quotedBody(fields))).status,400);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n,0);assert.equal(f.requests.length,0);
}));
test('unknown, expired, revoked or mismatched quotes cannot authorize buyer scope',()=>withFixture(async f=>{
 const id=randomUUID();const quote='quote_'+id;const accepted=await f.checkout('single',id);assert.equal(accepted.response.status,200);
 for(const fields of [{quoteReference:'quote_unknown'},{holder:{kind:'company',name:'Another Company',contact:'Other Contact'}},{tier:'team',holder:{kind:'company',name:'Company',contact:'Contact'}},{productFamily:'All company products'}])assert.equal((await f.post('/checkout',quotedBody({quoteReference:quote,...fields}))).status,409);
 const count=f.requests.length;await f.db.prepare('UPDATE approved_quotes SET approved_at=1,expires_at=2 WHERE id=?').bind(quote).run();assert.equal((await f.checkout('single',id)).response.status,409);
 await f.db.prepare('UPDATE approved_quotes SET expires_at=?,revoked_at=? WHERE id=?').bind(Date.now()+3600000,Date.now(),quote).run();assert.equal((await f.checkout('single',id)).response.status,409);assert.equal(f.requests.length,count);
}));
test('approved quote scope is frozen once and paid rights survive later revocation or quote edits',()=>withFixture(async f=>{
 const id=randomUUID(),quote='quote_'+id;const accepted=await f.checkout('single',id);assert.equal(accepted.response.status,200);
 const original=JSON.parse((await f.db.prepare('SELECT snapshot FROM orders WHERE id=?').bind(id).first()).snapshot);assert.equal(original.productFamily.name,'Range Alpha');assert.match(original.productFamily.scope,/Unrelated lines excluded/);assert.equal(original.quoteReference,quote);assert.equal(original.scopeModel,'business-family-v3');
 assert.equal((await f.checkout('single',randomUUID(),{kind:'company',name:'Example Devices Ltd',contact:'Contact Engineer'},'Range Alpha',quote)).response.status,409);
 await f.db.prepare("UPDATE approved_quotes SET family_name='All products',family_scope='All future products',revoked_at=? WHERE id=?").bind(Date.now(),quote).run();
 await f.webhook(id);const issued=JSON.parse((await f.db.prepare('SELECT snapshot FROM licenses WHERE order_id=?').bind(id).first()).snapshot);assert.deepEqual(issued,original);
 await f.api.fetch(endpoint+'/__test_delivery');const buyer=f.sent.find(x=>x.message.to[0]==='buyer@example.com'),owner=f.sent.find(x=>x.message.to[0]==='owner@example.com');assert.ok(buyer);assert.ok(owner.message.text.includes('Product family: Range Alpha'));assert.ok(owner.message.text.includes(quote));assert.ok(!owner.message.text.includes('All future products'));
 const file='/tmp/iolinki-product-family-test.pdf';await writeFile(file,Buffer.from(buyer.message.attachments[0].content,'base64'));const content=execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});assert.match(content,/Product family: Range Alpha/);assert.ok(content.replace(/\s/g,'').includes(quote.replace(/\s/g,'')));assert.ok(!content.includes('All future products'));
 const request=f.requests.find(x=>x.method==='POST'&&x.url.includes('api.stripe.com'));assert.equal(request.body.get('metadata[quote_reference]'),quote);assert.equal(request.body.get('metadata[product_family]'),'Range Alpha');
}));
test('legacy accepted snapshots retain their original scope when certificates are delivered',()=>withFixture(async f=>{
 const{id}=await f.checkout();const row=await f.db.prepare('SELECT snapshot FROM orders WHERE id=?').bind(id).first();const snap=JSON.parse(row.snapshot);delete snap.productFamily;delete snap.quoteReference;delete snap.scopeModel;
 await f.db.prepare('UPDATE orders SET snapshot=? WHERE id=?').bind(JSON.stringify(snap),id).run();await f.webhook(id);await f.api.fetch(endpoint+'/__test_delivery');const buyer=f.sent.find(x=>x.message.to[0]==='buyer@example.com');assert.ok(buyer);
 const path='/tmp/iolinki-legacy-scope-test.pdf';await writeFile(path,Buffer.from(buyer.message.attachments[0].content,'base64'));assert.ok(!execFileSync('pdftotext',[path,'-'],{encoding:'utf8'}).includes('Product family:'));
}));
test('v3 family snapshot is required for automatic issuance',()=>withFixture(async f=>{
 const{id}=await f.checkout();const row=await f.db.prepare('SELECT snapshot FROM orders WHERE id=?').bind(id).first();const snap=JSON.parse(row.snapshot);delete snap.productFamily;
 await f.db.prepare('UPDATE orders SET snapshot=? WHERE id=?').bind(JSON.stringify(snap),id).run();await f.webhook(id);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM licenses').first()).n,0);assert.equal((await f.db.prepare('SELECT state FROM orders WHERE id=?').bind(id).first()).state,'quarantined');
}));

test('old terms cannot open new product-family checkout',()=>withFixture(async f=>{const result=await f.checkout();assert.equal(result.response.status,503);assert.equal(f.requests.length,0);},{TERMS_JSON:JSON.stringify({...terms,scopeModel:undefined})}));

test('personal holders and missing business contacts reject before payable orders',()=>withFixture(async f=>{
 for(const tier of ['single','team'])for(const holder of [{kind:'individual',name:'Employee'},{kind:'company',name:'Company'},{kind:'sole-trader',name:'Trader'},{kind:'sole-trader',name:'Trader',contact:' '},{kind:'sole-trader',name:'Trader',contact:'张伟'}])assert.equal((await f.post('/checkout',quotedBody({tier,holder}))).status,400);assert.equal(f.requests.length,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n,0);
}));
test('v2 approved quotes cannot authorize new v3 purchases',()=>withFixture(async f=>{
 const{id}=await f.checkout();await f.db.prepare("UPDATE approved_quotes SET scope_model='product-family-v2' WHERE id=?").bind('quote_'+id).run();const count=f.requests.length;assert.equal((await f.checkout('single',id)).response.status,409);assert.equal(f.requests.length,count);
}));
for(const tier of ['single','team'])for(const kind of ['company','sole-trader'])test(tier+' accepts '+kind+' without seats',()=>withFixture(async f=>{
 const holder={kind,name:'Zoë Business Тест',contact:'Zoë Contact Тест'};const{id,response}=await f.checkout(tier,randomUUID(),holder);assert.equal(response.status,200);const snapshot=JSON.parse((await f.db.prepare('SELECT snapshot FROM orders WHERE id=?').bind(id).first()).snapshot);assert.equal('seats' in snapshot,false);assert.equal(snapshot.label,tier==='single'?'Product Family':'Integration');assert.equal(snapshot.assistance.hours,tier==='single'?2:8);assert.equal(snapshot.scopeModel,'business-family-v3');if(tier==='team'){assert.match(snapshot.assistance.scope,/quarterly reviews during the included first year/);assert.match(snapshot.assistance.scope,/eight total scoped/);assert.match(snapshot.assistance.scope,/findings\/report/);}
 await f.webhook(id);await f.api.fetch(endpoint+'/__test_delivery');assert.ok(f.sent.find(x=>x.message.to[0]==='buyer@example.com'));
}));
for(const [tier,seats,holder,label] of [['single',1,{kind:'individual',name:'Historic Person'},'Single Developer'],['team',5,{kind:'company',name:'Historic Company',contact:'Historic Contact'},'Team']])test('historical '+label+' PDF retains accepted holder and seats',()=>withFixture(async f=>{
 const{id}=await f.checkout(tier);const row=await f.db.prepare('SELECT snapshot FROM orders WHERE id=?').bind(id).first();const snap={...JSON.parse(row.snapshot),scopeModel:'product-family-v2',holder,label,seats};await f.db.prepare('UPDATE orders SET snapshot=? WHERE id=?').bind(JSON.stringify(snap),id).run();await f.webhook(id);await f.api.fetch(endpoint+'/__test_delivery');const buyer=f.sent.find(x=>x.message.to[0]==='buyer@example.com');assert.ok(buyer);
 const file='/tmp/iolinki-historical-'+tier+'.pdf';await writeFile(file,Buffer.from(buyer.message.attachments[0].content,'base64'));const content=execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});assert.ok(content.includes(holder.name));assert.ok(content.includes('developer seats: '+seats));
}));
test('v2 accepted terms cannot open v3 checkout',()=>withFixture(async f=>{assert.equal((await f.checkout()).response.status,503);assert.equal(f.requests.length,0);},{TERMS_JSON:JSON.stringify({...terms,scopeModel:'product-family-v2'})}));

test('historical published terms and JSON archives remain immutable',async()=>{
 assert.equal(createHash('sha256').update(await readFile('terms/2026-10-01-offering-v1.json')).digest('hex'),'04c31c62fc77d192fa154d461c70fe32da4c7f3171e47ebe699b95eebd15f271');
 assert.equal(createHash('sha256').update(await readFile('terms/2026-10-01-product-family-v2.json')).digest('hex'),'bfa25658c4597e4e120d93292463be6d687120268bc776046ab95f9a6c05f3e4');
 assert.equal(createHash('sha256').update(await readFile('../terms/2026-10-01-offering-v1.html')).digest('hex'),'d0166c777cc9a2769f8f3c8b53679ae5bde48a21957ba459431b1b7692b77910');
 assert.equal(createHash('sha256').update(await readFile('../terms/2026-10-01-product-family-v2.html')).digest('hex'),'a5cee13c89b670295af8dbb5a9b2672ab429dcfce3865379aad8b4c19fe5d719');
});

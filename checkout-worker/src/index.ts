import { WorkerEntrypoint } from 'cloudflare:workers';
import Stripe from 'stripe';
import { config, email, sha256 } from './config';
import { certificate } from './certificate';
import { supportsCertificateText } from './certificate-font';
import { TIERS, type Config, type Env, type Holder, type Job, type License, type Order, type Payment, type Snapshot, type Tier } from './types';

function holderFor(tier: Tier, value: unknown): Holder | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  const name = (v: unknown): string | null => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(v) ? v.trim() : null;
  const holderName = name(fields.name);
  if (!holderName || !supportsCertificateText(holderName)) return null;
  if (tier === 'single' && fields.kind === 'individual' && Object.keys(fields).every(k => ['kind','name'].includes(k)))
    return {kind:'individual',name:holderName};
  const contact = name(fields.contact);
  if (tier === 'team' && fields.kind === 'company' && contact && supportsCertificateText(contact) && Object.keys(fields).every(k => ['kind','name','contact'].includes(k)))
    return {kind:'company',name:holderName,contact};
  return null;
}

function stripe(env: Env) {
  return new Stripe(env.STRIPE_SECRET_KEY!, {httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:1,timeout:15000});
}
function json(body: unknown,status=200,origin?:string) {
  return Response.json(body,{status,headers:{'Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
}
function validSession(session: Stripe.Checkout.Session, order: Order, snap: Snapshot): Payment | null {
  const lines=session.line_items;
  const item=lines?.data[0], price=item?.price;
  const intent=session.payment_intent;
  if (session.livemode!==snap.livemode || session.mode!=='payment' || session.metadata?.order_id!==order.id ||
      (order.session_id!==null && order.session_id!==session.id) ||
      lines?.has_more || lines?.data.length!==1 || item?.quantity!==1 || price?.id!==snap.priceId ||
      price.currency!=='eur' || price.unit_amount!==snap.amount || price.livemode!==snap.livemode || session.currency!=='eur' ||
      session.amount_subtotal!==snap.amount || session.total_details?.amount_discount!==0) return null;
  const tax=session.total_details?.amount_tax;
  if (!Number.isSafeInteger(tax) || tax!<0 || session.amount_total!==snap.amount+tax! ||
      snap.taxPolicy==='none' && tax!==0 ||
      snap.taxPolicy==='automatic-exclusive' && (!session.automatic_tax?.enabled || session.automatic_tax.status!=='complete')) return null;
  if (!email(session.customer_details?.email) || !session.customer_details?.name?.trim() || session.customer_details.name.length>500 ||
      /[\x00-\x1f\x7f]/.test(session.customer_details.name)) return null;
  if (!intent || typeof intent==='string' || intent.status!=='succeeded' || intent.currency!=='eur' || intent.amount_received!==session.amount_total) return null;
  const charge=intent.latest_charge;
  if (!charge || typeof charge==='string' || !charge.receipt_url?.startsWith('https://')) return null;
  return {sessionId:session.id,intentId:intent.id,subtotal:snap.amount,tax:tax!,total:session.amount_total!,currency:'eur',
    buyerEmail:session.customer_details.email,buyerName:session.customer_details.name,receiptUrl:charge.receipt_url};
}
async function boundedBody(request:Request,limit:number):Promise<string|null> {
  if(!request.body)return '';
  const reader=request.body.getReader(), chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return null;}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
function checkoutUrl(session:Stripe.Checkout.Session):string {
  if(session.status!=='open' || session.payment_status!=='unpaid' || !session.url)throw Error('checkout session is no longer open');
  const url=new URL(session.url);if(url.hostname!=='checkout.stripe.com' || url.protocol!=='https:')throw Error('checkout URL unavailable');return url.href;
}
async function createCheckout(request: Request, env: Env, cfg: Config) {
  if (request.headers.get('Origin')!==cfg.origin) return json({error:'Origin not allowed'},403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'JSON required'},400,cfg.origin);
  const raw=await boundedBody(request,2000);if(raw===null)return json({error:'Request too large'},413,cfg.origin);
  let body: Record<string,unknown>;
  try { body=JSON.parse(raw); } catch { return json({error:'Invalid request'},400,cfg.origin); }
  const keys=['tier','attemptId','termsVersion','termsHash','acceptTerms','holder'];
  if (!body || Array.isArray(body) || Object.keys(body).some(x=>!keys.includes(x)) ||
      !['single','team'].includes(body.tier as string) || typeof body.attemptId!=='string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.attemptId) ||
      body.acceptTerms!==true || body.termsVersion!==cfg.terms.version || body.termsHash!==cfg.terms.sha256)
    return json({error:'Select a license and accept the current purchase terms'},400,cfg.origin);
  const tier=body.tier as Tier,id=body.attemptId.toLowerCase();
  const holder=holderFor(tier,body.holder);
  if (!holder) return json({error:'Single requires a named individual; Team requires a legal company and contact person. Names must be renderable in the certificate font; contact the licensor for unsupported names.'},400,cfg.origin);
  const bucket=Math.floor(Date.now()/60000),key=await sha256((request.headers.get('CF-Connecting-IP')??'unknown')+':'+bucket);
  const limit=await env.DB.prepare('INSERT INTO purchase_limits(key,bucket,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,bucket).first<{count:number}>();
  if(!limit || limit.count>10)return json({error:'Too many purchase attempts. Please wait a minute.'},429,cfg.origin);
  await env.DB.prepare('DELETE FROM purchase_limits WHERE bucket<?').bind(bucket-2).run();
  const snapshot: Snapshot={tier,...TIERS[tier],holder,currency:'eur',priceId:cfg.prices[tier],livemode:cfg.livemode,terms:cfg.terms,
    issuer:cfg.issuer,taxPolicy:cfg.taxPolicy,licensedVersion:cfg.licensedVersion,ownerEmail:cfg.ownerEmail,emailFrom:cfg.emailFrom,acceptedAt:Date.now()};
  await env.DB.prepare('INSERT INTO orders(id,tier,snapshot,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,tier,JSON.stringify(snapshot),snapshot.acceptedAt).run();
  const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<Order>();
  if (!order) throw Error('order unavailable');
  const stored=JSON.parse(order.snapshot) as Snapshot;
  if (stored.tier!==tier || stored.terms.sha256!==cfg.terms.sha256 || stored.livemode!==cfg.livemode || JSON.stringify(stored.holder)!==JSON.stringify(holder)) return json({error:'Start a new purchase attempt'},409,cfg.origin);
  if(order.state!=='pending')return json({error:'This order is already being processed. Check your email before starting another payment.'},409,cfg.origin);
  const api=stripe(env);
  if(order.session_id){
    const recorded=await api.checkout.sessions.retrieve(order.session_id);
    if(recorded.metadata?.order_id!==id || recorded.livemode!==stored.livemode)throw Error('recorded session mismatch');
    const url=checkoutUrl(recorded);
    return json({url},200,cfg.origin);
  }
  if(Date.now()-order.created_at>23*3600000)return json({error:'This unresolved order needs review. Contact the issuer before retrying.'},409,cfg.origin);
  const price=await api.prices.retrieve(stored.priceId);
  if (!price.active || price.livemode!==stored.livemode || price.unit_amount!==stored.amount || price.currency!=='eur' || price.recurring ||
      stored.taxPolicy==='automatic-exclusive' && price.tax_behavior!=='exclusive') throw Error('price mismatch');
  const session=await api.checkout.sessions.create({mode:'payment',allowed_payment_method_types:['card'],line_items:[{price:stored.priceId,quantity:1}],
    success_url:cfg.origin+'/purchase-success.html',cancel_url:cfg.origin+'/purchase-cancelled.html',
    metadata:{order_id:id,terms_version:stored.terms.version},billing_address_collection:'required',customer_creation:'always',
    automatic_tax:{enabled:stored.taxPolicy==='automatic-exclusive'}}, {idempotencyKey:`checkout-${id}`});
  const url=checkoutUrl(session);
  const saved=await env.DB.prepare("UPDATE orders SET session_id=?,checkout_url=? WHERE id=? AND state='pending' AND (session_id IS NULL OR session_id=?)").bind(session.id,url,id,session.id).run();
  if(saved.meta.changes!==1)throw Error('order changed while creating checkout');
  return json({url},200,cfg.origin);
}
async function webhook(request:Request,env:Env) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !['test','live'].includes(env.MODE??'')) return json({error:'Webhook unavailable'},503);
  const body=await boundedBody(request,1000000);if(body===null)return json({error:'Payload too large'},413);
  let event: Stripe.Event;
  try {event=await stripe(env).webhooks.constructEventAsync(body,request.headers.get('Stripe-Signature')??'',env.STRIPE_WEBHOOK_SECRET,
    undefined,Stripe.createSubtleCryptoProvider());} catch {return json({error:'Invalid signature'},400);}
  if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return json({received:true});
  if (event.livemode!==(env.MODE==='live')) return json({received:true});
  const eventSession=event.data.object as Stripe.Checkout.Session;
  const session=await stripe(env).checkout.sessions.retrieve(eventSession.id,{expand:['line_items','payment_intent.latest_charge']});
  if (session.payment_status!=='paid') return json({received:true});
  const orderId=session.metadata?.order_id;
  const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId??'').first<Order>();
  if (!order) return json({received:true});
  const snap=JSON.parse(order.snapshot) as Snapshot;
  const payment=validSession(session,order,snap);
  if (!payment) {await env.DB.prepare("UPDATE orders SET state='quarantined' WHERE id=? AND state!='paid'").bind(order.id).run();return json({received:true});}
  const licenseId='lic_'+await sha256(session.id), now=Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET state='paid',session_id=?,payment=? WHERE id=? AND (session_id IS NULL OR session_id=?)").bind(session.id,JSON.stringify(payment),order.id,session.id),
    env.DB.prepare('INSERT INTO licenses(id,order_id,session_id,snapshot,payment,issued_at) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING').bind(licenseId,order.id,session.id,order.snapshot,JSON.stringify(payment),now),
    env.DB.prepare("INSERT INTO delivery_jobs(id,license_id,role,recipient,next_attempt) SELECT id||'-buyer',id,'buyer',?,? FROM licenses WHERE order_id=? ON CONFLICT(license_id,role) DO NOTHING").bind(payment.buyerEmail,now,order.id),
    env.DB.prepare("INSERT INTO delivery_jobs(id,license_id,role,recipient,next_attempt) SELECT id||'-owner',id,'owner',?,? FROM licenses WHERE order_id=? ON CONFLICT(license_id,role) DO NOTHING").bind(snap.ownerEmail,now,order.id),
    env.DB.prepare('INSERT INTO webhook_events(id,session_id,processed_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(event.id,session.id,now),
  ]);
  return json({received:true});
}
function base64(bytes: Uint8Array) {
  let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);
}
async function deliver(env:Env) {
  if(env.DELIVERY_ENABLED!=='true' || !env.EMAIL_API_KEY)return;
  const now=Date.now();
  const due=await env.DB.prepare("SELECT id FROM delivery_jobs WHERE (state='pending' AND next_attempt<=?) OR (state='sending' AND lease_until<=?) ORDER BY next_attempt LIMIT 10").bind(now,now).all<{id:string}>();
  for(const item of due.results) {
    const token=crypto.randomUUID(),claimNow=Date.now();
    const job=await env.DB.prepare("UPDATE delivery_jobs SET state='sending',attempts=attempts+1,lease_token=?,lease_until=?,first_attempt=COALESCE(first_attempt,?) WHERE id=? AND ((state='pending' AND next_attempt<=?) OR (state='sending' AND lease_until<=?)) RETURNING *").bind(token,claimNow+120000,claimNow,item.id,claimNow,claimNow).first<Job>();
    if(!job)continue;
    try {
      // Resend deduplicates for 24h. Stop before expiry rather than resend an ambiguous payment email.
      if(Date.now()-job.first_attempt>23*3600000)throw Error('manual reconciliation required');
      const license=await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(job.license_id).first<License>();
      if(!license)throw Error('license unavailable');
      const snap=JSON.parse(license.snapshot) as Snapshot,payment=JSON.parse(license.payment) as Payment;
      const message={from:snap.emailFrom,to:[job.recipient],subject:`${snap.livemode?'':'[TEST MODE] '}iolinki ${job.role==='buyer'?'software license':'purchase notification'} — ${snap.label}`,
        text:job.role==='buyer'?`Your ${snap.label} software license certificate is attached.\nLicense: ${license.id}\nStripe receipt: ${payment.receiptUrl}\nTerms: ${snap.terms.url}\nThis is a software license record, not IO-Link certification.`:
          `Paid ${snap.label} order ${license.order_id}\nLicense holder: ${snap.holder.name} (${snap.holder.kind})\nBuyer: ${payment.buyerName} <${payment.buyerEmail}>\nLicense: ${license.id}\nAmount: EUR ${(payment.total/100).toFixed(2)}\nPayment: ${payment.intentId}`,
        ...(job.role==='buyer'?{attachments:[{filename:`iolinki-${license.id}.pdf`,content:base64(await certificate(license))}]}:{})};
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.EMAIL_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify(message),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(`email provider status ${response.status}`);
      const result=await response.json() as {id?:string};if(!result.id)throw Error('missing delivery acknowledgment');
      await env.DB.prepare("UPDATE delivery_jobs SET state='sent',provider_id=?,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=? AND lease_token=?").bind(result.id,job.id,token).run();
    } catch(error) {
      const reason=error instanceof Error?error.message:'delivery failure';
      const failed=job.attempts>=8 || reason==='unsupported certificate character' || reason==='manual reconciliation required';
      await env.DB.prepare("UPDATE delivery_jobs SET state=?,next_attempt=?,lease_token=NULL,lease_until=NULL,last_error=? WHERE id=? AND lease_token=?").bind(failed?'failed':'pending',Date.now()+Math.min(3600000,60000*2**job.attempts),reason.slice(0,100),job.id,token).run();
    }
  }
}
export default class CheckoutWorker extends WorkerEntrypoint<Env> {
  async fetch(request:Request) {
    const path=new URL(request.url).pathname;
    if(path==='/stripe/webhook' && request.method==='POST') {
      try{return await webhook(request,this.env);}catch{return json({error:'Payment processing temporarily unavailable'},503);}
    }
    let cfg:Config;
    try{cfg=await config(this.env);}catch{return path==='/catalog'?json({available:false}):json({error:'Purchasing is not available yet'},503);}
    if(request.method==='OPTIONS' && request.headers.get('Origin')===cfg.origin)return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':cfg.origin,'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
    if(path==='/catalog' && request.method==='GET')return json({available:true,mode:cfg.livemode?'live':'test',terms:{version:cfg.terms.version,sha256:cfg.terms.sha256,url:cfg.terms.url},taxPolicy:cfg.taxPolicy,tiers:TIERS},200,cfg.origin);
    if(path==='/checkout' && request.method==='POST') {
      try{return await createCheckout(request,this.env,cfg);}catch{return json({error:'Checkout temporarily unavailable. Retry this purchase attempt.'},503,cfg.origin);}
    }
    return json({error:'Not found'},404);
  }
  async scheduled() {await deliver(this.env);}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryProjectStorage} from '../../tools/iodd/project-vault.mjs';
const module=await import('../../tools/iodd/artifact-store.mjs').catch(()=>({}));
function store(options={}){assert.equal(typeof module.createArtifactStore,'function','durable artifact store must exist');return module.createArtifactStore({storage:createMemoryProjectStorage(),clock:()=>1000,...options});}
const artifact=(overrides={})=>({token:crypto.randomUUID(),bytes:new Uint8Array([80,75,1]),filename:'device.zip',mimeType:'application/zip',expires:2000,...overrides});
test('storage recreation reads exact large chunked bytes and expiry metadata',async()=>{
 const backing=createMemoryProjectStorage();let chunks=0;
 const storage={transaction:cb=>backing.transaction(tx=>cb({...tx,put:async(k,v)=>{if(v instanceof Uint8Array){assert.ok(v.length<=65536);chunks++;}await tx.put(k,v);}}))};
 const a=artifact({bytes:new Uint8Array(200000).fill(67)});await store({storage}).save(a);
 assert.equal(chunks,4);const restored=await store({storage}).get(a.token);assert.deepEqual(restored,{bytes:a.bytes,filename:a.filename,mimeType:a.mimeType,expires:a.expires});
 restored.bytes[0]=0;assert.equal((await store({storage}).get(a.token)).bytes[0],67);
 assert.equal(await store({storage}).nextExpiry(),2000);
});
test('expired artifacts fail closed; prune and save recover bounded quota',async()=>{
 let now=1000;const s=store({clock:()=>now,maxBytes:3,maxEntries:1});const a=artifact();await s.save(a);
 await assert.rejects(s.save(artifact()),/capacity/);now=2000;assert.equal(await s.get(a.token),null);assert.equal(await s.prune(),1);assert.equal(await s.nextExpiry(),null);await s.save(artifact({expires:3000}));
});
test('simultaneous stores share atomic count and byte quotas; collision never overwrites',async()=>{
 for(const options of [{maxEntries:1},{maxBytes:3}]){
  const storage=createMemoryProjectStorage(),a=artifact(),b=artifact();
  const results=await Promise.allSettled([store({storage,...options}).save(a),store({storage,...options}).save(b)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const saved=results[0].status==='fulfilled'?a:b;await assert.rejects(store({storage,...options}).save(saved),/collision/);
  assert.deepEqual((await store({storage}).get(saved.token)).bytes,saved.bytes);
 }
});
test('transaction write failure leaves no partial chunks or capacity usage',async()=>{
 const backing=createMemoryProjectStorage();let fail=true;
 const storage={transaction:cb=>backing.transaction(tx=>cb({...tx,put:async(k,v)=>{await tx.put(k,v);if(fail){fail=false;throw Error('controlled failure');}}}))};
 const s=store({storage,maxEntries:1}),a=artifact();await assert.rejects(s.save(a),/controlled failure/);assert.equal(await s.get(a.token),null);await s.save(a);assert.ok(await s.get(a.token));
});
test('invalid nonce, body, lifetime, filename and mime type are refused',async()=>{
 const s=store();for(const token of ['bad','../x','00000000-0000-0000-0000-000000000000',crypto.randomUUID().toUpperCase(),crypto.randomUUID()+'\n']){assert.equal(await s.get(token),null);await assert.rejects(s.save(artifact({token})),/token/);}
 assert.equal(await s.get(crypto.randomUUID()),null);
 for(const overrides of [{expires:1000},{expires:601001},{expires:Infinity},{bytes:new Uint8Array(16*1024*1024+1)},{bytes:'no'},{filename:'../x'},{filename:'device.zip\n'},{mimeType:'text/plain\n'},{filename:'x'.repeat(241)},{mimeType:'text/plain\r\nx:bad'}])await assert.rejects(s.save(artifact(overrides)));
});
test('same-size chunk corruption and malformed metadata never return bytes',async()=>{
 const storage=createMemoryProjectStorage(),s=store({storage}),a=artifact();await s.save(a);
 await storage.transaction(tx=>tx.put('iodd-artifacts:v1:'+a.token+':0',new Uint8Array([1,2,3])));
 assert.equal(await s.get(a.token),null);
 await storage.transaction(async tx=>{const cat=await tx.get('iodd-artifacts:v1:catalog');cat[a.token].filename='../escape';await tx.put('iodd-artifacts:v1:catalog',cat);});
 assert.equal(await s.get(a.token),null);await assert.rejects(s.save(artifact()),/storage/);
});
test('maximum-size artifact expires with bounded bulk-delete batches and empty bytes roundtrip',async()=>{
 const backing=createMemoryProjectStorage();let now=1000,deleted=0;
 const storage={transaction:cb=>backing.transaction(tx=>cb({...tx,delete:async keys=>{assert.ok(Array.isArray(keys)&&keys.length<=128);deleted+=keys.length;await tx.delete(keys);}}))};
 const s=store({storage,clock:()=>now}),a=artifact({bytes:new Uint8Array(16*1024*1024)});
 await s.save(a);assert.equal((await s.get(a.token)).bytes.length,16*1024*1024);
 now=2000;assert.equal(await s.prune(),1);assert.equal(deleted,256);
 const empty=artifact({bytes:new Uint8Array(),expires:3000});await s.save(empty);assert.deepEqual((await s.get(empty.token)).bytes,new Uint8Array());
});
test('save automatically prunes expired capacity and nextExpiry picks earliest record',async()=>{
 let now=1000;const s=store({clock:()=>now,maxEntries:2,maxBytes:6});
 const first=artifact({expires:1100}),second=artifact({expires:1300});await s.save(first);await s.save(second);assert.equal(await s.nextExpiry(),1100);
 now=1100;await s.save(artifact({expires:1400}));assert.equal(await s.get(first.token),null);assert.equal(await s.nextExpiry(),1300);
});

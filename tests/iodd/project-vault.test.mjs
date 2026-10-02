import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../tools/iodd/node-runtime.mjs';
import {createProject,saveProject,loadProject} from '../../assets/js/iodd/project.js';
import {createProjectVault,createMemoryProjectStorage,createMemoryProjectVault} from '../../tools/iodd/project-vault.mjs';

const project=saveProject(createProject(readFileSync(new URL('../../assets/iodd/counter.xml',import.meta.url),'utf8'),'counter.xml'));

test('storage survives adapter recreation; opaque shard token and explicit deletion',async()=>{
 const storage=createMemoryProjectStorage();
 const first=createProjectVault({storage,clock:()=>1000,tokenPrefix:'b',ttlMs:2000});
 const receipt=await first.save(project);
 assert.match(receipt.token,/^b[0-9a-f]{7}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(receipt.expiresAt,3000);assert.equal(receipt.durable,false);
 const next=createProjectVault({storage,clock:()=>1001});
 assert.equal(await next.restore(receipt.token),project);
 assert.equal(await next.delete(receipt.token),true);
 assert.equal(await next.delete(receipt.token),false);
 await assert.rejects(next.restore(receipt.token),/Recovery token unavailable/);
});

test('expired and unknown tokens share generic refusal; pruning releases capacity',async()=>{
 let now=0;const vault=createProjectVault({storage:createMemoryProjectStorage(),clock:()=>now,ttlMs:10,maxEntries:1});
 const {token}=await vault.save(project);now=10;
 await assert.rejects(vault.restore(token),/Recovery token unavailable/);
 await assert.rejects(vault.restore('12345678-1234-4123-8123-123456789abc'),/Recovery token unavailable/);
 await assert.rejects(vault.restore('bad'),/Recovery token unavailable/);
 assert.equal(await vault.prune(),1);
 await vault.save(project);
});

test('concurrent saves cannot exceed count or byte quotas',async()=>{
 const bytes=new TextEncoder().encode(project).length;
 for(const limits of [{maxEntries:1},{maxTotalBytes:bytes}]){
  const storage=createMemoryProjectStorage();
  const vault=createProjectVault({storage,...limits});
  const another=createProjectVault({storage,...limits});
  const results=await Promise.allSettled([vault.save(project),another.save(project)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/capacity/);
  await vault.delete(results.find(r=>r.status==='fulfilled').value.token);
  await vault.save(project);
 }
});

test('failed transactional write rolls back bytes and quota',async()=>{
 const backing=createMemoryProjectStorage();let fail=true;
 const storage={transaction:cb=>backing.transaction(tx=>cb({...tx,put:async(k,v)=>{await tx.put(k,v);if(fail){fail=false;throw Error('controlled write failure');}}}))};
 const vault=createProjectVault({storage,maxEntries:1});
 await assert.rejects(vault.save(project),/controlled write failure/);
 const saved=await vault.save(project);assert.equal(await vault.restore(saved.token),project);
});

test('malformed projects and oversized payloads are refused before writes',async()=>{
 let transactions=0;const storage={transaction(){transactions++;throw Error('must not write');}};
 const vault=createProjectVault({storage});
 for(const value of ['{}','not json',JSON.stringify({format:'iolinki-iodd-project',version:1,filename:'x.xml',xml:'<bad>',assets:[]})])await assert.rejects(vault.save(value));
 await assert.rejects(vault.save('x'.repeat(8*1024*1024+1)),/size/);
 assert.equal(transactions,0);
});

test('memory convenience adapter explicitly reports volatile persistence',async()=>{
 const vault=createMemoryProjectVault();const saved=await vault.save(project);
 assert.equal(saved.durable,false);assert.equal(await vault.restore(saved.token),project);
 await assert.rejects(createMemoryProjectVault().restore(saved.token),/Recovery token unavailable/);
});

test('DO-shaped fake recreates storage facade; large values stay chunked and corruption is refused',async()=>{
 const persistent=new Map();
 function storage(){return {transaction:async callback=>{
  const snapshot=structuredClone(persistent);
  const tx={get:async key=>structuredClone(snapshot.get(key)),
   put:async(key,value)=>{if(value instanceof Uint8Array)assert.ok(value.length<=64*1024);snapshot.set(key,structuredClone(value));},
   delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])snapshot.delete(key);}};
  const result=await callback(tx);persistent.clear();for(const [key,value] of snapshot)persistent.set(key,value);return result;
 }};}
 const large=loadProject(project);large.assets.push({name:'owned.bin',base64:Buffer.alloc(200000,65).toString('base64')});
 const serialized=saveProject(large);
 const receipt=await createProjectVault({storage:storage(),durable:true}).save(serialized);
 assert.equal(receipt.durable,true);
 const next=createProjectVault({storage:storage(),durable:true});
 assert.equal(await next.restore(receipt.token),serialized);
 const key=[...persistent.keys()].find(key=>key.includes(receipt.token));
 const corrupted=structuredClone(persistent.get(key));corrupted[0]=33;persistent.set(key,corrupted);
 await assert.rejects(next.restore(receipt.token),/Recovery token unavailable/);
 await next.delete(receipt.token);assert.equal(persistent.size,1);
});

test('failed deletion preserves original record and quota; retry removes it atomically',async()=>{
 const backing=createMemoryProjectStorage();let fail=false;
 const storage={transaction:cb=>backing.transaction(tx=>cb({...tx,delete:async keys=>{await tx.delete(keys);if(fail)throw Error('controlled delete failure');}}))};
 const vault=createProjectVault({storage,maxEntries:1});const saved=await vault.save(project);fail=true;
 await assert.rejects(vault.delete(saved.token),/controlled delete failure/);
 assert.equal(await vault.restore(saved.token),project);
 await assert.rejects(vault.save(project),/capacity/);
 fail=false;await vault.delete(saved.token);await vault.save(project);
});

test('automatic expiration pruning and bounded configuration',async()=>{
 let now=0;const vault=createProjectVault({storage:createMemoryProjectStorage(),clock:()=>now,maxEntries:1,ttlMs:1});
 const old=await vault.save(project);now=1;const fresh=await vault.save(project);
 await assert.rejects(vault.restore(old.token),/Recovery token unavailable/);
 assert.equal(await vault.restore(fresh.token),project);
 for(const bad of [{ttlMs:24*60*60*1000+1},{maxProjectBytes:8*1024*1024+1},{maxEntries:257},{tokenPrefix:'z'},{tokenPrefix:'\n'},{maxTotalBytes:Infinity}])assert.throws(()=>createProjectVault({storage:createMemoryProjectStorage(),...bad}));
});

test('next expiry schedules remaining saves and clears after prune or deletion',async()=>{
 let now=100;const vault=createProjectVault({storage:createMemoryProjectStorage(),clock:()=>now,ttlMs:10});
 assert.equal(await vault.nextExpiry(),null);
 const first=await vault.save(project);now=105;const second=await vault.save(project);
 assert.equal(await vault.nextExpiry(),110);
 now=110;assert.equal(await vault.prune(),1);assert.equal(await vault.nextExpiry(),115);
 await vault.delete(second.token);assert.equal(await vault.nextExpiry(),null);
 await assert.rejects(vault.restore(first.token+'\n'),/Recovery token unavailable/);
});

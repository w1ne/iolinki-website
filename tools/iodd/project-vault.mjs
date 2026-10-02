import {loadProject,saveProject} from '../../assets/js/iodd/project.js';

const ENCODER=new TextEncoder();
const DECODER=new TextDecoder('utf-8',{fatal:true});
const CATALOG='iodd-vault:v1:catalog';
const CHUNK_BYTES=64*1024;
const MAX_PROJECT_BYTES=8*1024*1024;
const DAY=24*60*60*1000;
export const RECOVERY_TOKEN_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isRecoveryToken(token){return typeof token==='string'&&token.length===36&&RECOVERY_TOKEN_PATTERN.test(token);}
const unavailable=()=>Error('Recovery token unavailable.');
const chunkKey=(token,index)=>`iodd-vault:v1:${token}:${index}`;

function bounded(value,maximum,label){
 if(!Number.isSafeInteger(value)||value<1||value>maximum)throw Error(`Invalid ${label}.`);
 return value;
}

/** Caller storage must provide atomic, serializable transaction(get/put/delete).
 * Set durable:true only for actual persistent storage, such as Durable Object storage.
 * Every operation is transactional; project chunks are below the DO value limit.
 */
export function createProjectVault({storage,clock=Date.now,tokenPrefix='',ttlMs=DAY,
 maxProjectBytes=MAX_PROJECT_BYTES,maxTotalBytes=32*1024*1024,maxEntries=64,durable=false}={}){
 if(!storage||typeof storage.transaction!=='function')throw Error('Transactional project storage required.');
 if(typeof clock!=='function'||typeof durable!=='boolean'||typeof tokenPrefix!=='string'||
  !(tokenPrefix===''||(tokenPrefix.length===1&&/^[0-9a-f]$/.test(tokenPrefix))))throw Error('Invalid vault configuration.');
 bounded(ttlMs,DAY,'lifetime');bounded(maxProjectBytes,MAX_PROJECT_BYTES,'project size');
 bounded(maxTotalBytes,64*1024*1024,'total size');bounded(maxEntries,256,'entry limit');
 function now(){const value=clock();if(!Number.isSafeInteger(value)||value<0||value>Number.MAX_SAFE_INTEGER-DAY)throw Error('Invalid clock.');return value;}
 async function catalog(tx){
  const saved=await tx.get(CATALOG);
  if(saved===undefined)return {};
  if(!saved||typeof saved!=='object'||Array.isArray(saved)||Object.keys(saved).length>256)throw Error('Invalid project storage.');
  for(const [token,entry] of Object.entries(saved)){
   if(!isRecoveryToken(token)||!entry||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>MAX_PROJECT_BYTES||
    !Number.isSafeInteger(entry.expiresAt)||entry.expiresAt<0||entry.chunks!==Math.ceil(entry.bytes/CHUNK_BYTES))throw Error('Invalid project storage.');
  }
  return structuredClone(saved);
 }
 async function remove(tx,entries,token){
  const entry=entries[token];if(!entry)return false;
  await tx.delete(Array.from({length:entry.chunks},(_,index)=>chunkKey(token,index)));
  delete entries[token];return true;
 }
 async function expired(tx,entries,time){
  let count=0;
  for(const [token,entry] of Object.entries(entries))if(entry.expiresAt<=time){await remove(tx,entries,token);count++;}
  return count;
 }
 return {
  async save(serialized){
   if(typeof serialized!=='string')throw Error('Serialized project required.');
   if(serialized.length>maxProjectBytes)throw Error('Project exceeds recovery size limit.');
   const bytes=ENCODER.encode(serialized);
   if(bytes.length<1||bytes.length>maxProjectBytes)throw Error('Project exceeds recovery size limit.');
   // Use the existing engine for JSON shape, XML and asset validation before storage.
   saveProject(loadProject(serialized));
   const time=now(),expiresAt=time+ttlMs;
   let token=globalThis.crypto.randomUUID();
   if(tokenPrefix)token=tokenPrefix+token.slice(1);
   await storage.transaction(async tx=>{
    const entries=await catalog(tx);await expired(tx,entries,time);
    if(Object.hasOwn(entries,token))throw Error('Recovery token collision.');
    const total=Object.values(entries).reduce((sum,entry)=>sum+entry.bytes,0);
    if(Object.keys(entries).length>=maxEntries||total+bytes.length>maxTotalBytes)throw Error('Project recovery capacity exceeded.');
    const chunks=Math.ceil(bytes.length/CHUNK_BYTES);
    for(let index=0;index<chunks;index++)await tx.put(chunkKey(token,index),bytes.slice(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES));
    entries[token]={bytes:bytes.length,chunks,expiresAt};await tx.put(CATALOG,entries);
   });
   return {token,expiresAt,lifetimeMs:ttlMs,bytes:bytes.length,durable};
  },
  async restore(token){
   if(!isRecoveryToken(token))throw unavailable();
   const time=now();
   return storage.transaction(async tx=>{
    const entries=await catalog(tx),entry=entries[token];
    if(!entry||entry.expiresAt<=time)throw unavailable();
    const bytes=new Uint8Array(entry.bytes);let offset=0;
    for(let index=0;index<entry.chunks;index++){
     const chunk=await tx.get(chunkKey(token,index));
     const expected=Math.min(CHUNK_BYTES,entry.bytes-offset);
     if(!(chunk instanceof Uint8Array)||chunk.length!==expected)throw unavailable();
     bytes.set(chunk,offset);offset+=chunk.length;
    }
    try{const serialized=DECODER.decode(bytes);saveProject(loadProject(serialized));return serialized;}
    catch{throw unavailable();}
   });
  },
  async delete(token){
   if(!isRecoveryToken(token))return false;
   return storage.transaction(async tx=>{
    const entries=await catalog(tx),removed=await remove(tx,entries,token);
    if(removed)await tx.put(CATALOG,entries);
    return removed;
   });
  },
  async prune(){
   const time=now();
   return storage.transaction(async tx=>{
    const entries=await catalog(tx),count=await expired(tx,entries,time);
    if(count)await tx.put(CATALOG,entries);
    return count;
   });
  },
  async nextExpiry(){
   return storage.transaction(async tx=>{
    const entries=await catalog(tx),times=Object.values(entries).map(entry=>entry.expiresAt);
    return times.length?Math.min(...times):null;
   });
  },
 };
}

/** Volatile local adapter. Recreation with the same storage preserves data only
 * within this process; it is not durable restart or disaster-recovery evidence.
 */
export function createMemoryProjectStorage(){
 let values=new Map(),queue=Promise.resolve();
 return {transaction(callback){
  const run=queue.then(async()=>{
   const candidate=structuredClone(values);
   const tx={
    get:async key=>structuredClone(candidate.get(key)),
    put:async(key,value)=>{candidate.set(key,structuredClone(value));},
    delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])candidate.delete(key);},
   };
   const result=await callback(tx);values=candidate;return result;
  });
  queue=run.catch(()=>{});return run;
 }};
}
export function createMemoryProjectVault(options={}){
 return createProjectVault({...options,storage:createMemoryProjectStorage(),durable:false});
}

const CATALOG='iodd-artifacts:v1:catalog';
const CHUNK=64*1024, MAX_BYTES=16*1024*1024, MAX_ENTRIES=128, MAX_TTL=10*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const filenameOK=value=>typeof value==='string'&&/^[A-Za-z0-9_#-][A-Za-z0-9._#-]{0,239}$/.test(value);
const mimeOK=value=>typeof value==='string'&&value.length<=128&&/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/.test(value);
const key=(token,index)=>`iodd-artifacts:v1:${token}:${index}`;
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const bounded=(value,max)=>Number.isSafeInteger(value)&&value>0&&value<=max;
function validMetadata(entry){return entry&&typeof entry==='object'&&!Array.isArray(entry)&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&entry.bytes<=MAX_BYTES&&entry.chunks===Math.ceil(entry.bytes/CHUNK)&&filenameOK(entry.filename)&&mimeOK(entry.mimeType)&&Number.isSafeInteger(entry.createdAt)&&entry.createdAt>=0&&Number.isSafeInteger(entry.expires)&&entry.expires>entry.createdAt&&entry.expires-entry.createdAt<=MAX_TTL&&typeof entry.sha256==='string'&&/^[0-9a-f]{64}$/.test(entry.sha256);}
/** Transactional durable storage adapter; no process-memory artifact cache.
 * Supply actual Durable Object storage for persistence across runtime eviction.
 */
export function createArtifactStore({storage,clock=Date.now,maxBytes=MAX_BYTES,maxEntries=MAX_ENTRIES}={}){
 if(!storage||typeof storage.transaction!=='function'||typeof clock!=='function'||!bounded(maxBytes,MAX_BYTES)||!bounded(maxEntries,MAX_ENTRIES))throw Error('Invalid artifact storage configuration.');
 function now(){const time=clock();if(!Number.isSafeInteger(time)||time<0||time>Number.MAX_SAFE_INTEGER-MAX_TTL)throw Error('Invalid artifact storage clock.');return time;}
 async function catalog(tx){
  const value=await tx.get(CATALOG);if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>MAX_ENTRIES)throw Error('Invalid artifact storage metadata.');
  for(const [token,entry]of Object.entries(value))if(!UUID.test(token)||!validMetadata(entry))throw Error('Invalid artifact storage metadata.');
  return structuredClone(value);
 }
 async function remove(tx,entries,token){
  const keys=Array.from({length:entries[token].chunks},(_,index)=>key(token,index));
  // Durable Object storage bulk deletes accept at most 128 keys per call.
  for(let start=0;start<keys.length;start+=128)await tx.delete(keys.slice(start,start+128));
  delete entries[token];
 }
 async function expire(tx,entries,time){let count=0;for(const [token,entry]of Object.entries(entries))if(entry.expires<=time){await remove(tx,entries,token);count++;}return count;}
 return {
  async save({token,bytes,filename,mimeType,expires}={}){
   if(typeof token!=='string'||!UUID.test(token))throw Error('Invalid artifact token.');
   if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES)throw Error('Invalid artifact body size.');
   if(!filenameOK(filename)||!mimeOK(mimeType))throw Error('Invalid artifact filename or MIME type.');
   const time=now();if(!Number.isSafeInteger(expires)||expires<=time||expires-time>MAX_TTL)throw Error('Invalid artifact expiry.');
   const body=Uint8Array.from(bytes),digest=await sha(body);
   await storage.transaction(async tx=>{
    const entries=await catalog(tx);await expire(tx,entries,time);
    if(Object.hasOwn(entries,token))throw Error('Artifact token collision.');
    const total=Object.values(entries).reduce((sum,e)=>sum+e.bytes,0);
    if(Object.keys(entries).length>=maxEntries||total+body.length>maxBytes)throw Error('Artifact storage capacity exceeded.');
    const chunks=Math.ceil(body.length/CHUNK);
    for(let index=0;index<chunks;index++)await tx.put(key(token,index),body.slice(index*CHUNK,(index+1)*CHUNK));
    entries[token]={bytes:body.length,chunks,filename,mimeType,createdAt:time,expires,sha256:digest};await tx.put(CATALOG,entries);
   });
  },
  async get(token){
   if(typeof token!=='string'||!UUID.test(token))return null;
   const time=now();
   try{return await storage.transaction(async tx=>{
    const entries=await catalog(tx),entry=entries[token];if(!entry||entry.expires<=time)return null;
    const bytes=new Uint8Array(entry.bytes);let offset=0;
    for(let index=0;index<entry.chunks;index++){
     const chunk=await tx.get(key(token,index)),expected=Math.min(CHUNK,bytes.length-offset);
     if(!(chunk instanceof Uint8Array)||chunk.length!==expected)return null;
     bytes.set(chunk,offset);offset+=chunk.length;
    }
    if(await sha(bytes)!==entry.sha256)return null;
    return {bytes,filename:entry.filename,mimeType:entry.mimeType,expires:entry.expires};
   });}catch{return null;}
  },
  async prune(){const time=now();return storage.transaction(async tx=>{const entries=await catalog(tx),count=await expire(tx,entries,time);if(count)await tx.put(CATALOG,entries);return count;});},
  async nextExpiry(){return storage.transaction(async tx=>{const entries=await catalog(tx),times=Object.values(entries).map(e=>e.expires);return times.length?Math.min(...times):null;});},
 };
}

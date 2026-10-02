#!/usr/bin/env node
// Adapt pinned MIT libxml2-wasm for Workers' ban on runtime WASM compilation.
// No IO-Link schemas are bundled. Main module and callback wrappers compile at deploy time.
import { readFile,writeFile,mkdir,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const source=new URL('../../node_modules/libxml2-wasm/',import.meta.url);
const dest=new URL('./schema-wasm/',import.meta.url);
const check=process.argv.includes('--check');
const packageInfo=JSON.parse(await readFile(new URL('package.json',source)));
if(packageInfo.version!=='0.7.2') throw Error('Expected pinned libxml2-wasm0.7.2.');
const leb=n=>{const b=[];do {b.push((n&127)|(n>127?128:0));n>>>=7;}while(n);return b;};
const section=(id,bytes)=>[id,...leb(bytes.length),...bytes];
const callback=sig=>{
  const type=[1,96,...leb(sig.length-1),...Array(sig.length-1).fill(127),...(sig[0]==='v'?[0]:[1,127])];
  return Uint8Array.from([0,97,115,109,1,0,0,0,...section(1,type),...section(2,[1,1,101,1,102,0,0]),...section(7,[1,1,102,0,0])]);
};
function boundMemory(bytes) {
  let offset=8; const result=[...bytes.slice(0,8)];
  const read=()=>{let value=0,shift=0,b;do {b=bytes[offset++];value|=(b&127)<<shift;shift+=7;}while(b&128);return value;};
  while(offset<bytes.length) {
    const id=bytes[offset++],length=read(),start=offset;
    if(id===5) {
      const count=read(),flags=read(),minimum=read();if(flags&1)read();
      if(count!==1||minimum>512) throw Error('Unexpected WASM memory layout.');
      result.push(...section(5,[1,1,...leb(minimum),...leb(512)]));
    } else {result.push(id,...leb(length));for(const value of bytes.subarray(start,start+length))result.push(value);}
    offset=start+length;
  }
  return Uint8Array.from(result);
}
const outputs=new Map();
for(const name of (await readdir(new URL('lib/',source))).filter(n=>n.endsWith('.mjs')&&!n.startsWith('nodejs'))) {
  let text=await readFile(new URL('lib/'+name,source),'utf8');
  if(name==='libxml2raw.mjs') {
    const literal=text.match(/pa\?\?=ea\(('(?:\\[\s\S]|[^'\\])*')\)/);
    if(!literal)throw Error('Pinned inline WASM literal changed.');
    const string=vm.runInNewContext(literal[1],Object.create(null),{timeout:1000});
    outputs.set('libxml2.wasm',boundMemory(Uint8Array.from(string,c=>c.charCodeAt(0)&255)));
    text=text.replace(literal[0],"throw Error('Static WASM initializer is required')");
    const start=text.indexOf('c=Uint8Array.of(0,97,115,109'),end=text.indexOf('c=new WebAssembly.Module(c);',start);
    if(start<0||end<0)throw Error('Pinned callback bridge code changed.');
    text=text.slice(0,start)+'c=bridgeModules[c];if(!c)throw Error("Unsupported callback signature");'+text.slice(end+'c=new WebAssembly.Module(c);'.length);
    text='import ii from "./callback-ii.wasm";\nimport iiii from "./callback-iiii.wasm";\nimport vii from "./callback-vii.wasm";\nconst bridgeModules={ii,iiii,vii};\n'+text;
    // Workers nodejs_compat exposes process but does not supply createRequire.
    text=text.replace('h=globalThis.process?.versions?.node&&"renderer"!=globalThis.process?.type','h=false');
  } else if(name==='libxml2.mjs') {
    text='import wasm from "./libxml2.wasm";\n'+text.replace('await moduleLoader()','await moduleLoader({instantiateWasm(imports,receiver){receiver(new WebAssembly.Instance(wasm,imports),wasm);}})');
  }
  outputs.set(name,Buffer.from(text.replace(/\/\/# sourceMappingURL=.*$/gm,'')));
}
for(const sig of ['ii','iiii','vii'])outputs.set('callback-'+sig+'.wasm',callback(sig));
for(const name of ['LICENSE','LICENSE.libxml2'])outputs.set(name,await readFile(new URL(name,source)));
await mkdir(dest,{recursive:true});
for(const [name,bytes]of outputs) {
  const path=new URL(name,dest);
  if(check) {if(!(await readFile(path)).equals(Buffer.from(bytes)))throw Error('Generated WASM runtime differs: '+name);}
  else await writeFile(path,bytes);
}
console.log(`Pinned Worker WASM runtime${check?' verified':' generated'} (${outputs.size} files,32MiB maximum linear memory).`);

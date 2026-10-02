import test from 'node:test';
import assert from 'node:assert/strict';
import '../../tools/iodd/node-runtime.mjs';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { IoddHttpHost } from '../../tools/iodd/mcp-http.mjs';
const loadTemplate = name => readFile(new URL(`../../assets/iodd/${name}.xml`, import.meta.url), 'utf8');
async function connect(host) {
 const transport = new StreamableHTTPClientTransport(new URL('https://example.test/mcp'), {fetch:(url, init)=>host.fetch(new Request(url,init))});
 const client = new Client({name:'workflow-proof',version:'1'});
 await client.connect(transport);
 return {client,transport,call:async(name,args={})=>{
  const result = await client.callTool({name:'iodd_'+name,arguments:args});
  if(result.isError) {
   const message=result.content[0].text;
   let decoded;try{decoded=JSON.parse(message);}catch{}
   throw Error(decoded?.error?.message||message);
  }
  return JSON.parse(result.content[0].text);
 }};
}
test('saved project restores into a fresh host/session, keeps edits and can be explicitly revoked', async()=>{
 const saved=new Map();
 const vault={save:async json=>{const token=crypto.randomUUID();saved.set(token,json);return {token,durable:true,expiresAt:new Date(Date.now()+1000).toISOString()};},restore:async token=>{if(!saved.has(token))throw Error('Saved project unavailable');return saved.get(token);},delete:async token=>saved.delete(token)};
 let host = new IoddHttpHost({loadTemplate,projectVaultFactory:()=>vault});
 const first=await connect(host);
 let second;
 try {
  const project=await first.call('create',{template:'switching-sensor'});
  await first.call('edit',{projectId:project.projectId,operation:{type:'identity',values:{productName:'Recovered sensor'}}});
  const receipt=await first.call('save',{projectId:project.projectId});
  assert.equal(receipt.durable,true);
  await first.transport.terminateSession();
  host=new IoddHttpHost({loadTemplate,projectVaultFactory:()=>vault});
  second=await connect(host);
  await assert.rejects(second.call('inspect',{projectId:project.projectId}),/Unknown project/);
  const restored=await second.call('restore',{token:receipt.token});
  assert.notEqual(restored.projectId,project.projectId);
  assert.equal(restored.identity.productName,'Recovered sensor');
  assert.equal((await second.call('validate',{projectId:restored.projectId})).valid,true);
  assert.equal((await second.call('delete_saved',{token:receipt.token})).deleted,true);
  await assert.rejects(second.call('restore',{token:receipt.token}),/unavailable/);
  assert.equal((await second.call('inspect',{projectId:restored.projectId})).identity.productName,'Recovered sensor');
 }finally{await first.client.close();if(second){await second.transport.terminateSession();await second.client.close();}}
});
test('host propagates real validation result separately from basic validity',async()=>{
 const host=new IoddHttpHost({loadTemplate,externalValidation:async()=>({schema:{status:'failed',output:'Missing required schema attribute'},officialChecker:{status:'unavailable'}})});
 const connection=await connect(host);
 try{
  const project=await connection.call('create');
  const result=await connection.call('validate',{projectId:project.projectId});
  assert.equal(result.valid,true);
  assert.equal(result.schema.status,'failed');
  assert.equal(result.coverage.xsd,true);
  assert.equal(result.coverage.official,false);
  assert.equal(result.officialChecker.status,'unavailable');
 }finally{await connection.transport.terminateSession();await connection.client.close();}
});

test('firmware tools expose composed compile arguments and downloadable complete source', async()=>{
 const {createFirmwareKit}=await import('../../tools/iodd/firmware-kit.mjs');
 const host=new IoddHttpHost({loadTemplate,firmwareKit:project=>createFirmwareKit(project,{loadAsset:name=>readFile(new URL('../../assets/iodd/firmware-kit/'+name,import.meta.url),'utf8')})});
 const connection=await connect(host);
 try {
  const project=await connection.call('create',{template:'switching-sensor'});
  const source=await connection.call('firmware_source',{projectId:project.projectId});
  assert.equal(source.compile.board,'stm32f401cdu6-blackpill');
  assert.match(source.compile.source,/IODD_SENSOR_PROOF_PASS/);
  assert.match(source.scope,/Excludes IO-Link stack/);
  const kit=await connection.call('firmware_kit',{projectId:project.projectId});
  assert.match(kit.filename,/firmware-kit.zip$/);
  const response=await host.fetch(new Request(kit.downloadUrl));
  assert.equal(response.status,200);
  assert.equal(new Uint8Array(await response.arrayBuffer())[0],80);
 }finally{await connection.transport.terminateSession();await connection.client.close();}
});

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const endpoint=process.env.IODD_ENDPOINT||'http://localhost:8800/mcp';
async function connect(){const client=new Client({name:'restart-proof',version:'1'});const transport=new StreamableHTTPClientTransport(new URL(endpoint));await client.connect(transport);return {client,transport,call:async(name,args={})=>{const result=await client.callTool({name:'iodd_'+name,arguments:args});const data=JSON.parse(result.content[0].text);if(result.isError)throw Error(JSON.stringify(data));return data;}};}
const phase=process.argv[2]||'save';
const receiptPath=process.env.IODD_RECEIPT_PATH;
if (!receiptPath || !['save','restore'].includes(phase)) throw Error('Use save or restore with IODD_RECEIPT_PATH set to a private temporary file. Restart the Worker between phases to prove persistence.');
const c=await connect();
try{
 if(phase==='save'){
 const p=await c.call('create',{template:'switching-sensor'});
 await c.call('edit',{projectId:p.projectId,operation:{type:'identity',values:{productName:'Restart witness sensor'}}});
 const receipt=await c.call('save',{projectId:p.projectId});assert.equal(receipt.durable,true);assert.equal(receipt.lifetimeMs,86400000);
 await writeFile(receiptPath,JSON.stringify({...receipt,oldSession:c.transport.sessionId}),{mode:0o600});
 const kit=await c.call('firmware_kit',{projectId:p.projectId});const response=await fetch(kit.downloadUrl);assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,kit.byteLength);
 console.log(JSON.stringify({phase,tools:(await c.client.listTools()).tools.length,durable:receipt.durable,kitBytes:kit.byteLength,token:'redacted'}));
 }else{
 const saved=JSON.parse(await readFile(receiptPath,'utf8'));
 // Connect in a different shard to exercise Durable Object RPC.
 if(c.transport.sessionId[0]===saved.token[0]){await c.transport.terminateSession();await c.client.close();console.log('Retry restore for different shard');process.exitCode=2;}else{
 const p=await c.call('restore',{token:saved.token});assert.equal(p.identity.productName,'Restart witness sensor');
 assert.equal((await c.call('validate',{projectId:p.projectId})).valid,true);
 assert.equal((await c.call('delete_saved',{token:saved.token})).deleted,true);
 await assert.rejects(c.call('restore',{token:saved.token}));
 console.log(JSON.stringify({phase,restoredAfterRestart:true,crossShard:true,revoked:true}));
 }
 }
}finally{await c.transport.terminateSession().catch(()=>{});await c.client.close();}

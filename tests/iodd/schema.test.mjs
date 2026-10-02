import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../../tools/iodd/node-runtime.mjs';
import * as api from '../../assets/js/iodd/project.js';
const module = await import('../../tools/iodd/schema.mjs').catch(() => ({}));
test('hosted schema validation capability is available', () => {
  assert.equal(typeof module.createHostedSchemaValidation, 'function');
});
test('external entities and oversized XML are rejected before fetching schemas', async () => {
  assert.equal(typeof module.createHostedSchemaValidation, 'function');
  let calls = 0;
  const validate = module.createHostedSchemaValidation({ fetchImpl: () => { calls++; throw Error('Unexpected request'); } });
  const bad = await validate({ xml: '<!DOCTYPE x [<!ENTITY leak SYSTEM "https://evil.test/">]><x>&leak;</x>', assets: [] });
  assert.equal(bad.schema.status, 'failed');
  assert.match(bad.schema.output, /DTD|entities/);
  const large = await validate({ xml: 'x'.repeat(1024 * 1024 + 1), assets: [] });
  assert.equal(large.schema.status, 'failed');
  assert.equal(calls, 0);
});
test('schema source has fixed URL and requires pinned archive hash', async () => {
  assert.equal(typeof module.createHostedSchemaValidation, 'function');
  let called;
  const validate = module.createHostedSchemaValidation({ fetchImpl: async (url, options) => {
    called = { url, options };
    return new Response(new Uint8Array([80,75,0,0]));
  }});
  const result = await validate(api.createNewProject());
  assert.equal(result.schema.status, 'unavailable');
  assert.match(result.schema.output, /digest/);
  assert.match(called.url, /^https:\/\/io-link.com\/fileadmin\/.*Oct2025.zip$/);
  assert.equal(called.options.redirect, 'manual');
});
test('schema downloads refuse redirects and oversized responses', async () => {
  for (const response of [new Response(null,{status:302,headers:{Location:'https://evil.test/schema.zip'}}),new Response('x',{headers:{'Content-Length':String(5*1024*1024)}})]) {
    let calls=0;
    const validate=module.createHostedSchemaValidation({fetchImpl:async()=>{calls++;return response;}});
    const result=await validate(api.createNewProject());
    assert.equal(result.schema.status,'unavailable');
    assert.match(result.schema.output,/HTTP 302|size limit/);
    assert.equal(calls,1);
  }
});
test('Worker callback modules are static and linear memory is capped at32MiB', async () => {
  const bytes=await readFile(new URL('../../tools/iodd/schema-wasm/libxml2.wasm',import.meta.url));
  assert.equal(WebAssembly.validate(bytes),true);
  let offset=8,maximum;
  const leb=()=>{let result=0,shift=0,b;do{b=bytes[offset++];result|=(b&127)<<shift;shift+=7;}while(b&128);return result;};
  while(offset<bytes.length){const id=bytes[offset++],length=leb(),end=offset+length;if(id===5){assert.equal(leb(),1);assert.equal(leb(),1);leb();maximum=leb();}offset=end;}
  assert.equal(maximum,512);
  for(const signature of ['ii','iiii','vii']) {
    const callback=await readFile(new URL(`../../tools/iodd/schema-wasm/callback-${signature}.wasm`,import.meta.url));
    assert.equal(WebAssembly.validate(callback),true);
  }
  const glue=await readFile(new URL('../../tools/iodd/schema-wasm/libxml2raw.mjs',import.meta.url),'utf8');
  assert.ok(!glue.includes('new WebAssembly.Module('));
});
const archivePath = process.env.IODD_SCHEMA_ARCHIVE;
test('official October2025 includes validate templates and reject basic-valid XSD-invalid XML', {skip: !archivePath}, async () => {
  assert.equal(typeof module.createHostedSchemaValidation, 'function');
  const bytes = await readFile(archivePath);
  let requests = 0;
  const validate = module.createHostedSchemaValidation({ fetchImpl: async () => { requests++; return new Response(bytes); } });
  for (const template of ['counter', 'switching-sensor']) {
    const source = await readFile(new URL(`../../assets/iodd/${template}.xml`, import.meta.url), 'utf8');
    const result = await validate(api.createProject(source));
    assert.equal(result.schema.status, 'passed', result.schema.output);
    assert.equal(result.schema.provenance.sha256, 'd4b3f53bfc777e45938cf7b7d14fe9b65aa4dccea6875745b3912e1cc59d4dd2');
    assert.equal(result.officialChecker.status, 'unavailable');
  }
  const project = api.createNewProject();
  project.xml = project.xml.replace('<DocumentInfo ', '<DocumentInfo unknownSchemaAttribute="bad" ');
  assert.equal(api.validateProject(project).valid, true);
  const invalid = await validate(project);
  assert.equal(invalid.schema.status, 'failed');
  assert.match(invalid.schema.output, /unknownSchemaAttribute/);
  const maliciousHint=api.createNewProject();
  maliciousHint.xml=maliciousHint.xml.replace(/xsi:schemaLocation="[^"]*"/,'xsi:schemaLocation="http://www.io-link.com/IODD/2010/10 https://evil.test/schema.xsd"');
  assert.equal((await validate(maliciousHint)).schema.status,'passed');
  assert.equal(requests, 1);
});

import { unzipSync } from 'fflate';
import { exportProjectXML, decodeBase64 } from '../../assets/js/iodd/project.js';
export const SCHEMA_SOURCE = Object.freeze({
  url: 'https://io-link.com/fileadmin/user_upload/Downloads/Package_2025/IO-Device-Description_Specification_10.012_V1.1.5_Oct2025.zip',
  sha256: 'd4b3f53bfc777e45938cf7b7d14fe9b65aa4dccea6875745b3912e1cc59d4dd2',
  version: 'IODD 1.1 / Specification 1.1.5, October 2025',
});
const prefix = 'IO-Device-Description_Specification_10.012_V1.1.5_Oct2025/Schemas/';
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', {fatal:true});
const MAX_ARCHIVE = 4 * 1024 * 1024, MAX_XML = 1024 * 1024;
const checker = {status:'unavailable', output:'Official IODD Checker 2025.1 executable is not installed. Its supplier download requires registration; XSD validation is a separate check.'};
function inputGuard(xml) {
  if (typeof xml !== 'string' || encode.encode(xml).length > MAX_XML) throw Error('Schema XML input exceeds the 1 MiB limit.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw Error('DTD declarations and entities are forbidden.');
  if ((xml.match(/<[A-Za-z_][^>]*>/g) ?? []).length > 16000) throw Error('Schema XML element limit exceeded.');
}
async function boundedResponse(response) {
  if (!response.ok) throw Error(`Official schema download failed: HTTP ${response.status}.`);
  if (Number(response.headers.get('Content-Length')) > MAX_ARCHIVE) throw Error('Schema archive size limit exceeded.');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Schema archive body is unavailable.');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_ARCHIVE) throw Error('Schema archive size limit exceeded.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const value of chunks) {bytes.set(value,offset); offset += value.byteLength;}
  return bytes;
}
async function fetchSchemas(fetchImpl) {
  // Workers supports manual redirects; reject every non-2xx response without following it.
  const response = await fetchImpl(SCHEMA_SOURCE.url, {redirect:'manual',signal:AbortSignal.timeout(15000)});
  const bytes = await boundedResponse(response);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if (hash !== SCHEMA_SOURCE.sha256) throw Error('Official schema archive digest mismatch.');
  const files = unzipSync(bytes,{filter:file => file.name.startsWith(prefix) && /^[A-Za-z0-9.-]+\.xsd$/.test(file.name.slice(prefix.length))});
  const schemas = Object.create(null); let size = 0;
  for (const [path,data] of Object.entries(files)) {
    size += data.length;
    if (size > 512*1024) throw Error('Expanded schema size limit exceeded.');
    schemas[path.slice(prefix.length)] = data;
  }
  if (!schemas['IODD1.1.xsd'] || Object.keys(schemas).length !== 11) throw Error('Official schema files are incomplete.');
  for (const data of Object.values(schemas)) {
    const text = decode.decode(data); inputGuard(text);
    const markup = text.replace(/<!--[\s\S]*?-->/g,'');
    for (const tag of markup.matchAll(/<(?:[\w.-]+:)?(?:include|import)\b[^>]*>/g))
      for (const match of tag[0].matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g))
        if (!Object.hasOwn(schemas,match[1])) throw Error('Schema include must resolve within the pinned archive.');
  }
  return schemas;
}
/** Operator-only hooks: no request-supplied URL, filesystem, schemas or code. */
export function createHostedSchemaValidation({fetchImpl=fetch,loadLibrary=()=>import('libxml2-wasm')}={}) {
  let enginePromise;
  async function engine() {
    if (!enginePromise) enginePromise = (async()=> {
      const schemas = await fetchSchemas(fetchImpl), lib = await loadLibrary();
      // No native filesystem provider is registered. Only these11 authenticated filenames match.
      lib.xmlCleanupInputProvider();
      lib.xmlRegisterInputProvider(new lib.XmlBufferInputProvider(schemas));
      let schema;
      try {
        schema = lib.XmlDocument.fromBuffer(schemas['IODD1.1.xsd'],{url:'IODD1.1.xsd',option:lib.ParseOption.XML_PARSE_NONET|lib.ParseOption.XML_PARSE_NO_XXE});
        return {lib,validator:lib.XsdValidator.fromDoc(schema)};
      } finally {schema?.dispose();lib.xmlCleanupInputProvider();}
    })().catch(error=> {enginePromise=undefined;throw error;});
    return enginePromise;
  }
  return async function validate(project) {
    const base = {validator:'libxml2-wasm 0.7.2 / libxml2 XSD 1.0',provenance:SCHEMA_SOURCE};
    let documents;
    try {
      inputGuard(project.xml);
      documents = [exportProjectXML(project)];
      for (const asset of project.assets ?? []) if (/\.xml$/i.test(asset.name)) {
        const xml = decode.decode(decodeBase64(asset.base64)); inputGuard(xml);
        if (/<(?:[A-Za-z_][\w.-]*:)?ExternalTextDocument(?:\s|>)/.test(xml)) documents.push(xml);
      }
      if (documents.reduce((total,xml)=>total+encode.encode(xml).length,0)>MAX_XML) throw Error('Combined schema XML input exceeds the 1 MiB limit.');
    } catch(error) {return {schema:{...base,status:'failed',output:error.message},officialChecker:checker};}
    let compiled;
    try {compiled=await engine();} catch(error) {return {schema:{...base,status:'unavailable',output:error.message.slice(0,4096)},officialChecker:checker};}
    try {
      for (const xml of documents) {
        let doc;
        try {doc=compiled.lib.XmlDocument.fromString(xml,{option:compiled.lib.ParseOption.XML_PARSE_NONET|compiled.lib.ParseOption.XML_PARSE_NO_XXE});compiled.validator.validate(doc);}
        finally {doc?.dispose();}
      }
      return {schema:{...base,status:'passed',output:`Official XSD validates ${documents.length} XML document(s).`},officialChecker:checker};
    } catch(error) {return {schema:{...base,status:'failed',output:error.message.slice(0,4096)},officialChecker:checker};}
  };
}

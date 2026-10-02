import * as library from './schema-wasm/index.mjs';
import { createHostedSchemaValidation } from './schema.mjs';
/** Cached per Durable Object instance; schema ZIP is fetched lazily from fixed upstream. */
export function createWorkerSchemaValidation(options={}) {
  return createHostedSchemaValidation({...options,loadLibrary:async()=>library});
}

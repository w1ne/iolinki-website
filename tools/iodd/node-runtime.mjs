// Node uses the same import guards and generic XML model as the browser.
import { DOMParser as NativeDOMParser } from "@xmldom/xmldom";
export class DOMParser {
  parseFromString(source, mime) {
    return new NativeDOMParser({
      onError(level, message) {
        throw new Error(`XML syntax is invalid: ${message}`);
      },
    }).parseFromString(source, mime);
  }
}
globalThis.DOMParser = DOMParser;

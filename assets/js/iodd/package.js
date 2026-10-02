import { importTextXML, exportXML } from "./document.js";
import { verifyStampCrc } from "./vendor/checker/crc.mjs";
import { Inflate, zipSync } from "./vendor/fflate.js";
import {
  LIMITS,
  createProject,
  loadProject,
  validateName,
  encodeBase64,
  decodeBase64,
  exportProjectXML,
  missingAssets,
} from "./project.js";
const utf8 = new TextDecoder("utf-8", { fatal: true }),
  encoder = new TextEncoder();
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
// Parse the directory before inflating. Stream small compressed chunks and enforce
// actual output limits too, so forged expanded sizes cannot bypass the budget.
export async function readPackageFiles(
  bytes,
  { allowDirectories = true } = {},
) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length > LIMITS.total ||
    bytes.length < 22
  )
    throw Error("ZIP package must be at most 16 MiB.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = (p) => dv.getUint16(p, true),
    u32 = (p) => dv.getUint32(p, true);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) {
      end = p;
      break;
    }
  if (end < 0) throw Error("Invalid ZIP directory.");
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
    throw Error("Multi-disk ZIP is not supported.");
  const count = u16(end + 10),
    start = u32(end + 16),
    size = u32(end + 12);
  if (!count || count > LIMITS.files || start + size !== end)
    throw Error("ZIP directory or file count exceeds limits.");
  const files = [],
    names = new Set(),
    ranges = [];
  let cursor = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50)
      throw Error("Invalid ZIP entry.");
    const flags = u16(cursor + 8),
      method = u16(cursor + 10),
      crc = u32(cursor + 16),
      compressed = u32(cursor + 20),
      expanded = u32(cursor + 24),
      nl = u16(cursor + 28),
      el = u16(cursor + 30),
      cl = u16(cursor + 32),
      offset = u32(cursor + 42);
    if (
      cursor + 46 + nl + el + cl > end ||
      offset + 30 > start ||
      expanded === 0xffffffff ||
      compressed === 0xffffffff ||
      flags & ~0x808 ||
      ![0, 8].includes(method)
    )
      throw Error("Unsupported ZIP flags, compression or ZIP64.");
    const name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nl));
    const directory = name.endsWith("/");
    if (directory && !allowDirectories)
      throw Error("ZIP directories are not allowed for this package.");
    validateName(directory ? name.slice(0, -1) : name);
    if (directory && expanded !== 0)
      throw Error("ZIP directory must be empty.");
    const key = name.toLowerCase();
    if (names.has(key)) throw Error("Duplicate ZIP file name.");
    names.add(key);
    total += expanded;
    if (total > LIMITS.total) throw Error("ZIP expanded size exceeds 16 MiB.");
    if (
      u32(offset) !== 0x04034b50 ||
      u16(offset + 6) !== flags ||
      u16(offset + 8) !== method
    )
      throw Error("ZIP local entry differs from directory.");
    const localNl = u16(offset + 26),
      localEl = u16(offset + 28),
      dataStart = offset + 30 + localNl + localEl,
      dataEnd = dataStart + compressed;
    if (
      dataEnd > start ||
      utf8.decode(bytes.subarray(offset + 30, offset + 30 + localNl)) !== name
    )
      throw Error("ZIP local file name or size differs from directory.");
    if (
      !(flags & 8) &&
      (u32(offset + 14) !== crc ||
        u32(offset + 18) !== compressed ||
        u32(offset + 22) !== expanded)
    )
      throw Error("ZIP local sizes differ from directory.");
    if (ranges.some(([a, b]) => offset < b && a < dataEnd))
      throw Error("Overlapping ZIP entries.");
    ranges.push([offset, dataEnd]);
    files.push({ name, directory, method, crc, expanded, dataStart, dataEnd });
    cursor += 46 + nl + el + cl;
  }
  if (cursor !== end) throw Error("Invalid ZIP directory size.");
  let actualTotal = 0;
  const decoded = [];
  for (const file of files) {
    let output;
    if (file.method === 0) {
      output = bytes.slice(file.dataStart, file.dataEnd);
      actualTotal += output.length;
    } else {
      const chunks = [];
      let length = 0;
      const stream = new Inflate((chunk) => {
        length += chunk.length;
        actualTotal += chunk.length;
        if (length > file.expanded || actualTotal > LIMITS.total)
          throw Error(
            "ZIP decompressed size exceeds the declared size or 16 MiB limit.",
          );
        chunks.push(chunk.slice());
      });
      if (file.dataStart === file.dataEnd) stream.push(new Uint8Array(), true);
      for (let p = file.dataStart; p < file.dataEnd; p += 128)
        stream.push(
          bytes.subarray(p, Math.min(p + 128, file.dataEnd)),
          p + 128 >= file.dataEnd,
        );
      output = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
    }
    if (
      actualTotal > LIMITS.total ||
      output.length !== file.expanded ||
      crc32(output) !== file.crc
    )
      throw Error("ZIP content size or CRC is invalid.");
    if (!file.directory) decoded.push({ name: file.name, bytes: output });
  }
  return decoded;
}
export async function importPackage(bytes) {
  const decoded = await readPackageFiles(bytes);
  const candidates = decoded.filter(
    (f) =>
      /\.xml$/i.test(f.name) &&
      /<(?:[A-Za-z_][\w.-]*:)?IODevice(?:\s|>)/.test(utf8.decode(f.bytes)),
  );
  if (candidates.length !== 1)
    throw Error(
      "Package must contain exactly one main IODevice XML; multiple or missing documents are ambiguous.",
    );
  const main = candidates[0];
  const project = createProject(utf8.decode(main.bytes), main.name);
  project.assets = decoded
    .filter((f) => f !== main)
    .map((f) => ({ name: f.name, base64: encodeBase64(f.bytes) }));
  return loadProject(project);
}
export async function exportPackage(project) {
  project = loadProject(project);
  const missing = missingAssets(project);
  if (missing.length)
    throw Error("Missing package assets: " + missing.join(", "));
  const files = Object.create(null);
  const mainXML = exportProjectXML(project);
  files[project.filename] = encoder.encode(mainXML);
  const mainIoddCrc = verifyStampCrc(files[project.filename]).stored;
  for (const asset of project.assets) {
    const bytes = decodeBase64(asset.base64);
    if (/\.xml$/i.test(asset.name)) {
      const text = utf8.decode(bytes);
      if (/<ExternalTextDocument(?:\s|>)/.test(text)) {
        const doc = importTextXML(text);
        let unchanged = false;
        try {
          unchanged =
            mainXML === project.xml &&
            verifyStampCrc(bytes, { mainIoddCrc }).valid;
        } catch {}
        files[asset.name] = unchanged
          ? bytes
          : encoder.encode(exportXML(doc, { mainIoddCrc }));
        continue;
      }
    }
    files[asset.name] = bytes;
  }
  const result = zipSync(files, {
    level: 6,
    mtime: new Date(1980, 0, 1, 0, 0, 0),
  });
  if (result.length > LIMITS.total)
    throw Error("Compressed package exceeds 16 MiB.");
  return result;
}

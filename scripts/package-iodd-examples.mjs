#!/usr/bin/env node
import "../tools/iodd/node-runtime.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  createProject,
  inspectProject,
  generateFirmwareHeader,
  encodeBase64,
  validateProject,
} from "../assets/js/iodd/project.js";
import { exportPackage } from "../assets/js/iodd/package.js";
const root = new URL("../", import.meta.url),
  encoder = new TextEncoder();
const kinds = ["counter", "switching-sensor"];
function mapping(view) {
  const rows = [
    "| Direction | Field | Subindex | Bit offset | Width |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const pd of view.processData)
    for (const field of pd.fields)
      rows.push(
        `| ${pd.direction === "in" ? "Input" : "Output"} | ${field.name} | ${field.subindex} | ${field.offset} | ${field.bits} |`,
      );
  return rows.join("\n");
}
function parameters(view) {
  if (!view.variables.length)
    return "This counter example has no application ISDU parameters. Standard identification records remain in the IODD.";
  return [
    "| Parameter | ISDU index | Access | Default | Width |",
    "| --- | --- | --- | --- | --- |",
    ...view.variables.map(
      (v) =>
        `| ${v.name} | ${v.index} | ${v.access} | ${v.defaultValue || "Command; no default"} | ${v.bits} bits |`,
    ),
  ].join("\n");
}
function exampleGuide(kind, view, xmlFilename) {
  const name =
    kind === "counter" ? "Counter, button and LED" : "Switching sensor";
  const application =
    kind === "counter"
      ? "The released reference-device demo produces a 16-bit counter followed by one button/state byte. Output bit 0 drives the LED; preserve the remaining output bits when changing it."
      : "The released switching-sensor application returns a 16-bit measurement scaled by 100, a validity bit and a switching-output bit. Its ISDU service supplies setpoint, hysteresis, inversion and a teach command.";
  return `# ${name} — importable IODD example\n\nThis package contains stamped ${xmlFilename}, this guide, a generated C firmware mapping header and both MIT/GPL license grants. The iolinki-authored XML templates are additionally available under MIT; this does not change the protocol stack license. Import the ZIP directly into the browser editor or another IODD importer. The examples describe the released [iolinki stack](https://github.com/w1ne/iolinki) applications.\n\n${application}\n\n## Identity and use\n\nVendor ID ${view.identity.vendorId} and device ID ${view.identity.deviceId} are example identifiers. Product ID: ${view.identity.productId}. Replace example identity with IDs assigned to your own device before production use. Importing a file does not program the device or change its firmware IDs. A connected device must expose matching identity and process-data lengths.\n\n## Parameters\n\n${parameters(view)}\n\n## Process data\n\n${mapping(view)}\n\nByte 0 is most significant. IODD offset 0 denotes the least-significant bit of the final process-data byte. Use the generated \`iodd_read_bits\` / \`iodd_write_bits\` helpers to avoid host endianness or packed-struct assumptions. ${kind === "counter" ? "Input length is 3 bytes; output length is 1 byte." : "Input length is 3 bytes; no process-data output is declared."}\n\n## Reopen and generate\n\nFrom the iolinki website source checkout:\n\n\`\`\`sh\nnode tools/iodd/cli.mjs import --format package --input downloads/iodd-${kind}.zip --output ${kind}.project.json\nnode tools/iodd/cli.mjs inspect --input ${kind}.project.json\nnode tools/iodd/cli.mjs validate --input ${kind}.project.json\nnode tools/iodd/cli.mjs export --input ${kind}.project.json --format xml --output ${kind}.xml\nnode tools/iodd/cli.mjs header --input ${kind}.project.json --output ${kind}-mapping.h\n\`\`\`\n\nThe repository's firmware proof compiles and runs the released application C against generated indexes, parameter defaults and bit mappings. That provides host execution evidence; physical IO-Link communication and hardware behavior require a connected-device test. Basic model/CRC validation, official XSD validation and official checker approval are separate results. This package contains no manufacturer declaration.\n`.replaceAll(
    "\`",
    "`",
  );
}
export async function buildExample(kind) {
  if (!kinds.includes(kind))
    throw Error("Choose counter or switching-sensor example.");
  const xml = await readFile(new URL(`assets/iodd/${kind}.xml`, root), "utf8"),
    initial = createProject(xml, `${kind}.xml`),
    view = inspectProject(initial);
  const xmlFilename = `${view.identity.vendorName}-${view.identity.productId}-${view.identity.releaseDate.replaceAll("-", "")}-IODD1.1.xml`;
  const project = createProject(xml, xmlFilename),
    header = generateFirmwareHeader(project),
    guide = exampleGuide(kind, view, xmlFilename),
    license = await readFile(
      new URL("assets/iodd/LICENSE.GPL-3.0", root),
      "utf8",
    );
  const mit = await readFile(new URL("tools/iodd/LICENSE", root), "utf8");
  project.assets = [
    { name: "README.md", base64: encodeBase64(encoder.encode(guide)) },
    {
      name: "firmware-mapping.h",
      base64: encodeBase64(encoder.encode(header)),
    },
    { name: "LICENSE.GPL-3.0", base64: encodeBase64(encoder.encode(license)) },
    { name: "LICENSE.MIT", base64: encodeBase64(encoder.encode(mit)) },
  ];
  const validation = validateProject(project);
  if (!validation.packageValid)
    throw Error(
      "Example package failed validation: " +
        validation.issues.map((i) => i.message).join(" "),
    );
  return {
    filename: `iodd-${kind}.zip`,
    bytes: await exportPackage(project),
    project,
    header,
    guide,
    view,
  };
}
function publicGuide(examples) {
  return `# Importable IODD examples\n\nDownload and import these ZIPs directly into the [browser editor](https://iolinki.com/iodd-editor.html):\n\n${examples.map((e) => `- [${e.view.identity.productName}](https://iolinki.com/downloads/${e.filename}) — stamped XML, README, generated C mapping header and MIT/GPL licenses.`).join("\n")}\n\nExample vendor/device IDs: ${examples.map((e) => e.view.identity.productName + " " + e.view.identity.vendorId + "/" + e.view.identity.deviceId).join("; ")}. These IDs must match the connected firmware for automatic IODD selection. Replace them with assigned production identifiers when describing your own device.\n\n${examples.map((e) => exampleGuide(e.filename === "iodd-counter.zip" ? "counter" : "switching-sensor", e.view, e.project.filename)).join("\n---\n\n")}\n\n## Reproducible release files\n\nRun \`node scripts/package-iodd-examples.mjs\` to rebuild the downloadable ZIPs and this guide from the same engine/templates used by browser, CLI and MCP. Run with \`--check\` to verify committed files byte-for-byte without writing.\n`.replaceAll(
    "\`",
    "`",
  );
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--check"))
    throw Error("Usage: node scripts/package-iodd-examples.mjs [--check]");
  const check = args.includes("--check"),
    examples = await Promise.all(kinds.map(buildExample));
  const outputs = [
    ...examples.map((e) => ({
      url: new URL(`downloads/${e.filename}`, root),
      data: e.bytes,
    })),
    {
      url: new URL("docs/iodd-examples.md", root),
      data: encoder.encode(publicGuide(examples)),
    },
  ];
  for (const output of outputs) {
    if (check) {
      const current = new Uint8Array(await readFile(output.url));
      if (
        current.length !== output.data.length ||
        current.some((v, i) => v !== output.data[i])
      )
        throw Error("Stale example artifact: " + fileURLToPath(output.url));
    } else await writeFile(output.url, output.data);
  }
  console.log(
    check
      ? "Public IODD example ZIPs and guide match deterministic engine output."
      : "Built importable counter and switching-sensor ZIPs plus guide.",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

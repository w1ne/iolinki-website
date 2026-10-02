import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../../tools/iodd/node-runtime.mjs";
import * as p from "../../assets/js/iodd/project.js";
import { importPackage, exportPackage } from "../../assets/js/iodd/package.js";
import { zipSync } from "fflate";
const xml = readFileSync(
  new URL("../../assets/iodd/counter.xml", import.meta.url),
  "utf8",
);
test("project roundtrip, atomic edits and malformed XML rejection", () => {
  const a = p.createProject(xml, "counter.xml"),
    saved = p.saveProject(a);
  assert.deepEqual(p.loadProject(saved), a);
  assert.throws(() =>
    p.applyOperation(a, { type: "identity", values: { vendorId: 70000 } }),
  );
  assert.equal(p.saveProject(a), saved);
  assert.throws(() =>
    p.createProject(
      xml.replace('vendorId="1234"', 'vendorId="1234" vendorId="2"'),
    ),
  );
  const b = p.applyOperation(a, {
    type: "addVariable",
    values: { name: "Threshold", index: 300 },
  });
  assert.equal(p.inspectProject(b).variables[0].index, "300");
  assert.ok(p.diffProjects(a, b).changes.length);
  assert.match(p.generateFirmwareHeader(b), /INDEX 300u/);
});
test("languages, genuine events and menus, process field changes", () => {
  let a = p.createProject(xml, "counter.xml");
  a = p.applyOperation(a, {
    type: "text",
    language: "de",
    id: "T_DeviceName",
    value: "Zähler",
  });
  a = p.applyOperation(a, {
    type: "event",
    values: {
      code: 32768,
      type: "Warning",
      name: "Overload",
      description: "Check load",
    },
  });
  a = p.applyOperation(a, {
    type: "menu",
    values: {
      id: "M_Custom",
      name: "Custom",
      variableIds: ["V_ProductID"],
      menuIds: [],
    },
  });
  a = p.applyOperation(a, {
    type: "addProcessField",
    id: "PD_OUT",
    values: { name: "Reset", offset: 1, bits: 1, type: "BooleanT" },
  });
  assert.equal(p.inspectProject(a).processData[1].fields.length, 2);
  a = p.applyOperation(a, {
    type: "removeProcessField",
    id: "PD_OUT",
    index: 1,
  });
  assert.equal(p.validateProject(a).valid, true);
  assert.match(p.exportProjectXML(a), /Event code="32768" type="Warning"/);
  assert.throws(() =>
    p.applyOperation(a, {
      type: "menu",
      values: { id: "M_Bad", name: "Bad", variableIds: ["V_NO"] },
    }),
  );
});
test("ZIP preserves auxiliary files, rejects traversal and duplicate XML choice", async () => {
  let a = p.createProject(xml, "counter.xml");
  a = p.applyOperation(a, {
    type: "asset",
    name: "pictures/device.png",
    base64: "AQID",
  });
  a = p.applyOperation(a, {
    type: "asset",
    name: "counter-de.xml",
    base64: btoa("<Language/>"),
  });
  const b = await importPackage(await exportPackage(a));
  assert.deepEqual(b.assets, a.assets);
  assert.equal(p.validateProject(b).valid, true);
  await assert.rejects(
    importPackage(zipSync({ "../bad.xml": new TextEncoder().encode(xml) })),
    /name|path/i,
  );
  await assert.rejects(
    importPackage(
      zipSync({
        "a.xml": new TextEncoder().encode(xml),
        "b.xml": new TextEncoder().encode(xml),
      }),
    ),
    /one|multiple|ambiguous/i,
  );
});
test("firmware bit helper decodes released counter byte order and metadata-only changes stay compatible", () => {
  const a = p.createProject(xml, "counter.xml");
  const b = p.applyOperation(a, {
    type: "identity",
    values: { productName: "Renamed" },
  });
  assert.equal(p.diffProjects(a, b).mappingCompatible, true);
  assert.match(p.generateFirmwareHeader(a), /IODD_PD_IN_BYTES 3u/);
  assert.match(p.generateFirmwareHeader(a), /iodd_read_bits/);
});
test("ZIP enforces expansion cap against dishonest directory sizes and CRC damage", async () => {
  const zip = zipSync({ "counter.xml": new TextEncoder().encode(xml) });
  const forged = zip.slice(),
    dv = new DataView(forged.buffer);
  let cd = 0;
  for (let i = 0; i < forged.length - 4; i++)
    if (dv.getUint32(i, true) === 0x02014b50) {
      cd = i;
      break;
    }
  dv.setUint32(cd + 24, 1, true);
  dv.setUint32(22, 1, true);
  await assert.rejects(importPackage(forged), /decompressed|declared|size/i);
  const damaged = zip.slice();
  damaged[14] ^= 1;
  await assert.rejects(importPackage(damaged), /CRC|directory/i);
  assert.throws(
    () =>
      p.applyOperation(p.createProject(xml), {
        type: "asset",
        name: "..\\x",
        base64: "AQID",
      }),
    /name|path/i,
  );
});
test("duplicate translation IDs scoped per language and destructive refs protected", () => {
  let a = p.createProject(xml);
  a = p.applyOperation(a, {
    type: "text",
    language: "de",
    id: "T_DeviceName",
    value: "Zähler",
  });
  a = p.applyOperation(a, {
    type: "text",
    language: "fr",
    id: "T_DeviceName",
    value: "Compteur",
  });
  assert.equal(p.validateProject(a).valid, true);
  assert.throws(
    () =>
      p.applyOperation(a, {
        type: "menu",
        values: { id: "M_Custom", name: "Empty", variableIds: [] },
      }),
    /reference|entry/i,
  );
  assert.throws(
    () => p.applyOperation(a, { type: "removeMenu", id: "M_Parameter" }),
    /referenced/i,
  );
});
test("generated header compiles and decodes big-endian counter/button plus writes output", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "iodd-header-test-"));
  try {
    writeFileSync(
      join(dir, "mapping.h"),
      p.generateFirmwareHeader(p.createProject(xml)),
    );
    writeFileSync(
      join(dir, "main.c"),
      '#include "mapping.h"\nint main(void){uint8_t in[]={0x12,0x34,0x03}; uint8_t out[]={0x80}; if(iodd_read_bits(in,IODD_PD_IN_BYTES,IODD_PD_IN_FIELD_1_OFFSET,IODD_PD_IN_FIELD_1_BITS)!=0x1234)return 1; if(iodd_read_bits(in,IODD_PD_IN_BYTES,IODD_PD_IN_FIELD_2_OFFSET,IODD_PD_IN_FIELD_2_BITS)!=3)return 2; if(!iodd_write_bits(out,IODD_PD_OUT_BYTES,IODD_PD_OUT_FIELD_1_OFFSET,IODD_PD_OUT_FIELD_1_BITS,1)||out[0]!=0x81)return 3; if(iodd_read_bits(in,3,24,1)!=0)return 4;return 0;}',
    );
    const compiled = spawnSync(
      "cc",
      [
        "-std=c99",
        "-Wall",
        "-Wextra",
        "-Werror",
        join(dir, "main.c"),
        "-o",
        join(dir, "proof"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(spawnSync(join(dir, "proof")).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("firmware diff detects mapping changes but permits parameter label changes", () => {
  let a = p.applyOperation(p.createProject(xml), {
    type: "addVariable",
    values: { name: "Threshold" },
  });
  const id = p.inspectProject(a).variables[0].id;
  assert.equal(
    p.diffProjects(
      a,
      p.applyOperation(a, {
        type: "editVariable",
        id,
        values: { name: "Setpoint" },
      }),
    ).mappingCompatible,
    true,
  );
  assert.equal(
    p.diffProjects(
      a,
      p.applyOperation(a, { type: "editVariable", id, values: { index: 400 } }),
    ).mappingCompatible,
    false,
  );
});
test("unknown supported XML sections are preserved and revisions report their changes", () => {
  const a = p.createProject(
    xml.replace("<Features ", "<!-- retained note --><Features "),
  );
  const b = p.createProject(a.xml.replace("retained note", "changed note"));
  assert.match(p.exportProjectXML(a), /retained note/);
  assert.ok(p.diffProjects(a, b).changes.length);
});
test("complex menu refs remain untouched when a simple menu operation would discard attributes", () => {
  const a = p.createProject(
    xml.replace(
      '<VariableRef variableId="V_DirectParameters_1" />',
      '<VariableRef variableId="V_DirectParameters_1" buttonValue="1" />',
    ),
  );
  assert.throws(
    () =>
      p.applyOperation(a, {
        type: "menu",
        values: {
          id: "M_Identification",
          name: "Identification",
          variableIds: ["V_DirectParameters_1"],
        },
      }),
    /complex|XML/i,
  );
});
test("external language assets are inspected and edited without creating conflicting internal language", async () => {
  const external =
    '<?xml version="1.0" encoding="UTF-8"?><ExternalTextDocument xmlns="http://www.io-link.com/IODD/2010/10"><DocumentInfo copyright="Example" releaseDate="2026-10-02" version="V1.0"/><Language xml:lang="de"><Text id="T_DeviceName" value="Zähler"/></Language></ExternalTextDocument>';
  let a = p.applyOperation(p.createProject(xml, "counter.xml"), {
    type: "asset",
    name: "counter-de.xml",
    base64: p.encodeBase64(new TextEncoder().encode(external)),
  });
  assert.equal(
    p.inspectProject(a).texts.find((t) => t.language === "de").asset,
    "counter-de.xml",
  );
  a = p.applyOperation(a, {
    type: "text",
    language: "de",
    id: "T_DeviceName",
    value: "Neuer Zähler",
  });
  assert.doesNotMatch(a.xml, /<Language xml:lang="de"/);
  assert.match(
    new TextDecoder().decode(p.decodeBase64(a.assets[0].base64)),
    /Neuer Zähler/,
  );
  assert.equal(
    p
      .inspectProject(await importPackage(await exportPackage(a)))
      .texts.find((t) => t.language === "de").texts[0].value,
    "Neuer Zähler",
  );
});
test("typed references, orphan translations and missing package assets are diagnosed", async () => {
  const wrong = p.createProject(
    xml.replace(
      'VendorText textId="T_VendorText"',
      'VendorText textId="V_ProductID"',
    ),
  );
  assert.equal(p.validateProject(wrong).valid, false);
  const orphan = p.createProject(
    xml.replace(
      "</ExternalTextCollection>",
      '<Language xml:lang="de"><Text id="T_NoPrimary" value="Orphan"/></Language></ExternalTextCollection>',
    ),
  );
  assert.equal(p.validateProject(orphan).valid, false);
  const missing = p.createProject(
    xml.replace(
      "<VendorText ",
      '<VendorLogo name="Example-logo.png"/><VendorText ',
    ),
  );
  assert.equal(p.validateProject(missing).packageValid, false);
  assert.ok(
    p
      .validateProject(missing)
      .issues.some((i) => /missing.*asset/i.test(i.message)),
  );
  await assert.rejects(exportPackage(missing), /asset/i);
});
test("ZIP accepts safe directory entries without creating directory assets", async () => {
  const zipped = zipSync({
    "nested/": new Uint8Array(),
    "nested/main.xml": new TextEncoder().encode(xml),
  });
  const a = await importPackage(zipped);
  assert.equal(a.filename, "nested/main.xml");
  assert.deepEqual(a.assets, []);
});
test("firmware C literals and compatibility normalize decimal leading zeros", () => {
  const a = p.createProject(xml),
    b = p.createProject(
      xml
        .replace('vendorId="1234"', 'vendorId="01234"')
        .replace('deviceId="5678"', 'deviceId="05678"')
        .replace('bitOffset="8"', 'bitOffset="08"'),
    );
  assert.match(p.generateFirmwareHeader(b), /#define IODD_VENDOR_ID 1234u/);
  assert.match(p.generateFirmwareHeader(b), /#define IODD_DEVICE_ID 5678u/);
  assert.match(
    p.generateFirmwareHeader(b),
    /#define IODD_PD_IN_FIELD_1_OFFSET 8u/,
  );
  assert.equal(p.diffProjects(a, b).mappingCompatible, true);
});
test("Node/browser shared guards reject illegal XML characters and numeric entities", () => {
  for (const invalid of ["\u0001", "&#0;", "&#xD800;", "&#xFFFE;"])
    assert.throws(
      () => p.createProject(xml.replace("iolinki example", invalid)),
      /character|syntax/i,
    );
  assert.doesNotThrow(() =>
    p.createProject(xml.replace("iolinki example", "😀")),
  );
});
test("external language CRC follows stamped main XML after language and identity edits", async () => {
  const { exportXML, importTextXML } =
    await import("../../assets/js/iodd/document.js");
  const { verifyStampCrc } =
    await import("../../assets/js/iodd/vendor/checker/crc.mjs");
  const external =
    '<?xml version="1.0" encoding="UTF-8"?><ExternalTextDocument xmlns="http://www.io-link.com/IODD/2010/10"><DocumentInfo copyright="Example" releaseDate="2026-10-02" version="V1.0"/><Language xml:lang="de"><Text id="T_DeviceName" value="Zähler"/></Language><Stamp crc="0"><Checker name="original" version="V1.0"/></Stamp></ExternalTextDocument>';
  let a = p.applyOperation(p.createProject(xml, "counter.xml"), {
    type: "asset",
    name: "counter-de.xml",
    base64: p.encodeBase64(new TextEncoder().encode(external)),
  });
  assert.ok(
    p.validateProject(a).issues.some((n) => /external.*CRC/i.test(n.message)),
  );
  a = p.applyOperation(a, {
    type: "text",
    language: "de",
    id: "T_DeviceName",
    value: "Neu",
  });
  a = p.applyOperation(a, {
    type: "identity",
    values: { productName: "New counter" },
  });
  const b = await importPackage(await exportPackage(a)),
    main = new TextEncoder().encode(b.xml),
    mainCRC = verifyStampCrc(main).stored;
  assert.equal(
    verifyStampCrc(p.decodeBase64(b.assets[0].base64), { mainIoddCrc: mainCRC })
      .valid,
    true,
  );
  assert.equal(
    p.validateProject(b).issues.some((n) => /external.*CRC/i.test(n.message)),
    false,
  );
});
test("unused new menus get actionable navigation warning without blocking creation", () => {
  const a = p.applyOperation(p.createProject(xml), {
    type: "menu",
    values: { id: "M_Unused", name: "Unused", variableIds: ["V_ProductID"] },
  });
  const result = p.validateProject(a);
  assert.equal(result.valid, true);
  assert.ok(
    result.issues.some(
      (n) =>
        n.severity === "warning" &&
        /M_Unused.*not referenced|unreachable.*M_Unused/i.test(n.message),
    ),
  );
});

test('authoring starters include mandatory standard variables and preserve the single teach command', () => {
  for (const source of [xml, readFileSync(new URL('../../assets/iodd/switching-sensor.xml', import.meta.url), 'utf8'), p.createNewProject().xml]) {
    for (const id of ['V_DirectParameters_1', 'V_DirectParameters_2', 'V_ProductName'])
      assert.match(source, new RegExp('<StdVariableRef id="' + id + '"'));
  }
  const sensor = p.createProject(readFileSync(new URL('../../assets/iodd/switching-sensor.xml', import.meta.url), 'utf8'));
  const teach = p.inspectProject(sensor).variables.find(v => v.id === 'V_Teach');
  assert.deepEqual(teach.singleValues, ['1']);
  assert.equal(teach.lower, '');
  assert.equal(teach.upper, '');
  assert.equal(teach.editable, false);
  assert.match(p.exportProjectXML(sensor), /<SingleValue value="1"/);
  assert.match(sensor.xml, /<Config1 index="24" testValue="0x49"/);
  assert.match(sensor.xml, /<Config2 index="256" testValue="0x13,0x88"/);
});

test('generated starter filenames follow the official naming convention without changing identity', () => {
  const created = p.createNewProject({vendorName:'Vendor Example Inc.', productId:'sensor-01', releaseDate:'2026-10-02'});
  assert.equal(created.filename, 'Vendor_Example_Inc_-sensor-01-20261002-IODD1.1.xml');
  assert.equal(p.inspectProject(created).identity.vendorName, 'Vendor Example Inc.');
  assert.equal(p.createNewProject({}, 'explicit.xml').filename, 'explicit.xml');
});

test('suggested names prefix leading hyphens while identity and explicit names remain intact', () => {
  const identity = {vendorName:'-Vendor', productId:'-sensor-01', releaseDate:'2026-10-02'};
  const created = p.createNewProject(identity);
  assert.equal(created.filename, '_-Vendor-_-sensor-01-20261002-IODD1.1.xml');
  assert.equal(p.inspectProject(created).identity.vendorName, '-Vendor');
  assert.equal(p.inspectProject(created).identity.productId, '-sensor-01');
  assert.equal(p.createNewProject(identity, '-explicit.xml').filename, '-explicit.xml');
  assert.equal(p.createProject(created.xml, 'nested/-imported.xml').filename, 'nested/-imported.xml');
});

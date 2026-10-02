import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import "../../tools/iodd/node-runtime.mjs";
import { zipSync, unzipSync } from "../../assets/js/iodd/vendor/fflate.js";
import { Crc32 } from "../../assets/js/iodd/vendor/checker/crc.mjs";
import {
  createFirmwarePackage,
  inspectFirmwarePackage,
} from "../../assets/js/iodd/firmware-package.js";
const metadata = {
  vendorId: 1234,
  vendorName: "Example",
  firmwareDescriptor: "Counter",
  releaseDate: "2026-10-02",
  version: "V1.0",
  copyright: "Example",
  fwRevision: "V2.0",
  hardwareIds: [
    { idPattern: "COUNTER-A", productName: "Counter", productId: "COUNTER" },
  ],
  binaryName: "firmware.bin",
  descriptions: [{ lang: "en", description: "Firmware\nrelease & <safe>" }],
  fwPasswordRequired: false,
  fwActivationRetryCount: 3,
};
const binary = new Uint8Array([0, 1, 2, 3, 255]);
test("IOLFW is deterministic, qualified XML plus original binary and ordered resources with correct CRC", async () => {
  const resources = [
    {
      id: "readme",
      name: "readme.txt",
      bytes: new TextEncoder().encode("Do not power off."),
    },
    { id: "iodd", name: "device.zip", bytes: new Uint8Array([1, 2, 3]) },
  ];
  const a = await createFirmwarePackage(metadata, binary, resources),
    b = await createFirmwarePackage(metadata, binary, resources);
  assert.deepEqual(a, b);
  const view = await inspectFirmwarePackage(a);
  assert.equal(view.filename, "Example-Counter-20261002-IOLFW1.0.iolfw");
  assert.equal(view.metadataFilename, "Example-Counter-20261002-IOLFW1.0.xml");
  assert.equal(view.validation.valid, true);
  assert.equal(view.binary.size, 5);
  assert.equal(view.binary.sha256.length, 64);
  assert.equal(
    view.metadata.descriptions[0].description,
    metadata.descriptions[0].description,
  );
  assert.deepEqual(unzipSync(a)["firmware.bin"], binary);
  assert.equal(view.resources[0].name, "readme.txt");
  const quoted = unzipSync(a),
    xmlName = view.metadataFilename;
  let alternate = new TextDecoder()
    .decode(quoted[xmlName])
    .replace(/iolfw:crc="\d+"/, "iolfw:crc = ''");
  alternate = alternate.replace(
    "<iolfw:IOLinkFWData",
    '<!-- iolfw:crc="111" -->\n<iolfw:IOLinkFWData',
  );
  const expectedCRC = new Crc32()
    .update(new TextEncoder().encode(alternate))
    .update(binary);
  for (const r of resources) expectedCRC.update(r.bytes);
  alternate = alternate.replace(
    "iolfw:crc = ''",
    `iolfw:crc = '${expectedCRC.value}'`,
  );
  quoted[xmlName] = new TextEncoder().encode(alternate);
  assert.equal(
    (await inspectFirmwarePackage(zipSync(quoted))).validation.valid,
    true,
  );
  const files = unzipSync(a);
  files["firmware.bin"][0] = 99;
  const corrupt = await inspectFirmwarePackage(zipSync(files));
  assert.equal(corrupt.validation.valid, false);
  assert.match(corrupt.validation.issues.join(" "), /CRC/);
});
test("IOLFW rejects unsafe file names, missing resources, invalid metadata and forged ZIP expansion", async () => {
  await assert.rejects(
    createFirmwarePackage(
      { ...metadata, binaryName: "../firmware.bin" },
      binary,
    ),
    /name|flat/i,
  );
  await assert.rejects(
    createFirmwarePackage({ ...metadata, hardwareIds: [] }, binary),
    /hardware/i,
  );
  await assert.rejects(
    createFirmwarePackage({ ...metadata, vendorId: 70000 }, binary),
    /vendorId/i,
  );
  await assert.rejects(
    createFirmwarePackage({ ...metadata, releaseDate: "2026-02-30" }, binary),
    /date/i,
  );
  await assert.rejects(
    createFirmwarePackage(metadata, binary, [
      { id: "same", name: "firmware.bin", bytes: binary },
    ]),
    /duplicate/i,
  );
  const a = await createFirmwarePackage(metadata, binary, [
    { id: "readme", name: "readme.txt", bytes: binary },
  ]);
  const files = unzipSync(a);
  delete files["readme.txt"];
  await assert.rejects(inspectFirmwarePackage(zipSync(files)), /missing/i);
  await assert.rejects(
    inspectFirmwarePackage(zipSync({ ...files, "folder/evil.bin": binary })),
    /flat|name|missing/i,
  );
  const good = await createFirmwarePackage(metadata, binary);
  await assert.rejects(
    inspectFirmwarePackage(
      zipSync({ ...unzipSync(good), "folder/": new Uint8Array() }),
    ),
    /director|flat/i,
  );
  const forged = good.slice(),
    dv = new DataView(forged.buffer);
  let cd = 0;
  for (let i = 0; i < forged.length - 4; i++)
    if (dv.getUint32(i, true) === 0x02014b50) {
      cd = i;
      break;
    }
  dv.setUint32(cd + 24, 1, true);
  dv.setUint32(22, 1, true);
  await assert.rejects(
    inspectFirmwarePackage(forged),
    /declared|size|decompressed/i,
  );
  await assert.rejects(
    inspectFirmwarePackage(good, "Wrong.iolfw"),
    /filename/i,
  );
});
const base =
  "/tmp/io-link-fwupdate-v121/IO-Link_Profile_Firmware-Update_10.082_V1.2.1_Oct2025";
const example =
  process.env.IOLFW_EXAMPLE ||
  join(
    base,
    "IOLFW-Examples/IO-Link Community-Sample1-20190927-IOLFW1.0.iolfw",
  );
test(
  "released V1.2.1 official sample imports with verified continuous CRC",
  { skip: !existsSync(example) },
  async () => {
    const view = await inspectFirmwarePackage(
      new Uint8Array(readFileSync(example)),
    );
    assert.equal(view.validation.valid, true);
    assert.equal(view.validation.crc.stored, 1871158325);
    assert.equal(view.binary.size, 65536);
  },
);
const schema = process.env.IOLFW_SCHEMA || join(base, "Schemas/IOLFW1.0.xsd");
test(
  "generated metadata independently validates against official released IOLFW1.0 XSD",
  { skip: !existsSync(schema) },
  async () => {
    const bytes = await createFirmwarePackage(metadata, binary);
    const view = await inspectFirmwarePackage(bytes),
      dir = await mkdtemp(join(tmpdir(), "iolfw-xsd-"));
    try {
      const filename = join(dir, view.metadataFilename);
      await writeFile(filename, view.xml);
      const r = spawnSync(
        "xmllint",
        ["--nonet", "--noout", "--schema", schema, filename],
        {
          encoding: "utf8",
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => key !== "NODE_TEST_CONTEXT",
            ),
          ),
        },
      );
      assert.equal(r.status, 0, r.stderr || r.error?.message);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("IOLFW archive timestamps stay byte-identical across time zones", () => {
  const script = `import ${JSON.stringify(new URL("../../tools/iodd/node-runtime.mjs", import.meta.url).href)}; import {createFirmwarePackage} from ${JSON.stringify(new URL("../../assets/js/iodd/firmware-package.js", import.meta.url).href)}; const bytes=await createFirmwarePackage(${JSON.stringify(metadata)},new Uint8Array([0,1,2,3,255]));process.stdout.write(Buffer.from(bytes).toString('base64'));`;
  let expected;
  for (const zone of ["UTC", "America/New_York", "Pacific/Honolulu"]) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key !== "NODE_TEST_CONTEXT",
      ),
    );
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env: { ...env, TZ: zone }, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      zone + ": " + (result.stderr || result.error?.message),
    );
    assert.ok(result.stdout);
    if (expected === undefined) expected = result.stdout;
    else assert.equal(result.stdout, expected, zone);
  }
});

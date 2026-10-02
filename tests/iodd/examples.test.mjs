import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import "../../tools/iodd/node-runtime.mjs";
import { buildExample } from "../../scripts/package-iodd-examples.mjs";
import { importPackage } from "../../assets/js/iodd/package.js";
import {
  inspectProject,
  validateProject,
} from "../../assets/js/iodd/project.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
);
test("public example ZIPs are reproducible engine exports with complete import and firmware maps", async () => {
  for (const kind of ["counter", "switching-sensor"]) {
    const built = await buildExample(kind),
      again = await buildExample(kind);
    assert.deepEqual(built.bytes, again.bytes);
    const publicBytes = new Uint8Array(
      await readFile(join(root, "downloads", built.filename)),
    );
    assert.deepEqual(publicBytes, built.bytes);
    const imported = await importPackage(publicBytes),
      view = inspectProject(imported);
    assert.equal(validateProject(imported).valid, true);
    assert.ok(imported.assets.some((a) => a.name === "README.md"));
    assert.ok(imported.assets.some((a) => a.name === "LICENSE.MIT"));
    assert.ok(imported.assets.some((a) => a.name === "LICENSE.GPL-3.0"));
    assert.ok(imported.assets.some((a) => a.name === "firmware-mapping.h"));
    assert.equal(view.processData.find((p) => p.id === "PD_IN").bits, "24");
    if (kind === "switching-sensor") {
      assert.deepEqual(
        view.variables.map((v) => Number(v.index)),
        [256, 257, 258, 259],
      );
      assert.deepEqual(
        view.variables.map((v) => v.defaultValue),
        ["5000", "200", "0", ""],
      );
    } else
      assert.equal(view.processData.find((p) => p.id === "PD_OUT").bits, "8");
  }
});
test("released CLI imports the downloadable ZIP, exports stamped XML and generates the same firmware header", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iodd-examples-cli-"));
  const cli = join(root, "tools/iodd/cli.mjs"),
    run = (...args) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: tmpdir(),
        env,
        encoding: "utf8",
      });
  try {
    for (const kind of ["counter", "switching-sensor"]) {
      const built = await buildExample(kind),
        project = join(directory, kind + ".json"),
        xml = join(directory, kind + ".xml"),
        header = join(directory, kind + ".h");
      let r = run(
        "import",
        "--format",
        "package",
        "--input",
        join(root, "downloads", built.filename),
        "--output",
        project,
      );
      assert.equal(r.status, 0, r.stderr || r.error?.message);
      r = run("export", "--input", project, "--format", "xml", "--output", xml);
      assert.equal(r.status, 0, r.stderr);
      r = run("header", "--input", project, "--output", header);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(await readFile(header, "utf8"), built.header);
      assert.match(await readFile(xml, "utf8"), /<Stamp crc="\d+"/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public example archives stay byte-identical across time zones", () => {
  const generator = join(root, "scripts/package-iodd-examples.mjs");
  for (const zone of ["UTC", "Pacific/Honolulu", "America/New_York"]) {
    const result = spawnSync(process.execPath, [generator, "--check"], {
      cwd: tmpdir(),
      env: { ...env, TZ: zone },
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      zone + ": " + (result.stderr || result.error?.message),
    );
  }
});

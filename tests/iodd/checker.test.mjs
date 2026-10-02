import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExternalValidation } from "../../tools/iodd/checker.mjs";
import "../../tools/iodd/node-runtime.mjs";
import { readFile } from "node:fs/promises";
import { createProject, applyOperation } from "../../assets/js/iodd/project.js";
const project = createProject(
  await readFile(
    new URL("../../assets/iodd/counter.xml", import.meta.url),
    "utf8",
  ),
  "Example-Counter-20261002-IODD1.1.xml",
);

test("external checks are explicitly not-run without installed tools", async () => {
  const result = await runExternalValidation({ xml: "<placeholder/>" });
  assert.equal(result.schema.status, "not-run");
  assert.equal(result.officialChecker.status, "not-run");
});

test("checker invokes configured executable directly and reports nonzero exit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "iodd-checker-test-"));
  try {
    const fake = join(dir, "checker.mjs");
    await writeFile(
      fake,
      'import {writeSync} from "node:fs"; writeSync(1, "checker diagnostic"); process.exitCode = 7;',
    );
    const result = await runExternalValidation(project, {
      checkerPath: process.execPath,
      checkerArgs: [fake, "{file}"],
    });
    assert.equal(result.officialChecker.status, "failed");
    assert.equal(result.officialChecker.exitCode, 7);
    assert.match(result.officialChecker.output, /checker diagnostic/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checker requires explicit file placeholder and exposes no success on missing executable", async () => {
  await assert.rejects(
    runExternalValidation(project, {
      checkerPath: process.execPath,
      checkerArgs: ["wrong"],
    }),
    /\{file\}/,
  );
  const result = await runExternalValidation(project, {
    checkerPath: "/missing-iodd-checker",
    checkerArgs: ["{file}"],
  });
  assert.equal(result.officialChecker.status, "failed");
  assert.match(result.officialChecker.output, /ENOENT/);
});

test("checker stages original main filename and binary attachments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "iodd-checker-assets-"));
  try {
    const fake = join(dir, "checker.mjs");
    await writeFile(
      fake,
      `import {readFileSync,writeSync} from 'node:fs'; import {dirname,basename,join} from 'node:path';
      const file=process.argv[2];
      if(basename(file)!=='Example-Counter-20261002-IODD1.1.xml') process.exitCode=3;
      else if(readFileSync(join(dirname(file),'pictures/device.png')).toString('hex')!=='010203') process.exitCode=4;
      else writeSync(1,'package assets present');`,
    );
    const withAsset = applyOperation(project, {
      type: "asset",
      name: "pictures/device.png",
      base64: "AQID",
    });
    const result = await runExternalValidation(withAsset, {
      checkerPath: process.execPath,
      checkerArgs: [fake, "{file}"],
    });
    assert.equal(
      result.officialChecker.status,
      "passed",
      result.officialChecker.output,
    );
    assert.match(result.officialChecker.output, /assets present/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('operator-installed genuine Checker accepts starters and rejects missing mandatory references', {skip: !process.env.IODD_GENUINE_CHECKER}, async () => {
  const {createNewProject} = await import('../../assets/js/iodd/project.js');
  const options = {checkerPath: process.env.IODD_GENUINE_CHECKER, checkerArgs: ['{file}']};
  const sources = [
    createNewProject({}, 'iolinki-NewDevice-20261002-IODD1.1.xml'),
    ...await Promise.all(['counter', 'switching-sensor'].map(async name => createProject(await readFile(new URL('../../assets/iodd/'+name+'.xml', import.meta.url), 'utf8'), 'iolinki-'+(name==='counter'?'Counter':'SwitchingSensor')+'-20261002-IODD1.1.xml'))),
  ];
  for (const source of sources) {
    const result = await runExternalValidation(source, options);
    assert.equal(result.officialChecker.exitCode, 0, result.officialChecker.output);
    assert.equal(result.officialChecker.status, 'passed');
    assert.match(result.officialChecker.output, /0 errors found/);
  }
  const invalid = createProject(sources[2].xml.replace(/<StdVariableRef id="V_ProductName"\s*\/>/, ''), sources[2].filename);
  const rejected = await runExternalValidation(invalid, options);
  assert.equal(rejected.officialChecker.status, 'failed');
  assert.match(rejected.officialChecker.output, /V_ProductName is missing/);
});

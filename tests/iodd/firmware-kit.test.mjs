import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import '../../tools/iodd/node-runtime.mjs';
import * as api from '../../assets/js/iodd/project.js';
import { unzipSync } from '../../assets/js/iodd/vendor/fflate.js';
const module = await import('../../tools/iodd/firmware-kit.mjs').catch(() => ({}));
const xml = await readFile(new URL('../../assets/iodd/switching-sensor.xml', import.meta.url), 'utf8');
const project = () => api.createProject(xml);
const loadAsset = name => readFile(new URL('../../assets/iodd/firmware-kit/' + name, import.meta.url), 'utf8');
async function kit(p = project()) {
  assert.equal(typeof module.createFirmwareKit, 'function', 'firmware kit generator must exist');
  return module.createFirmwareKit(p, { loadAsset });
}
async function hostProof(built, mutate = f => f.content) {
  const dir = await mkdtemp(join(tmpdir(), 'iodd-firmware-proof-'));
  try {
    for (const f of built.files) {
      const path = join(dir, f.path);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, mutate(f));
    }
    const build = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-DIODD_HOST_PROOF', '-Iinclude', 'src/main.c', 'src/switching_sensor.c', '-o', 'proof'], { cwd: dir, encoding: 'utf8' });
    if (build.status !== 0) return { build };
    return { build, run: spawnSync(join(dir, 'proof'), [], { cwd: dir, encoding: 'utf8' }) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('complete reproducible source kit uses real released sensor implementation and generated mapping', async () => {
  const built = await kit(), again = await kit();
  assert.deepEqual(built.bytes, again.bytes);
  const zip = unzipSync(built.bytes);
  for (const path of ['src/main.c', 'src/switching_sensor.c', 'include/switching_sensor.h', 'include/iolinki/protocol.h', 'include/iodd-mapping.h', 'include/iodd-defaults.h', 'LICENSE.GPL-3.0', 'README.md', 'project.json', 'device.xml', 'labwired.json', 'PROVENANCE.json']) assert.ok(zip[path], path);
  assert.equal(new TextDecoder().decode(zip['include/iodd-mapping.h']), api.generateFirmwareHeader(project()));
  assert.equal(built.compile.entryPath, 'src/main.c');
  assert.equal(built.compile.language, 'c');
  assert.equal(built.compile.board, 'stm32f401cdu6-blackpill');
  assert.equal(built.verify.oracle.serial.length, 1);
  assert.match(built.scope, /application/);
  const result = await hostProof(built);
  assert.equal(result.build.status, 0, result.build.stderr);
  assert.equal(result.run.status, 0, result.run.stderr);
  assert.match(result.run.stdout, /IODD_SENSOR_PROOF_PASS/);
  for (const marker of ['DEFAULTS_PASS', 'THRESHOLD_HYSTERESIS_PASS', 'VALIDITY_PASS', 'PARAMETER_READBACK_PASS', 'BYTE_DECODE_PASS', 'TEACH_INVERSION_PASS']) assert.match(result.run.stdout, new RegExp(marker));
});
test('authored defaults are applied by real parameter service and verified', async () => {
  let p = project();
  for (const [id, defaultValue] of [['V_SP1', '6400'], ['V_Hysteresis', '300'], ['V_Inversion', '1']]) p = api.applyOperation(p, { type: 'editVariable', id, values: { defaultValue } });
  const built = await kit(p), result = await hostProof(built);
  assert.equal(result.build.status, 0, result.build.stderr);
  assert.equal(result.run.status, 0, result.run.stderr);
  assert.match(result.run.stdout, /DEFAULTS_PASS/);
});
test('rejects mismatched index, access, process layout, unknown variables and inconsistent defaults', async () => {
  for (const altered of [
    xml.replace('index="256"', 'index="260"'),
    xml.replace('accessRights="wo"', 'accessRights="rw"'),
    xml.replace('bitOffset="1"', 'bitOffset="2"'),
    xml.replace('defaultValue="200"', 'defaultValue="6000"'),
    xml.replace('defaultValue="0"', 'defaultValue="2"'),
    xml.replace('bitLength="16"', 'bitLength="8"'),
    xml.replace('<SingleValue value="1">', '<SingleValue value="2">'),
    xml.replace(/<SingleValue value="1">[\s\S]*?<\/SingleValue>/, '<ValueRange lowerValue="1" upperValue="1"/>'),
  ]) await assert.rejects(kit(api.createProject(altered)), /contract|compatible|default/i);
  await assert.rejects(kit(api.applyOperation(project(), {type:'addVariable',values:{name:'Extra',index:300}})), /contract|compatible/i);
});
test('modified generated process mapping fails C compile and modified defaults fail execution', async () => {
  const built = await kit();
  const wrongMapping = await hostProof(built, f => f.path === 'include/iodd-mapping.h' ? f.content.replace('IODD_PD_IN_FIELD_2_OFFSET 1u', 'IODD_PD_IN_FIELD_2_OFFSET 2u') : f.content);
  assert.notEqual(wrongMapping.build.status, 0);
  assert.match(wrongMapping.build.stderr, /static assertion|mapping/i);
  const wrongDefaults = await hostProof(built, f => f.path === 'include/iodd-defaults.h' ? f.content.replace('IODD_DEFAULT_THRESHOLD 5000u', 'IODD_DEFAULT_THRESHOLD 5100u') : f.content);
  assert.equal(wrongDefaults.build.status, 0, wrongDefaults.build.stderr);
  assert.notEqual(wrongDefaults.run.status, 0);
  assert.match(wrongDefaults.run.stdout, /IODD_SENSOR_PROOF_FAIL/);
  assert.doesNotMatch(wrongDefaults.run.stdout, /IODD_SENSOR_PROOF_PASS/);
});
test('pinned upstream source hash is enforced before exporting firmware', async () => {
  assert.equal(typeof module.createFirmwareKit, 'function');
  await assert.rejects(module.createFirmwareKit(project(), {loadAsset: async name => (await loadAsset(name)) + (name === 'switching_sensor.c' ? '\n/* altered */' : '')}), /hash|digest|provenance/i);
});
test('firmware ZIP hash is stable across time zones', async () => {
  const code = `import './tools/iodd/node-runtime.mjs';
import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto';
import {createProject} from './assets/js/iodd/project.js'; import {createFirmwareKit} from './tools/iodd/firmware-kit.mjs';
const built=await createFirmwareKit(createProject(await readFile('assets/iodd/switching-sensor.xml','utf8')), {loadAsset:n=>readFile('assets/iodd/firmware-kit/'+n,'utf8')});
console.log(createHash('sha256').update(built.bytes).digest('hex'));`;
  const cwd = new URL('../../', import.meta.url);
  const hashes = ['UTC', 'Pacific/Honolulu'].map(TZ => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {cwd, env:{...process.env,TZ}, encoding:'utf8'});
    assert.equal(result.status,0,result.stderr); return result.stdout;
  });
  assert.equal(hashes[0],hashes[1]);
});

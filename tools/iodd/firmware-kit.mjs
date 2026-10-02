import { inspectProject, validateProject, generateFirmwareHeader, exportProjectXML, saveProject } from '../../assets/js/iodd/project.js';
import { zipSync } from '../../assets/js/iodd/vendor/fflate.js';

export const FIRMWARE_KIT_ASSETS = Object.freeze(['switching_sensor.c', 'switching_sensor.h', 'protocol.h', 'LICENSE.GPL-3.0', 'proof-main.c']);
const PIN = 'ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca';
const upstream = {
  'switching_sensor.c': {path:'examples/switching_sensor/switching_sensor.c', sha256:'8290ff7bdde065b07a67e0d8f9caeaab19392367c04cd9e06bf6229175b5ad3f'},
  'switching_sensor.h': {path:'examples/switching_sensor/switching_sensor.h', sha256:'07c8f73ecd88f005da3beeb39df83eee4bb29300816f3c900297f6e01d41796c'},
  'protocol.h': {path:'include/iolinki/protocol.h', sha256:'c0a7f37bc3e20b033f96955de786dd50134f553904152fa8519cdf9dddac518e'},
  'LICENSE.GPL-3.0': {path:'LICENSE', sha256:'d3a010f30f7e4f4f374679b2eab948f3fc642c16f6a3e1739b7e0c1384292413'},
};
const encoder = new TextEncoder();
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const json = value => JSON.stringify(value, null, 2) + '\n';
function reject(detail) { throw Error('Incompatible switching-sensor firmware contract: ' + detail); }
export function checkFirmwareContract(project) {
  if (!validateProject(project).valid) reject('IODD must pass basic validation');
  const view = inspectProject(project);
  if (view.profiles.length) reject('profile extensions are not implemented');
  const expected = [
    ['V_SP1',256,'rw','16','0','65535'], ['V_Hysteresis',257,'rw','16','0','65535'],
    ['V_Inversion',258,'rw','8','0','1'], ['V_Teach',259,'wo','8','1','1'],
  ];
  if (view.variables.length !== expected.length) reject('exactly four released application parameters required');
  for (const [id,index,access,bits,lower,upper] of expected) {
    const v = view.variables.find(n=>n.id===id);
    if (!v || Number(v.index)!==index || v.access!==access || v.type!=='UIntegerT' || v.bits!==bits || v.lower!==lower || v.upper!==upper) reject('parameter '+id+' index/access/type/range');
  }
  const pd=view.processData[0];
  if (view.processData.length!==1 || pd.id!=='PD_IN' || pd.direction!=='in' || pd.bits!=='24' || pd.fields.length!==3) reject('24-bit input only');
  for (const [subindex,offset,bits,type] of [['1','8','16','UIntegerT'], ['2','1','1','BooleanT'], ['3','0','1','BooleanT']]) {
    const f=pd.fields.find(n=>n.subindex===subindex);
    if (!f || f.offset!==offset || f.bits!==bits || f.type!==type) reject('process field '+subindex);
  }
  const readDefault=id=>{
    const text=view.variables.find(n=>n.id===id).defaultValue;
    if (!/^\d+$/.test(text)) reject('integer default required for '+id);
    return Number(text);
  };
  const threshold=readDefault('V_SP1'), hysteresis=readDefault('V_Hysteresis'), inversion=readDefault('V_Inversion');
  if (threshold>65535 || hysteresis>threshold || inversion>1 || view.variables.find(n=>n.id==='V_Teach').defaultValue!=='') reject('invalid or inconsistent defaults');
  return {threshold,hysteresis,inversion};
}
export async function createFirmwareKit(project, {loadAsset} = {}) {
  const defaults=checkFirmwareContract(project);
  if (typeof loadAsset!=='function') throw Error('Firmware kit fixed-asset loader is required');
  const assets=Object.fromEntries(await Promise.all(FIRMWARE_KIT_ASSETS.map(async name=>[name,await loadAsset(name)])));
  for (const [name, metadata] of Object.entries(upstream)) {
    if (await digest(assets[name])!==metadata.sha256) throw Error('Firmware provenance SHA-256 mismatch: '+name);
  }
  const main=assets['proof-main.c'].replaceAll('@THRESHOLD@',String(defaults.threshold)).replaceAll('@HYSTERESIS@',String(defaults.hysteresis)).replaceAll('@INVERSION@',String(defaults.inversion));
  const sourceFiles=[
    {path:'src/main.c',content:main}, {path:'src/switching_sensor.c',content:assets['switching_sensor.c']},
    {path:'include/switching_sensor.h',content:assets['switching_sensor.h']}, {path:'include/iolinki/protocol.h',content:assets['protocol.h']},
    {path:'include/iodd-mapping.h',content:generateFirmwareHeader(project)},
    {path:'include/iodd-defaults.h',content:`/* Authored project defaults, applied through the real service. */\n#ifndef IODD_DEFAULTS_H\n#define IODD_DEFAULTS_H\n#define IODD_DEFAULT_THRESHOLD ${defaults.threshold}u\n#define IODD_DEFAULT_HYSTERESIS ${defaults.hysteresis}u\n#define IODD_DEFAULT_INVERSION ${defaults.inversion}u\n#endif\n`},
  ];
  const board='stm32f401cdu6-blackpill';
  const compile={board,language:'c',entryPath:'src/main.c',source:main,files:sourceFiles.slice(1)};
  const verify={target:board,diagram:{board,parts:[{id:'mcu',type:board}],wires:[]},oracle:{serial:[{contains:'IODD_SENSOR_PROOF_PASS'}]},max_steps:5000000,output:'serial'};
  const scope='Switching-sensor application MCU execution: authored defaults, threshold/hysteresis, validity, parameter service/readback, byte decoding, inversion and teach. Excludes IO-Link stack/PHY/cable, physical hardware, retained flash, IAR and official conformity.';
  const provenance={repository:'https://github.com/w1ne/iolinki',release:'v2.1.0',commit:PIN,license:'GPL-3.0-or-later',upstream,scope};
  const files=[...sourceFiles,
    {path:'LICENSE.GPL-3.0',content:assets['LICENSE.GPL-3.0']}, {path:'PROVENANCE.json',content:json(provenance)},
    {path:'project.json',content:saveProject(project)}, {path:'device.xml',content:exportProjectXML(project)},
    {path:'labwired.json',content:json({compile,verify,scope})},
    {path:'README.md',content:`# Authored switching-sensor firmware proof kit\n\n${scope}\n\nActual released sensor C source is unchanged; the generated mapping header binds its parameter indexes/process byte layout. Authored defaults are applied by the real parameter service. The MCU witness checks defaults independently, then applies known vectors for threshold, hysteresis, invalid samples, parameter readback, byte decoding, teach and inversion. Parameters are volatile.\n\nUse the LabWired plugin https://labwired.com: call labwired_compile with labwired.json compile arguments, then labwired_verify with its verify arguments plus firmware_ref from compile. Alternatively store source/files with labwired_put_source first. No shell-execution MCP tool is required. A compile alone is not execution proof; record verify verdict, observed console and any model gaps.\n\nHost cross-check (not MCU proof):\n\n\`\`\`sh\ncc -std=c11 -Wall -Wextra -Werror -DIODD_HOST_PROOF -Iinclude src/main.c src/switching_sensor.c -o proof\n./proof\n\`\`\`\n\nGPL-3.0-or-later applies to the firmware implementation and witness; complete corresponding source and license are included. See PROVENANCE.json for upstream source commit and hashes. The IODD JSON/XML are recoverable authored inputs, not official Checker certification.\n`},
  ];
  const hashes=await Promise.all(files.map(async f=>`${await digest(f.content)}  ${f.path}`));
  files.push({path:'SHA256SUMS',content:hashes.join('\n')+'\n'});
  // ZIP records local date fields; construct the same fields in every time zone.
  const stamp=new Date(2026,9,2,0,0,0);
  const bytes=zipSync(Object.fromEntries(files.map(f=>[f.path,[encoder.encode(f.content),{mtime:stamp}]])),{level:9});
  return {filename:'iodd-switching-sensor-firmware-kit.zip',bytes,files,compile,verify,scope,provenance};
}

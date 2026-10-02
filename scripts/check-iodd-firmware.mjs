import "../tools/iodd/node-runtime.mjs";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  generateFirmwareHeader,
  inspectProject,
} from "../assets/js/iodd/project.js";
import { importPackage } from "../assets/js/iodd/package.js";

// The external source tree is a pinned checkout in CI, never a mock application.
const source = resolve(process.argv[2] || ".validation/iolinki");
const directory = await mkdtemp(join(tmpdir(), "iodd-firmware-"));
try {
  const project = await importPackage(
    new Uint8Array(
      await readFile(
        new URL("../downloads/iodd-switching-sensor.zip", import.meta.url),
      ),
    ),
  );
  const view = inspectProject(project);
  const fields = view.processData.find((pd) => pd.id === "PD_IN").fields;
  const variables = view.variables;
  await writeFile(
    join(directory, "mapping.h"),
    generateFirmwareHeader(project),
  );
  const read = (position) =>
    `iodd_read_bits(sensor.pd, IODD_PD_IN_BYTES, IODD_PD_IN_FIELD_${fields[position].subindex}_OFFSET, IODD_PD_IN_FIELD_${fields[position].subindex}_BITS)`;
  const checks = variables
    .filter((v) => v.access !== "wo")
    .map(
      (v) => `
    length = sizeof(data);
    if (switching_sensor_service(&sensor, IODD_${v.id.toUpperCase()}_INDEX, 0, false, NULL, 0, data, &length) != 0) return 10;
    if (length != ${Number(v.bits) / 8} || iodd_read_bits(data, length, 0, ${v.bits}) != ${v.defaultValue}) return 11;`,
    )
    .join("\n");
  await writeFile(
    join(directory, "proof.c"),
    `#include "mapping.h"
#include "switching_sensor.h"
int main(void) {
  switching_sensor_t sensor;
  switching_sensor_init(&sensor);
  uint8_t data[8]; size_t length;
  ${checks}
  const uint16_t samples[] = {5100, 4900, 4800, 12345};
  for (unsigned i=0; i<4; ++i) {
    bool valid = i != 3;
    bool output = switching_sensor_sample(&sensor, samples[i], valid);
    if (${read(0)} != samples[i] || ${read(1)} != (unsigned)valid || ${read(2)} != (unsigned)output) return 20;
  }
  return 0;
}
`,
  );
  const compiled = spawnSync(
    "cc",
    [
      "-std=c99",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-I" + join(source, "include"),
      "-I" + join(source, "examples/switching_sensor"),
      join(directory, "proof.c"),
      join(source, "examples/switching_sensor/switching_sensor.c"),
      "-o",
      join(directory, "proof"),
    ],
    { encoding: "utf8" },
  );
  if (compiled.status !== 0)
    throw Error(compiled.stderr || "Firmware proof compilation failed.");
  const executed = spawnSync(join(directory, "proof"), [], {
    encoding: "utf8",
  });
  if (executed.status !== 0)
    throw Error(`Firmware/IODD mapping mismatch (exit ${executed.status}).`);
  console.log(
    "Actual switching-sensor C: generated indexes, parameter defaults and process-byte decoding agree.",
  );
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0)
      throw Error(result.stderr || result.stdout || `${command} failed`);
    return result.stdout;
  };
  const build = join(directory, "stack-build");
  run("cmake", ["-S", source, "-B", build, "-DBUILD_TESTING=OFF"]);
  run("cmake", [
    "--build",
    build,
    "--target",
    "reference_device_demo",
    "switching_sensor_demo",
    "-j2",
  ]);
  for (const example of ["reference_device", "switching_sensor"]) {
    const output = run(join(build, "examples", example, example + "_demo"), []);
    console.log(output.split("\n")[0]);
  }
  const counter = await importPackage(
    new Uint8Array(
      await readFile(new URL("../downloads/iodd-counter.zip", import.meta.url)),
    ),
  );
  const counterView = inspectProject(counter);
  const input = counterView.processData.find((pd) => pd.id === "PD_IN");
  await writeFile(
    join(directory, "counter-mapping.h"),
    generateFirmwareHeader(counter),
  );
  await writeFile(
    join(directory, "counter-proof.c"),
    `#include "counter-mapping.h"
#include "reference_device.h"
static int send_bytes(void *u,const uint8_t *d,size_t n){(void)u;(void)d;return (int)n;}
static int receive(void *u,uint8_t *b){(void)u;(void)b;return 0;}
int main(void){
 reference_device_t app;const iolink_phy_api_t phy={.send=send_bytes,.recv_byte=receive};
 if(reference_device_init(&app,&phy))return 1;
 if(app.config.device_info->vendor_id!=${Number(counterView.identity.vendorId)} || app.config.device_info->device_id!=${Number(counterView.identity.deviceId)})return 2;
 if(app.config.stack.pd_in_len!=IODD_PD_IN_BYTES || app.config.stack.pd_out_len!=IODD_PD_OUT_BYTES)return 3;
 for(unsigned i=1;i<=300;++i){if(reference_device_tick(&app,(i&1)!=0))return 4;
 if(iodd_read_bits(app.input,IODD_PD_IN_BYTES,IODD_PD_IN_FIELD_${input.fields[0].subindex}_OFFSET,IODD_PD_IN_FIELD_${input.fields[0].subindex}_BITS)!=i)return 5;
 if(iodd_read_bits(app.input,IODD_PD_IN_BYTES,IODD_PD_IN_FIELD_${input.fields[1].subindex}_OFFSET,IODD_PD_IN_FIELD_${input.fields[1].subindex}_BITS)!=(i&1))return 6;}
 return 0;
}
`,
  );
  run("cc", [
    "-std=c99",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-I" + join(source, "include"),
    "-I" + join(source, "examples/reference_device"),
    join(directory, "counter-proof.c"),
    join(source, "examples/reference_device/reference_device.c"),
    join(build, "libiolinki.a"),
    "-o",
    join(directory, "counter-proof"),
  ]);
  run(join(directory, "counter-proof"), []);
  console.log(
    "Importable counter ZIP: identity, input/output sizes and 300 firmware samples agree with the released stack.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

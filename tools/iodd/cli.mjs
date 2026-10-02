#!/usr/bin/env node
import "./node-runtime.mjs";
import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { runExternalValidation } from "./checker.mjs";
import { profileView } from "../../assets/js/iodd/extensions.js";
import {
  createFirmwarePackage,
  inspectFirmwarePackage,
} from "../../assets/js/iodd/firmware-package.js";
import * as api from "../../assets/js/iodd/project.js";
import { importPackage, exportPackage } from "../../assets/js/iodd/package.js";
const usage =
  "Commands: create --template new|counter|switching-sensor [--identity identity.json] --output project.json; import --format xml|project|package --input file --output project.json; inspect|validate --input project.json; edit --input project.json --operation edit.json --output project.json; export --input project.json --format xml|project|package --output file; header --input project.json --output map.h; diff --before old.json --after new.json; tree --input project.json; elements|profile-inspect --input definitions.xml; elements-export --input project.json --selectors selectors.json --output elements.xml; fw-create --metadata firmware.json --binary firmware.bin [--resources resources.json] --output Vendor-Descriptor-YYYYMMDD-IOLFW1.0.iolfw; fw-inspect --input package.iolfw";
const rules = {
  create: ["template", "identity", "output"],
  import: ["format", "input", "output"],
  inspect: ["input"],
  validate: ["input", "schema", "checker", "checker-args", "checks"],
  edit: ["input", "operation", "output"],
  export: ["input", "format", "output"],
  header: ["input", "output"],
  diff: ["before", "after"],
  tree: ["input"],
  elements: ["input"],
  "elements-export": ["input", "selectors", "output"],
  "profile-inspect": ["input"],
  "fw-create": ["metadata", "binary", "resources", "output"],
  "fw-inspect": ["input"],
};
async function readBounded(filename, limit) {
  const file = await open(filename, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit)
      throw Error(`Input must be a regular file of at most ${limit} bytes.`);
    const data = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let used = 0;
    while (used < data.length) {
      const { bytesRead } = await file.read(
        data,
        used,
        data.length - used,
        null,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > info.size || used > limit)
      throw Error("Input changed or exceeded its size limit while reading.");
    return data.subarray(0, used);
  } finally {
    await file.close();
  }
}
function decodeUTF8(data) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw Error("Input is not valid UTF-8. Convert it to UTF-8 and retry.");
  }
}
async function atomicWrite(filename, data) {
  const target = path.resolve(filename);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.iodd-write-${randomUUID()}`,
  );
  let file;
  try {
    file = await open(temporary, "wx", 0o600);
    await file.writeFile(data);
    await file.sync();
    await file.close();
    file = null;
    await rename(temporary, target);
  } finally {
    if (file) await file.close().catch(() => {});
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "help") return { usage };
  if (!rules[command]) throw Error(usage);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (
      !args[i]?.startsWith("--") ||
      !rules[command].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      key in opts
    )
      throw Error(`Invalid or duplicate argument ${args[i]}. ${usage}`);
    opts[key] = args[i + 1];
  }
  for (const key of rules[command])
    if (
      !opts[key] &&
      !(command === "create" && ["template", "identity"].includes(key)) &&
      !(command === "validate" && key !== "input") &&
      !(command === "fw-create" && key === "resources")
    )
      throw Error(`Missing --${key}. ${usage}`);
  if (command === "elements" || command === "profile-inspect") {
    const xml = decodeUTF8(await readBounded(opts.input, 4 * 1024 * 1024));
    return command === "elements"
      ? api.inspectElements(xml)
      : profileView({ id: "ProvidedProfile", xml });
  }
  if (command === "fw-inspect")
    return inspectFirmwarePackage(
      new Uint8Array(await readBounded(opts.input, 16 * 1024 * 1024)),
      path.basename(opts.input),
    );
  if (command === "fw-create") {
    const metadata = JSON.parse(
        decodeUTF8(await readBounded(opts.metadata, 1024 * 1024)),
      ),
      binary = new Uint8Array(await readBounded(opts.binary, 16 * 1024 * 1024));
    const manifest = opts.resources
      ? JSON.parse(decodeUTF8(await readBounded(opts.resources, 1024 * 1024)))
      : [];
    if (!Array.isArray(manifest) || manifest.length > 126)
      throw Error(
        "Resources manifest must be an array of at most126 {id,name,path} entries.",
      );
    const resources = [];
    let total = binary.length;
    for (const r of manifest) {
      const data = new Uint8Array(await readBounded(r.path, 16 * 1024 * 1024));
      total += data.length;
      if (total > 16 * 1024 * 1024)
        throw Error("Firmware binary and resources exceed16 MiB.");
      resources.push({ id: r.id, name: r.name, bytes: data });
    }
    const bytes = await createFirmwarePackage(metadata, binary, resources),
      view = await inspectFirmwarePackage(bytes);
    if (path.basename(opts.output) !== view.filename)
      throw Error("IOLFW output filename must be " + view.filename);
    await atomicWrite(opts.output, bytes);
    return {
      ok: true,
      output: opts.output,
      filename: view.filename,
      metadata: view.metadata,
      validation: view.validation,
    };
  }
  const load = async (filename) =>
    api.loadProject(decodeUTF8(await readBounded(filename, 24 * 1024 * 1024)));
  let project;
  if (command === "create") {
    const template = opts.template || "new";
    if (!["new", "counter", "switching-sensor"].includes(template))
      throw Error("Choose new, counter or switching-sensor template.");
    const identity = opts.identity
      ? JSON.parse(decodeUTF8(await readBounded(opts.identity, 1024 * 1024)))
      : {};
    if (template === "new")
      project = api.createNewProject(identity, "new-device.xml");
    else {
      project = api.createProject(
        decodeUTF8(
          await readBounded(
            new URL(`../../assets/iodd/${template}.xml`, import.meta.url),
            4 * 1024 * 1024,
          ),
        ),
        `${template}.xml`,
      );
      if (Object.keys(identity).length)
        project = api.applyOperation(project, {
          type: "identity",
          values: identity,
        });
    }
  } else if (command === "import") {
    if (!["xml", "project", "package"].includes(opts.format))
      throw Error("Choose xml, project or package format.");
    const data = await readBounded(
      opts.input,
      (opts.format === "xml" ? 4 : opts.format === "project" ? 24 : 16) *
        1024 *
        1024,
    );
    project =
      opts.format === "xml"
        ? api.createProject(decodeUTF8(data), opts.input.split(/[\\/]/).pop())
        : opts.format === "project"
          ? api.loadProject(decodeUTF8(data))
          : await importPackage(new Uint8Array(data));
  } else if (command === "diff")
    return api.diffProjects(await load(opts.before), await load(opts.after));
  else project = await load(opts.input);
  if (command === "tree") return api.inspectDocumentTree(project);
  if (command === "elements-export") {
    const selectors = JSON.parse(
      decodeUTF8(await readBounded(opts.selectors, 1024 * 1024)),
    );
    await atomicWrite(opts.output, api.exportElements(project, selectors));
    return { ok: true, output: opts.output, format: "elements" };
  }
  if (command === "inspect") return api.inspectProject(project);
  if (command === "validate") {
    const checks = opts.checks ? JSON.parse(opts.checks) : undefined;
    if (
      opts.checks &&
      (!checks ||
        typeof checks !== "object" ||
        Array.isArray(checks) ||
        Object.entries(checks).some(
          ([key, value]) =>
            ![
              "structure",
              "references",
              "ranges",
              "processData",
              "crc",
              "assets",
              "rules",
            ].includes(key) || typeof value !== "boolean",
        ))
    )
      throw Error(
        "Validation checks must be a JSON object of supported boolean switches.",
      );
    const result = api.validateProject(project, { checks });
    const safe = checks ? api.validateProject(project).valid : result.valid;
    if (result.errors?.length || result.valid === false || result.ok === false)
      process.exitCode = 2;
    const external = safe
      ? await runExternalValidation(project, {
          schemaPath: opts.schema,
          checkerPath: opts.checker,
          checkerArgs: opts["checker-args"]
            ? JSON.parse(opts["checker-args"])
            : [],
        })
      : {
          schema: {
            status: "not-run",
            output: "Resolve basic errors before external validation.",
          },
          officialChecker: {
            status: "not-run",
            output: "Resolve basic errors before external validation.",
          },
        };
    if (
      external.schema.status === "failed" ||
      external.officialChecker.status === "failed"
    )
      process.exitCode = 2;
    return { ...result, ...external };
  }
  if (command === "edit")
    project = api.applyOperation(
      project,
      JSON.parse(decodeUTF8(await readBounded(opts.operation, 1024 * 1024))),
    );
  let output = api.saveProject(project);
  if (command === "header") output = api.generateFirmwareHeader(project);
  if (command === "export") {
    if (!["xml", "project", "package"].includes(opts.format))
      throw Error("Choose xml, project or package format.");
    output =
      opts.format === "xml"
        ? api.exportProjectXML(project)
        : opts.format === "package"
          ? await exportPackage(project)
          : output;
  }
  await atomicWrite(opts.output, output);
  return {
    ok: true,
    output: opts.output,
    format: opts.format || (command === "header" ? "header" : "project"),
  };
}
try {
  const result = await main();
  await new Promise((resolve, reject) =>
    process.stdout.write(`${JSON.stringify(result)}\n`, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: { code: "IODD_COMMAND_FAILED", message: error.message, action: "Correct the input and retry." } })}\n`,
  );
  process.exitCode = 1;
}

#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
export const output = join(root, "downloads/iodd-mcp-1.1.1.tgz");
const source = join(root, "tools/iodd/package");
const runtimeFiles = [
  "tools/iodd/mcp.mjs", "tools/iodd/mcp-factory.mjs", "tools/iodd/cli.mjs", "tools/iodd/node-runtime.mjs", "tools/iodd/checker.mjs", "tools/iodd/project-vault.mjs", "tools/iodd/firmware-kit.mjs", "tools/iodd/LICENSE",
  ...["project.js", "document.js", "package.js", "extensions.js", "validation-pattern.js", "firmware-package.js"].map(name => "assets/js/iodd/" + name),
];
async function filesIn(relative) {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const path = relative + "/" + entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
    else throw Error("Package sources must be regular files: " + path);
  }
  return files;
}
export async function buildNpmPackage({ dryRun = false } = {}) {
  const stage = await mkdtemp(join(tmpdir(), "iodd-npm-"));
  try {
    const files = [...runtimeFiles, ...await filesIn("assets/js/iodd/vendor"), ...await filesIn("assets/iodd")];
    for (const relative of files) {
      const target = join(stage, relative);
      await mkdir(dirname(target), {recursive: true});
      await copyFile(join(root, relative), target);
    }
    await mkdir(join(stage, "bin"));
    await copyFile(join(source, "iodd-mcp.mjs"), join(stage, "bin/iodd-mcp.mjs"));
    await chmod(join(stage, "bin/iodd-mcp.mjs"), 0o755);
    for (const name of ["package.json", "README.md"]) await copyFile(join(source, name), join(stage, name));
    await copyFile(join(root, "tools/iodd/LICENSE"), join(stage, "LICENSE"));
    const npmCli = join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
    const args = [npmCli, "pack", "--ignore-scripts", "--json", ...(dryRun ? ["--dry-run"] : [])];
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"));
    const {stdout} = await exec(process.execPath, args, {cwd: stage, env, maxBuffer: 2 * 1024 * 1024});
    const [manifest] = JSON.parse(stdout);
    return {manifest, bytes: dryRun ? null : await readFile(join(stage, manifest.filename))};
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => !["--check", "--dry-run"].includes(flag))) throw Error("Use --check or --dry-run.");
  const result = await buildNpmPackage({dryRun: flags.includes("--dry-run")});
  if (flags.includes("--dry-run")) console.log(JSON.stringify(result.manifest, null, 2));
  else if (flags.includes("--check")) {
    if (!(await readFile(output)).equals(result.bytes)) throw Error("IODD MCP tarball differs from current package sources.");
    console.log("IODD MCP npm tarball is current and reproducible");
  } else {
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, result.bytes);
    console.log(`Wrote downloads/iodd-mcp-1.1.1.tgz (${result.bytes.length} bytes)`);
  }
}

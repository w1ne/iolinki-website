import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 64 * 1024;
function invoke(executable, args) {
  return new Promise((resolve) => {
    let output = "",
      settled = false;
    const finish = (exitCode, status, detail = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        exitCode,
        output: (output + detail).slice(0, OUTPUT_LIMIT),
      });
    };
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(executable, args, {
      shell: false,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null, "failed", "\nCheck timed out after 30 seconds.");
    }, 30000);
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(0, OUTPUT_LIMIT);
      });
    child.once("error", (error) => finish(null, "failed", error.message));
    child.once("close", (code) =>
      finish(code, code === 0 ? "passed" : "failed"),
    );
  });
}

/** Runs only operator-configured tools. No request-supplied commands or shell. */
export async function runExternalValidation(project, options = {}) {
  const { schemaPath, checkerPath, checkerArgs = [] } = options;
  const report = {
    schema: { status: "not-run", output: "No official XSD configured." },
    officialChecker: {
      status: "not-run",
      output: "No official checker configured.",
    },
  };
  if (!schemaPath && !checkerPath) return report;
  if (
    checkerPath &&
    (!Array.isArray(checkerArgs) ||
      !checkerArgs.every((value) => typeof value === "string") ||
      !checkerArgs.includes("{file}"))
  )
    throw Error(
      "Checker arguments must be an array containing an explicit {file} argument.",
    );
  const { decodeBase64 } = await import("../../assets/js/iodd/project.js");
  const { exportPackage, importPackage } =
    await import("../../assets/js/iodd/package.js");
  // Export refreshes main/external-language CRCs and checks referenced assets.
  const staged = await importPackage(await exportPackage(project));
  const directory = await mkdtemp(join(tmpdir(), "iolinki-iodd-check-"));
  try {
    // All names have passed the package's relative-path and duplicate guards.
    const safeFile = join(directory, staged.filename);
    await mkdir(dirname(safeFile), { recursive: true });
    await writeFile(safeFile, staged.xml, "utf8");
    for (const asset of staged.assets) {
      const path = join(directory, asset.name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, decodeBase64(asset.base64));
    }
    if (schemaPath)
      report.schema = await invoke("xmllint", [
        "--nonet",
        "--noout",
        "--schema",
        schemaPath,
        safeFile,
      ]);
    if (checkerPath)
      report.officialChecker = await invoke(
        checkerPath,
        checkerArgs.map((arg) => (arg === "{file}" ? safeFile : arg)),
      );
    return report;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

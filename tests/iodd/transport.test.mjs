import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  open,
  readdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
);
const parse = (result) => JSON.parse(result.content[0].text);
test("real stdio MCP initializes, exposes typed tools, edits atomically and isolates projects", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "tools/iodd/mcp.mjs")],
    cwd: tmpdir(),
    env: childEnv,
    stderr: "pipe",
  });
  let serverError = "";
  const originalStart = transport.start.bind(transport);
  transport.start = async () => {
    await originalStart();
    transport._process?.on("exit", (code, signal) => {
      serverError += ` [server exit=${code} signal=${signal}]`;
    });
  };
  transport.stderr.on("data", (chunk) => {
    serverError += chunk.toString();
  });
  const client = new Client({ name: "iodd-test", version: "1.0.0" });
  try {
    await client.connect(transport).catch((error) => {
      throw new Error(`${error.message}: ${serverError}`);
    });
    const list = await client.listTools();
    for (const name of [
      "create",
      "import",
      "inspect",
      "edit",
      "validate",
      "export",
      "diff",
      "header",
      "close",
      "tree",
      "elements_inspect",
      "elements_export",
      "profile_inspect",
      "firmware_create",
      "firmware_inspect",
    ])
      assert.ok(list.tools.find((t) => t.name === `iodd_${name}`));
    const editSchema = list.tools.find(
      (t) => t.name === "iodd_edit",
    ).inputSchema;
    assert.ok(JSON.stringify(editSchema).includes("vendorId"));
    assert.ok(JSON.stringify(editSchema).includes("bit offset"));
    const call = (name, args) =>
      client.callTool({ name: `iodd_${name}`, arguments: args });
    const blank = parse(
      await call("create", {
        template: "new",
        identity: {
          vendorName: "New MCP manufacturer",
          releaseDate: "2026-10-02",
        },
      }),
    );
    assert.equal(blank.identity.vendorName, "New MCP manufacturer");
    assert.equal(blank.variables.length, 0);
    assert.equal(blank.processData.length, 0);
    await call("close", { projectId: blank.projectId });
    const a = parse(await call("create", { template: "counter" })).projectId;
    const b = parse(
      await call("create", { template: "switching-sensor" }),
    ).projectId;
    assert.notEqual(a, b);
    const before = parse(await call("inspect", { projectId: a }));
    const bad = await call("edit", {
      projectId: a,
      operation: { type: "identity", values: { vendorId: -1 } },
    });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /vendorId/);
    assert.deepEqual(parse(await call("inspect", { projectId: a })), before);
    await call("edit", {
      projectId: a,
      operation: {
        type: "identity",
        values: { vendorName: "MCP transport test" },
      },
    });
    assert.equal(
      parse(await call("inspect", { projectId: a })).identity.vendorName,
      "MCP transport test",
    );
    assert.notEqual(
      parse(await call("inspect", { projectId: b })).identity.vendorName,
      "MCP transport test",
    );
    const menuResult = await call("edit", {
      projectId: a,
      operation: {
        type: "menu",
        values: {
          id: "M_Transport",
          name: "Transport",
          variableIds: ["V_DirectParameters_1"],
          menuIds: [],
        },
      },
    });
    assert.equal(menuResult.isError, undefined, menuResult.content[0].text);
    const added = await call("edit", {
      projectId: a,
      operation: {
        type: "addVariable",
        values: {
          id: "V_Transport",
          name: "Threshold",
          index: 300,
          access: "rw",
          type: "UIntegerT",
          bits: 16,
          defaultValue: "5",
        },
      },
    });
    assert.equal(added.isError, undefined, added.content[0].text);
    const partial = await call("edit", {
      projectId: a,
      operation: {
        type: "editVariable",
        id: "V_Transport",
        values: { upper: "100" },
      },
    });
    assert.equal(partial.isError, undefined, partial.content[0].text);
    const field = await call("edit", {
      projectId: a,
      operation: {
        type: "addProcessField",
        id: "PD_OUT",
        values: { name: "Alarm", type: "BooleanT", bits: 1, offset: 1 },
      },
    });
    assert.equal(field.isError, undefined, field.content[0].text);
    const wrongType = await call("edit", {
      projectId: a,
      operation: { type: "identity", values: { vendorName: 123 } },
    });
    assert.equal(wrongType.isError, true);
    const unknown = await call("edit", {
      projectId: a,
      operation: { type: "identity", values: { typo: "ignored" } },
    });
    assert.equal(unknown.isError, true);
    const tree = parse(await call("tree", { projectId: a }));
    assert.equal(tree.name, "IODevice");
    const treeEdit = await call("edit", {
      projectId: a,
      operation: {
        type: "tree",
        action: "attributes",
        selector: "PD_IN",
        values: { bitLength: "32" },
      },
    });
    assert.equal(treeEdit.isError, undefined, treeEdit.content[0].text);
    function findPath(node, id, indexes = []) {
      if (node.attrs?.id === id) return indexes;
      for (let i = 0; i < (node.children?.length ?? 0); i++) {
        const found = findPath(node.children[i], id, [...indexes, i]);
        if (found) return found;
      }
    }
    const matchingDatatype = await call("edit", {
      projectId: a,
      operation: {
        type: "tree",
        action: "attributes",
        selector: [...findPath(tree, "PD_IN"), 0],
        values: { bitLength: "32" },
      },
    });
    assert.equal(
      matchingDatatype.isError,
      undefined,
      matchingDatatype.content[0].text,
    );
    const wireless = await call("edit", {
      projectId: a,
      operation: {
        type: "communication",
        mode: "wireless",
        values: {
          WMinCycleTimeIn: 5000,
          WMinCycleTimeOut: 5000,
          maxTxPower: 0,
          defaultSlotType: "SSLOT",
        },
      },
    });
    assert.equal(wireless.isError, undefined, wireless.content[0].text);
    assert.equal(
      parse(await call("inspect", { projectId: a })).communication.mode,
      "wireless",
    );
    const rulesSet = await call("edit", {
      projectId: a,
      operation: {
        type: "validationRules",
        rules: [
          {
            id: "width",
            selector: "PD_IN",
            kind: "range",
            attribute: "bitLength",
            min: 33,
            max: 64,
            severity: "error",
          },
        ],
      },
    });
    assert.equal(rulesSet.isError, undefined, rulesSet.content[0].text);
    assert.equal(parse(await call("validate", { projectId: a })).valid, false);
    assert.equal(
      parse(await call("validate", { projectId: a, checks: { rules: false } }))
        .valid,
      true,
    );
    assert.equal(
      (await call("export", { projectId: a, format: "xml" })).isError,
      true,
    );
    await call("edit", {
      projectId: a,
      operation: { type: "validationRules", rules: [] },
    });

    const elements = parse(
      await call("elements_export", {
        projectId: a,
        selectors: ["V_Transport"],
      }),
    );
    assert.equal(
      parse(await call("elements_inspect", { xml: elements.content })).name,
      "IODDElements",
    );
    const reusable = await call("edit", {
      projectId: b,
      operation: {
        type: "importElements",
        xml: elements.content,
        selectors: ["V_Transport"],
        collision: "rename",
      },
    });
    assert.equal(reusable.isError, undefined, reusable.content[0].text);
    const profileXML =
      '<IODDProfileDefinitions xmlns="http://www.io-link.com/IODD-Snippets/2025/10"><SupportedProfiles profileClassName="Test profiles"><ProfileVariant id="PR_Test" profileId="16384" name="Test profile"/></SupportedProfiles><VariableCollection><Variable id="V_Profile" index="301" accessRights="rw"><Datatype xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="UIntegerT" bitLength="16"/><Name textId="T_Profile"/></Variable></VariableCollection><ExternalTextCollection><PrimaryLanguage xml:lang="en"><Text id="T_Profile" value="Profile parameter"/></PrimaryLanguage></ExternalTextCollection></IODDProfileDefinitions>';
    assert.equal(
      parse(await call("profile_inspect", { xml: profileXML })).variants[0]
        .profileId,
      "16384",
    );
    const loaded = await call("edit", {
      projectId: a,
      operation: { type: "profile", action: "load", xml: profileXML },
    });
    assert.equal(loaded.isError, undefined, loaded.content[0].text);
    const applied = await call("edit", {
      projectId: a,
      operation: {
        type: "profile",
        action: "apply",
        id: "Profile_1",
        profileId: "16384",
        replacements: {},
      },
    });
    assert.equal(applied.isError, undefined, applied.content[0].text);
    const firmware = parse(
      await call("firmware_create", {
        metadata: {
          vendorId: 1234,
          vendorName: "Example",
          firmwareDescriptor: "Counter",
          releaseDate: "2026-10-02",
          version: "V1.0",
          copyright: "Example",
          fwRevision: "V1.0",
          hardwareIds: [{ idPattern: "COUNTER-A" }],
          binaryName: "firmware.bin",
        },
        binary: "AAECA/8=",
      }),
    );
    assert.equal(firmware.filename, "Example-Counter-20261002-IOLFW1.0.iolfw");
    const firmwareView = parse(
      await call("firmware_inspect", {
        content: firmware.content,
        filename: firmware.filename,
      }),
    );
    assert.equal(firmwareView.validation.valid, true);
    assert.equal(firmwareView.binary.size, 5);
    const artifactDirectory = path.join(root, "artifacts/iodd-transport");
    await mkdir(artifactDirectory, { recursive: true });
    const xmlResult = await call("export", { projectId: a, format: "xml" });
    assert.equal(xmlResult.isError, undefined, xmlResult.content[0].text);
    await writeFile(
      path.join(artifactDirectory, "mcp-wireless-profile.xml"),
      parse(xmlResult).content,
    );
    await writeFile(
      path.join(artifactDirectory, firmware.filename),
      Buffer.from(firmware.content, "base64"),
    );
    await writeFile(
      path.join(artifactDirectory, "reusable-elements.xml"),
      elements.content,
    );
    const project = parse(
      await call("export", { projectId: a, format: "project" }),
    );
    assert.equal(project.encoding, "utf8");
    const c = parse(
      await call("import", { format: "project", content: project.content }),
    ).projectId;
    assert.deepEqual(
      parse(await call("inspect", { projectId: c })),
      parse(await call("inspect", { projectId: a })),
    );
    const report = parse(await call("validate", { projectId: a }));
    assert.equal(report.officialChecker.status, "not-run");
    assert.ok(
      parse(await call("header", { projectId: a })).content.includes("#"),
    );
    assert.ok(parse(await call("diff", { beforeId: b, afterId: a })));
    const zip = parse(
      await call("export", { projectId: a, format: "package" }),
    );
    assert.equal(zip.encoding, "base64");
    const d = parse(
      await call("import", { format: "package", content: zip.content }),
    ).projectId;
    assert.equal(
      parse(await call("inspect", { projectId: d })).identity.vendorName,
      "MCP transport test",
    );
    assert.equal(
      (await call("import", { format: "package", content: "%%%bad" })).isError,
      true,
    );
    assert.equal(
      (
        await call("edit", {
          projectId: a,
          operation: { type: "shell", command: "pwd" },
        })
      ).isError,
      true,
    );
    await call("close", { projectId: a });
    assert.equal((await call("inspect", { projectId: a })).isError, true);
    for (let i = 0; i < 29; i++)
      assert.ok(parse(await call("create", { template: "counter" })).projectId);
    const full = await call("create", { template: "counter" });
    assert.equal(full.isError, true);
    assert.match(parse(full).error.message, /32 projects/);
  } finally {
    await client.close();
  }
});
test("CLI creates, edits, imports and exports explicit files with useful errors", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "iodd-cli-"));
  const cli = path.join(root, "tools/iodd/cli.mjs");
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: tmpdir(),
      env: childEnv,
      encoding: "utf8",
    });
  try {
    const project = path.join(dir, "project.json");
    const created = run("create", "--template", "counter", "--output", project);
    assert.equal(created.status, 0, created.stderr);
    assert.ok(
      created.stdout,
      JSON.stringify({
        status: created.status,
        signal: created.signal,
        error: created.error?.message,
        stderr: created.stderr,
        output: created.output,
      }),
    );
    assert.equal(JSON.parse(created.stdout).ok, true);
    const inspect = run("inspect", "--input", project);
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.ok(JSON.parse(inspect.stdout).identity.vendorId);
    const oldProject = await readFile(project, "utf8");
    const operationFile = path.join(dir, "edit.json");
    await writeFile(
      operationFile,
      JSON.stringify({ type: "identity", values: { vendorId: -1 } }),
    );
    const rejected = run(
      "edit",
      "--input",
      project,
      "--operation",
      operationFile,
      "--output",
      project,
    );
    assert.equal(rejected.status, 1);
    assert.equal(await readFile(project, "utf8"), oldProject);
    await writeFile(
      operationFile,
      JSON.stringify({
        type: "identity",
        values: { vendorName: "CLI edit test" },
      }),
    );
    const oldHandle = await open(project, "r");
    try {
      assert.equal(
        run(
          "edit",
          "--input",
          project,
          "--operation",
          operationFile,
          "--output",
          project,
        ).status,
        0,
      );
      assert.equal(
        await oldHandle.readFile("utf8"),
        oldProject,
        "in-place save must replace atomically, preserving readers of the original",
      );
    } finally {
      await oldHandle.close();
    }
    assert.equal(
      JSON.parse(run("inspect", "--input", project).stdout).identity.vendorName,
      "CLI edit test",
    );
    assert.equal(run("validate", "--input", project).status, 0);
    const destinationDirectory = path.join(dir, "destination");
    await mkdir(destinationDirectory);
    const beforeFailedSave = await readFile(project, "utf8");
    const failedSave = run(
      "export",
      "--input",
      project,
      "--format",
      "project",
      "--output",
      destinationDirectory,
    );
    assert.equal(failedSave.status, 1);
    assert.equal(await readFile(project, "utf8"), beforeFailedSave);
    assert.deepEqual(await readdir(destinationDirectory), []);
    assert.equal(
      (await readdir(dir)).some((name) => name.includes(".iodd-write-")),
      false,
    );
    assert.equal(run("tree", "--input", project).status, 0);
    const binaryFile = path.join(dir, "firmware.bin"),
      metadataFile = path.join(dir, "firmware.json"),
      firmwareFile = path.join(dir, "Example-Counter-20261002-IOLFW1.0.iolfw");
    await writeFile(binaryFile, new Uint8Array([0, 1, 2, 3]));
    await writeFile(
      metadataFile,
      JSON.stringify({
        vendorId: 1234,
        vendorName: "Example",
        firmwareDescriptor: "Counter",
        releaseDate: "2026-10-02",
        version: "V1.0",
        copyright: "Example",
        fwRevision: "V1.0",
        hardwareIds: [{ idPattern: "COUNTER-A" }],
        binaryName: "firmware.bin",
      }),
    );
    const fwCreated = run(
      "fw-create",
      "--metadata",
      metadataFile,
      "--binary",
      binaryFile,
      "--output",
      firmwareFile,
    );
    assert.equal(fwCreated.status, 0, fwCreated.stderr);
    assert.equal(
      JSON.parse(run("fw-inspect", "--input", firmwareFile).stdout).validation
        .valid,
      true,
    );
    const xml = path.join(dir, "device.xml");
    assert.equal(
      run("export", "--input", project, "--format", "xml", "--output", xml)
        .status,
      0,
    );
    assert.match(await readFile(xml, "utf8"), /IODevice/);
    assert.equal(
      run(
        "import",
        "--input",
        xml,
        "--format",
        "xml",
        "--output",
        path.join(dir, "import.json"),
      ).status,
      0,
    );
    assert.equal(
      run("header", "--input", project, "--output", path.join(dir, "map.h"))
        .status,
      0,
    );
    const missing = run("inspect", "--input", path.join(dir, "missing.json"));
    assert.equal(missing.status, 1);
    assert.ok(JSON.parse(missing.stderr).error.message);
    assert.equal(run("create", "--unknown", "x").status, 1);
    const blankProject = path.join(dir, "new-device.json");
    assert.equal(
      run("create", "--template", "new", "--output", blankProject).status,
      0,
    );
    assert.equal(
      JSON.parse(run("inspect", "--input", blankProject).stdout).processData
        .length,
      0,
    );

    const invalidBytes = path.join(dir, "invalid.xml");
    await writeFile(invalidBytes, Buffer.from([0xff, 0xfe, 0x41]));
    const invalidImport = run(
      "import",
      "--format",
      "xml",
      "--input",
      invalidBytes,
      "--output",
      project,
    );
    assert.equal(invalidImport.status, 1);
    assert.match(JSON.parse(invalidImport.stderr).error.message, /UTF-8/i);
    const corruptProject = path.join(dir, "corrupt.json");
    await writeFile(corruptProject, Buffer.from([0xff]));
    assert.match(
      JSON.parse(run("inspect", "--input", corruptProject).stderr).error
        .message,
      /UTF-8/i,
    );
    const invalidProject = JSON.parse(await readFile(project, "utf8"));
    invalidProject.xml = invalidProject.xml.replace(
      'vendorId="1234"',
      'vendorId="0"',
    );
    await writeFile(corruptProject, JSON.stringify(invalidProject));
    const invalidValidation = run(
      "validate",
      "--input",
      corruptProject,
      "--schema",
      "/missing/schema.xsd",
    );
    assert.equal(invalidValidation.status, 2);
    assert.equal(JSON.parse(invalidValidation.stdout).valid, false);
    const selected = run(
      "validate",
      "--input",
      corruptProject,
      "--checks",
      '{"structure":false}',
      "--schema",
      "/missing/schema.xsd",
    );
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(JSON.parse(selected.stdout).valid, true);
    assert.equal(JSON.parse(selected.stdout).schema.status, "not-run");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../../tools/iodd/node-runtime.mjs";
import * as p from "../../assets/js/iodd/project.js";
const xml = readFileSync(
  new URL("../../assets/iodd/counter.xml", import.meta.url),
  "utf8",
);
test("tree handles arbitrary attributes, child insertion/removal and text with atomic failure", () => {
  let a = p.createProject(xml);
  const tree = p.inspectDocumentTree(a);
  assert.equal(tree.name, "IODevice");
  a = p.applyOperation(a, {
    type: "tree",
    action: "attributes",
    selector: "PD_IN",
    values: { bitLength: "32" },
  });
  assert.match(a.xml, /id="PD_IN" bitLength="32"/);
  assert.throws(() =>
    p.applyOperation(a, { type: "tree", action: "remove", selector: [] }),
  );
  const source = p.saveProject(a);
  assert.throws(() =>
    p.applyOperation(a, {
      type: "tree",
      action: "insert",
      selector: [],
      node: { type: "element", name: "bad node", attrs: {}, children: [] },
    }),
  );
  assert.equal(p.saveProject(a), source);
});
test("reusable variable imports dependency text and resolves collisions without corrupting reference IDs", () => {
  let a = p.applyOperation(p.createProject(xml), {
    type: "addVariable",
    values: { id: "V_Custom", name: "Reusable" },
  });
  const reusable = p.exportElements(a, ["V_Custom"]);
  assert.equal(p.inspectElements(reusable).name, "IODDElements");
  let b = p.applyOperation(a, {
    type: "importElements",
    xml: reusable,
    selectors: ["V_Custom"],
    collision: "rename",
  });
  const vars = p.inspectProject(b).variables;
  assert.equal(vars.length, 2);
  assert.notEqual(vars[0].id, vars[1].id);
  assert.notEqual(vars[0].index, vars[1].index);
  assert.equal(vars[1].name, "Reusable");
  assert.equal(p.validateProject(b).valid, true);
});
test("wired/wireless configuration uses actual schema attributes and preserves connections", () => {
  let a = p.applyOperation(p.createProject(xml), {
    type: "communication",
    mode: "wireless",
    values: {
      WMinCycleTimeIn: 5000,
      WMinCycleTimeOut: 5000,
      maxTxPower: 0,
      defaultSlotType: "SSLOT",
    },
  });
  assert.equal(p.inspectProject(a).communication.mode, "wireless");
  assert.match(a.xml, /IOLinkWirelessCommNetworkProfileT/);
  assert.doesNotMatch(a.xml, /bitrate="COM2"/);
  assert.throws(() =>
    p.applyOperation(a, {
      type: "communication",
      mode: "wireless",
      values: { WMinCycleTimeIn: 1 },
    }),
  );
  a = p.applyOperation(a, {
    type: "communication",
    mode: "wired",
    values: {
      bitrate: "COM3",
      minCycleTime: 1000,
      sioSupported: false,
      mSequenceCapability: 11,
    },
  });
  assert.equal(p.inspectProject(a).communication.mode, "wired");
  assert.match(a.xml, /ProductRef productId="reference-device"/);
});
test("declarative rules validate data, can be toggled for inspection and cannot disable export safety", () => {
  let a = p.applyOperation(p.createProject(xml), {
    type: "validationRules",
    rules: [
      {
        id: "minimum",
        selector: "PD_IN",
        kind: "range",
        attribute: "bitLength",
        min: 30,
        max: 64,
        severity: "error",
      },
    ],
  });
  assert.equal(p.validateProject(a).valid, false);
  assert.equal(p.validateProject(a, { checks: { rules: false } }).valid, true);
  assert.throws(() => p.exportProjectXML(a));
  assert.throws(() =>
    p.applyOperation(a, {
      type: "validationRules",
      rules: [
        {
          id: "evil",
          selector: [],
          kind: "pattern",
          attribute: "id",
          pattern: "(a+)+",
        },
      ],
    }),
  );
});
test("profile packs save/reopen and reject mandatory template bindings atomically", () => {
  const snippet =
    '<?xml version="1.0" encoding="UTF-8"?><IODDProfileDefinitions xmlns="http://www.io-link.com/IODD-Snippets/2025/10" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><DocumentInfo copyright="Test fixture" releaseDate="2026-10-02" version="V1.0"/><SupportedProfiles profileCharacteristic="400" profileClassName="Test fixture"><ProfileVariant id="PR_Test" profileId="400" name="Test fixture"/></SupportedProfiles><VariableCollection><Variable id="V_Test" index="400" accessRights="rw"><Datatype xsi:type="UIntegerT" bitLength="16"/><Name textId="T_Test"/></Variable></VariableCollection><ProcessDataCollection><ProcessData id="P_" checkAttributes="startsWith id"/></ProcessDataCollection><UserInterface><MenuCollection><Menu id="M_Test"><VariableRef variableId="V_Test"/></Menu></MenuCollection><ObserverRoleMenuSet><IdentificationMenu menuId="M_Test"/></ObserverRoleMenuSet><MaintenanceRoleMenuSet><IdentificationMenu menuId="M_Test"/></MaintenanceRoleMenuSet><SpecialistRoleMenuSet><IdentificationMenu menuId="M_Test"/></SpecialistRoleMenuSet></UserInterface><ExternalTextCollection><PrimaryLanguage xml:lang="en"><Text id="T_Test" value="Test parameter"/></PrimaryLanguage></ExternalTextCollection></IODDProfileDefinitions>';
  let a = p.applyOperation(p.createProject(xml), {
    type: "profile",
    action: "load",
    xml: snippet,
  });
  a = p.loadProject(p.saveProject(a));
  const binding = p
    .inspectProject(a)
    .profiles[0].placeholders.find((n) => n.kind === "binding");
  assert.ok(binding);
  const old = p.saveProject(a);
  assert.throws(
    () =>
      p.applyOperation(a, {
        type: "profile",
        action: "apply",
        id: "Profile_1",
        profileId: "400",
      }),
    /bind/i,
  );
  assert.equal(p.saveProject(a), old);
  a = p.applyOperation(a, {
    type: "profile",
    action: "apply",
    id: "Profile_1",
    profileId: "400",
    replacements: { [binding.key]: "PD_Example" },
  });
  assert.equal(p.validateProject(a).valid, true);
  assert.equal(p.inspectProject(a).variables[0].id, "V_Test");
  assert.equal(p.inspectProject(a).processData[0].bits, "24");
  assert.doesNotMatch(
    p.exportProjectXML(a),
    /checkAttributes|profileConstraints/,
  );
  const reapplied = p.applyOperation(a, {
    type: "profile",
    action: "apply",
    id: "Profile_1",
    profileId: "400",
    replacements: { [binding.key]: "PD_Example" },
  });
  assert.equal(
    p.inspectProject(reapplied).variables.length,
    p.inspectProject(a).variables.length,
  );
  const changed = p.applyOperation(a, {
    type: "tree",
    action: "attributes",
    selector: "V_Test",
    values: { accessRights: "ro" },
  });
  const before = p.saveProject(changed);
  assert.throws(
    () =>
      p.applyOperation(changed, {
        type: "profile",
        action: "apply",
        id: "Profile_1",
        profileId: "400",
        replacements: { [binding.key]: "PD_Example" },
      }),
    /Shared profile definition conflict: V_Test/,
  );
  assert.equal(p.saveProject(changed), before);
});
test("reusable shared datatype and translated text dependencies survive export/import", () => {
  const custom = xml
    .replace(
      "<ProcessDataCollection>",
      '<DatatypeCollection><Datatype id="D_Shared" xsi:type="UIntegerT" bitLength="16"/></DatatypeCollection><ProcessDataCollection>',
    )
    .replace(
      "</VariableCollection>",
      '<Variable id="V_Shared" index="350" accessRights="rw"><DatatypeRef datatypeId="D_Shared"/><Name textId="T_Shared"/></Variable></VariableCollection>',
    )
    .replace(
      "</PrimaryLanguage>",
      '<Text id="T_Shared" value="Shared value"/></PrimaryLanguage><Language xml:lang="de"><Text id="T_Shared" value="Gemeinsamer Wert"/></Language>',
    );
  const library = p.exportElements(p.createProject(custom), ["V_Shared"]);
  let target = p.applyOperation(p.createProject(xml), {
    type: "importElements",
    xml: library,
    selectors: ["V_Shared"],
    collision: "error",
  });
  assert.equal(p.inspectProject(target).variables[0].type, "UIntegerT");
  assert.equal(
    p.inspectProject(target).texts.find((n) => n.language === "de").texts[0]
      .value,
    "Gemeinsamer Wert",
  );
  assert.equal(p.validateProject(target).valid, true);
});
test("tree ID rename updates menu references and namespace declarations survive reusable export", () => {
  let a = p.applyOperation(p.createProject(xml), {
    type: "addVariable",
    values: { id: "V_Linked", name: "Linked" },
  });
  a = p.applyOperation(a, {
    type: "menu",
    values: { id: "M_Linked", name: "Linked", variableIds: ["V_Linked"] },
  });
  a = p.applyOperation(a, {
    type: "tree",
    action: "attributes",
    selector: "V_Linked",
    values: { id: "V_Renamed" },
  });
  assert.equal(
    p.inspectProject(a).menus.find((m) => m.id === "M_Linked").variableIds[0],
    "V_Renamed",
  );
  assert.equal(p.validateProject(a).valid, true);
  const library = p.exportElements(
    p.createProject(
      a.xml.replace("xmlns:xsi=", 'xmlns:extra="urn:example" xmlns:xsi='),
    ),
    ["V_Renamed"],
  );
  assert.match(library, /xmlns:extra="urn:example"/);
});
test(
  "released Common, Locator FunctionClass and BLOB profile composition passes official XSD",
  {
    skip:
      !process.env.IODD_COMMON_PROFILE ||
      !process.env.IODD_BLOB_PROFILE ||
      !process.env.IODD_SCHEMA,
  },
  async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    let a = p.applyOperation(p.createProject(xml), {
      type: "profile",
      action: "load",
      xml: readFileSync(process.env.IODD_COMMON_PROFILE, "utf8"),
    });
    const replacements = {};
    for (const item of p.inspectProject(a).profiles[0].placeholders) {
      if (item.value === "P_") replacements[item.key] = "PD_Example";
      else if (item.attribute === "defaultValue")
        replacements[item.key] = "Example";
      else if (item.attribute === "fixedLengthRestriction")
        replacements[item.key] = "16";
    }
    a = p.applyOperation(a, {
      type: "profile",
      action: "apply",
      id: "Profile_1",
      profileId: "16384",
      replacements,
    });
    const common = a;
    a = p.applyOperation(a, {
      type: "profile",
      action: "apply",
      id: "Profile_1",
      profileId: "33025",
      replacements,
    });
    assert.match(a.xml, /value="126"/);
    assert.match(a.xml, /value="127"/);
    assert.equal(p.validateProject(a).valid, true);
    const changed = p.applyOperation(common, {
      type: "tree",
      action: "attributes",
      selector: "TN_M_CP_Diag_DeviceStatusInfo",
      values: { value: "Conflicting name" },
    });
    const saved = p.saveProject(changed);
    assert.throws(
      () =>
        p.applyOperation(changed, {
          type: "profile",
          action: "apply",
          id: "Profile_1",
          profileId: "33025",
          replacements,
        }),
      /conflict/i,
    );
    assert.equal(p.saveProject(changed), saved);
    a = p.applyOperation(a, {
      type: "profile",
      action: "load",
      xml: readFileSync(process.env.IODD_BLOB_PROFILE, "utf8"),
    });
    a = p.applyOperation(a, {
      type: "profile",
      action: "apply",
      id: "Profile_2",
      profileId: "48",
    });
    assert.equal(p.validateProject(a).valid, true);
    assert.equal(
      p.inspectProject(a).variables.find((v) => v.id === "V_BT_BLOBID").index,
      "49",
    );
    assert.equal(
      p
        .validateProject(a)
        .issues.some((n) => /also requires profile/i.test(n.message)),
      false,
    );
    const dir = mkdtempSync(join(tmpdir(), "iodd-profiles-proof-"));
    try {
      const file = join(dir, "description.xml");
      writeFileSync(file, p.exportProjectXML(a));
      const checked = spawnSync(
        "xmllint",
        ["--nonet", "--noout", "--schema", process.env.IODD_SCHEMA, file],
        { encoding: "utf8" },
      );
      assert.equal(checked.status, 0, checked.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("new device starts with minimal real schema framing and no example firmware fields", () => {
  const a = p.createNewProject({
    vendorId: 1234,
    deviceId: 8765,
    vendorName: "Test maker",
    productName: "New device",
    productId: "test-device",
    releaseDate: "2026-10-02",
  });
  const view = p.inspectProject(a);
  assert.equal(view.variables.length, 0);
  assert.equal(view.processData.length, 0);
  assert.equal(view.identity.deviceId, "8765");
  assert.equal(p.validateProject(a).valid, true);
  assert.match(p.exportProjectXML(a), /ProcessData id="PD_None"/);
  assert.doesNotMatch(a.xml, /Counter|Button|LED|Threshold|Hysteresis/);
});
test("overlapping bounded quantifiers cannot trigger whole-input regex backtracking", async () => {
  const { spawnSync } = await import("node:child_process");
  const proof =
    "import {compilePattern} from './assets/js/iodd/validation-pattern.js';for(const [pattern,value] of [['^'+'a{1,64}'.repeat(6)+'$','a'.repeat(512)],['^'+'a{0,32}'.repeat(8)+'b$','a'.repeat(200)+'x']])if(compilePattern(pattern).test(value))process.exit(1);";
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", proof],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      timeout: 1500,
    },
  );
  assert.equal(child.status, 0, child.error?.message ?? child.stderr);
  const { compilePattern } =
    await import("../../assets/js/iodd/validation-pattern.js");
  assert.equal(compilePattern("^V[0-9]+\\.[0-9]+$").test("V1.12"), true);
  assert.equal(compilePattern("^V[0-9]+\\.[0-9]+$").test("bad"), false);
  assert.equal(compilePattern("[a-z]+").test("42abc99"), true);
});
test("reusable event nodes without IDs preserve text closure and reject code collisions", () => {
  const library =
    '<IODDElements xmlns="http://www.io-link.com/IODD/2010/10"><Event code="32768" type="Warning"><Name textId="T_ImportedEvent"/></Event><ExternalTextCollection><PrimaryLanguage xml:lang="en"><Text id="T_ImportedEvent" value="Imported warning"/></PrimaryLanguage></ExternalTextCollection></IODDElements>';
  const operation = {
    type: "importElements",
    xml: library,
    selectors: [[0]],
    collision: "rename",
  };
  const a = p.applyOperation(p.createProject(xml), operation);
  assert.equal(p.inspectProject(a).events[0].name, "Imported warning");
  assert.equal(p.validateProject(a).valid, true);
  assert.throws(() => p.applyOperation(a, operation), /event code collision/i);
});

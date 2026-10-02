# IODD authoring, recovery and firmware proof with MCP

The browser editor, command line and hosted/local MCP servers use the same XML-preserving authoring engine. The MCP server provides 20 typed tools for authoring, recovery, reusable definitions and firmware artifacts. They create and reopen projects, edit identity, parameters, process fields, texts, events and menus, retain package assets, compare revisions and generate firmware mapping headers.

The examples contain example vendor/device IDs. Replace them with IDs assigned to your device before release. Basic model and CRC checks help catch authoring errors; they do not constitute official IODD approval or a manufacturer declaration. Run the official checker separately for release validation.

## Connect your assistant

Use the [client picker](https://iolinki.com/iodd-mcp.html) for copyable ChatGPT, Claude, Codex, Cursor and VS Code setup instructions.

The hosted Streamable HTTP endpoint is:

```text
https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp
```

No iolinki account is needed. Hosted projects are processed on the server. Export project JSON or a ZIP for a copy you control, or explicitly save a private-token recovery snapshot for up to 24 hours. Use the local server when files should stay on your machine; submitting its firmware sources to LabWired sends them to that service.

- **ChatGPT:** enable Developer mode in Settings → Security and login, then open [Plugins](https://chatgpt.com/plugins), select +, and enter the endpoint. Availability depends on account and workspace policy. [Official guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
- **Claude Code:** `claude mcp add --transport http iolinki-iodd https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp`. [Official guide](https://code.claude.com/docs/en/mcp).
- **Codex:** `codex mcp add iolinki-iodd --url https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp`. [Official guide](https://developers.openai.com/codex/mcp).
- **Cursor:** use the install button in the client picker, or add the URL in MCP settings. [Official install-link format](https://prod.cursor.com/docs/mcp/install-links).
- **VS Code:** run **MCP: Add Server**, choose HTTP, and enter the endpoint. [Official guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

### Run locally

Install Node.js 22 or newer, then start the pinned package:

```sh
npx -y https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz
```

For clients using `mcpServers` JSON (such as Cursor or Claude Desktop):

```json
{
  "mcpServers": {
    "iolinki-iodd": {
      "command": "npx",
      "args": ["-y", "https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz"]
    }
  }
}
```

Codex local setup: `codex mcp add iolinki-iodd -- npx -y https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz`.
Claude Code local setup: `claude mcp add iolinki-iodd -- npx -y https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz`.
VS Code uses a top-level `servers` object and `type: "stdio"` for the local configuration.

The local server uses stdio and keeps projects and recovery snapshots in process memory. Its save result reports `durable:false`; a token does not survive a local process restart. Export project JSON or a ZIP before restarting. It reads bundled templates; imports receive content from the client without arbitrary filesystem paths or shell commands.

### Give your agent context

Read [llms.txt](https://iolinki.com/llms.txt) or download the [agent plugin and skills](https://iolinki.com/downloads/iolinki-agent-plugin.zip) for stack, hardware and IODD workflows.

Example prompt:

> Create a switching-sensor IODD. Ask for my assigned vendor and device IDs. Inspect its threshold, hysteresis and process-data fields, apply my defaults, and validate it. Export editable JSON, XML and ZIP, save a recovery snapshot, and keep its token private. Generate the firmware source kit; if LabWired is connected, compile it and verify the sensor behavior. Report basic checks, official XSD, official Checker and MCU execution separately.

Validation covers model references, ranges, process bits and CRC. Official checker results are reported separately when a checker is configured.

## Tools

| Tool | Purpose |
| --- | --- |
| `iodd_create` | Create a minimal `new`, `counter` or `switching-sensor` project |
| `iodd_import` | Import XML, project JSON or package ZIP content |
| `iodd_inspect` | Read identity, parameters, process fields and assets |
| `iodd_edit` | Apply one atomic authoring operation |
| `iodd_validate` | Report basic model/CRC and separate external validation results |
| `iodd_export` | Export XML, editable project JSON or ZIP |
| `iodd_diff` | Compare two project revisions |
| `iodd_header` | Generate a C parameter/process mapping header |
| `iodd_close` | Release a session project from memory |
| `iodd_tree` | Read the complete preserving XML tree |
| `iodd_elements_inspect` | Inspect supplied reusable definition XML |
| `iodd_elements_export` | Export selected definitions with dependencies |
| `iodd_profile_inspect` | Inspect supplied profile variants and placeholders |
| `iodd_firmware_create` | Package supplied binary/resources as IOLFW1.0 |
| `iodd_firmware_inspect` | Inspect IOLFW metadata, inventory and CRC |
| `iodd_save` | Save an explicit snapshot and return a private recovery token |
| `iodd_restore` | Restore a snapshot into a new session project |
| `iodd_delete_saved` | Delete a snapshot using its token |
| `iodd_firmware_source` | Generate arguments for LabWired compile and verify |
| `iodd_firmware_kit` | Export complete switching-sensor application proof source |

Create/import returns a `projectId`; pass it to subsequent tools. `iodd_diff` takes `beforeId` and `afterId`. Imports take `format`, `content` and optional `filename`. XML and project JSON content are UTF-8 text; ZIP content is base64. Export replies identify their encoding. Editing a project changes only that project; a rejected edit leaves it intact.

An edit operation has a `type` and its required fields. For example:

```json
{
  "projectId": "ID-FROM-CREATE",
  "operation": {
    "type": "identity",
    "values": { "vendorName": "My Company", "productName": "Pulse Counter" }
  }
}
```

Inspect the project before editing to discover existing IDs. Tool schemas enumerate identity and parameter fields, datatype/access choices, and numeric bounds. Partial edits preserve omitted values. Process fields accept `name`, `type` (`BooleanT`, `UIntegerT`, `IntegerT`), `offset` (0–255), and `bits` (1 for BooleanT, 2–64 for integers); they must fit without overlap. Field `index` is the zero-based position returned by inspection, separate from the IODD subindex. Supported operations include `identity`, `addVariable`, `editVariable`, `removeVariable`, `addProcessField`, `editProcessField`, `removeProcessField`, `text`, `event`, `menu`, `asset`, `removeEvent`, `removeMenu` and `removeAsset`. Tool schemas describe the required ID, field index, language or content. Errors include an actionable message; correct the input and retry.

The server allows up to 32 projects and 64 MiB of serialized project state per process. Individual imports retain the engine's limits: 4 MiB XML, 16 MiB expanded package content, 128 files and safe relative filenames. Close unused projects to release state. The server bounds incoming MCP frames to 32 MiB; clients exporting large packages or project JSON may need a receive limit of at least 32 MiB.

## Recover a project

Call `iodd_save` with `{ "projectId": "YOUR-PROJECT-ID" }`. Its response includes `token`, `expiresAt`, `lifetimeMs`, `bytes` and `durable`. Hosted storage is durable across runtime/session restarts, with a maximum 24-hour lifetime from the save. Session projects are still temporary; edits do not automatically update a saved snapshot. Save again to capture later work.

Keep the token private: anyone possessing it can restore or delete that snapshot. In a new session, call `iodd_restore` with `{ "token": "YOUR-PRIVATE-TOKEN" }` and use the new returned `projectId`. Restoration leaves the snapshot available until expiry or `iodd_delete_saved`. Delete with the same token when recovery is no longer needed. `iodd_close` releases only the current session project, not its saved snapshots or exported files.

Local stdio snapshots are memory-only, even though the same tools are present. A local restart loses projects and tokens. Hosted recovery currently accepts at most 8 MiB of serialized project data per snapshot; an export can remain useful when the recovery limit is exceeded. A saved snapshot is distinct from an expiring export-download URL. Download exports promptly and keep project JSON for longer retention.

## Compile and verify the authored sensor application

For a compatible `switching-sensor` project, call `iodd_firmware_source` with `projectId`. It returns `compile` arguments, `verify` arguments, `scope` and source provenance. Call the connected LabWired plugin's `labwired_compile` with `compile`, then call `labwired_verify` with `verify` plus the returned `firmware_ref`. For larger requests, `labwired_put_source` can store `compile.source` and `compile.files` first; pass its `source_tree_ref` instead of those inline sources. These are existing LabWired tools; the IODD server does not execute arbitrary shell commands.

`iodd_firmware_kit` exports a ZIP containing the same source, editable project JSON/XML, generated mapping and defaults, license, upstream hashes, checksums and `labwired.json` instructions. The unchanged GPL-3.0-or-later sensor implementation is pinned to [iolinki v2.1.0](https://github.com/w1ne/iolinki/releases/tag/v2.1.0), commit `ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca`. The kit rejects incompatible parameter indexes, access/ranges or process bits rather than inventing matching code. Authored valid defaults are applied through the actual parameter service.

The target is `stm32f401cdu6-blackpill`, with C entry `src/main.c` and a UART2 oracle. The firmware checks authored defaults, threshold/hysteresis, validity, parameter write/readback, big-endian process-byte decoding, inversion and teach. Hosted tests observed `model_verified` for both template and changed defaults; a tampered default emitted `IODD_SENSOR_PROOF_FAIL` and failed verification, and a changed validity bit failed compilation.

This is genuine sensor **application MCU execution**, not an IO-Link transport/PHY image or a physical test. Report the actual LabWired verdict, console evidence and model gaps. The observed model assumes an ideal 3.3 V supply and derives device time from CPU frequency without tracking PLL changes. It does not prove analog cable/PHY behavior, physical-master operation, retained flash, EWARM compilation or official conformity. Source generation alone is not a compile or execution result.

## Command line

Every command uses explicit paths and rejects invalid UTF-8 text. Saves write and sync a temporary file in the destination directory, then rename it over the destination; failed writes preserve the prior file. Reads are bounded before allocating input: 4 MiB for XML, 24 MiB for project JSON, 16 MiB for ZIP, and 1 MiB for an operation file. Status/inspection/diff reports are JSON on stdout; errors are JSON on stderr. Exit code `0` means the command completed, `1` means an input or operation failed, and `2` means validation found basic errors.

```sh
node tools/iodd/cli.mjs create --template counter --output counter.project.json
node tools/iodd/cli.mjs inspect --input counter.project.json
node tools/iodd/cli.mjs edit --input counter.project.json --operation identity-edit.json --output edited.project.json
node tools/iodd/cli.mjs validate --input edited.project.json
node tools/iodd/cli.mjs export --input edited.project.json --format xml --output counter.xml
node tools/iodd/cli.mjs export --input edited.project.json --format package --output counter.zip
node tools/iodd/cli.mjs import --format package --input counter.zip --output reopened.project.json
node tools/iodd/cli.mjs diff --before counter.project.json --after edited.project.json
node tools/iodd/cli.mjs header --input edited.project.json --output counter-map.h
```

`identity-edit.json` contains only the operation, for example `{"type":"identity","values":{"vendorName":"My Company"}}`. A project JSON file preserves XML and assets for reopening. Exported XML is stamped after basic errors are resolved. A firmware mapping header describes indexes and bit offsets; check it against your firmware implementation. Generating it does not prove firmware execution or physical device behavior.

## Official XSD and separate Checker validation

Hosted `iodd_validate` runs the published October 2025 official IODD schema package through an XSD validator after the full basic check set passes. The package is pinned by archive SHA-256; included schemas resolve locally, with no request-selected schema URLs or external-entity fetching. Inspect the returned `schema` status, validator and provenance/digest: a failed or unavailable validator is not a schema pass.

An XSD pass establishes schema validity. It does not run the official IODD Checker or issue a manufacturer declaration. The hosted official Checker is unavailable until an actual permitted distribution is installed and executed; its separate `officialChecker` result must not be treated as passed. The repository does not redistribute it.

For local CLI/stdio use, install the official IODD XSD and, separately, an official Checker under its distribution terms. The CLI records actual results independently from basic checks:

```sh
node tools/iodd/cli.mjs validate --input edited.project.json --schema /absolute/path/IODD1.1.xsd
node tools/iodd/cli.mjs validate --input edited.project.json --checker /absolute/path/checker --checker-args '["{file}"]'
```

Use the argument list required by your installed checker, including one standalone `{file}` placeholder. The runner substitutes a temporary XML filename, invokes the executable without a shell, limits captured output and times out after 30 seconds. XSD validation requires `xmllint`. A successful XSD result is separate from an official checker result.

For local stdio MCP, the operator may set `IODD_SCHEMA`, `IODD_CHECKER`, and `IODD_CHECKER_ARGS` (a JSON argument array) in the server's startup environment. Tool calls cannot select an executable or argument list. Without configuration, external statuses are `not-run`. Resolve basic errors before external checks run; invalid projects retain their basic diagnostic report. The repository does not redistribute the official checker.

## Full XML, profiles and firmware packages

`iodd_tree` reads the complete XML tree. `iodd_edit` supports atomic `tree` operations (`attributes`, `text`, `insert`, `remove`) using an XML ID or a root-relative child-index array as its selector; `[]` means the root. Attribute values are strings; `null` removes an attribute. Generic tree edits preserve supported unfamiliar sections, and export still requires basic checks to pass.

`iodd_elements_inspect` reads supplied XML for reusable elements. `iodd_elements_export` exports selected project elements and their dependencies. Import them through an `importElements` edit with `xml`, `selectors`, optional `destination`, and `collision` (`rename` or `error`). `iodd_profile_inspect` lists variants and placeholders in supplied official `IODDProfileDefinitions` XML. Load it with a `profile` edit (`action:"load"`, `xml`), inspect the returned project for the pack ID, then apply with `action:"apply"`, `id`, `profileId`, and `replacements`. Official profile files are obtained separately from IO-Link; the repository does not redistribute their documents.

Communication edits use `type:"communication"`, `mode:"wired"` or `"wireless"`, and `values`. Wired fields include `bitrate`, `minCycleTime`, `mSequenceCapability` and `sioSupported`. Wireless fields include `WMinCycleTimeIn`, `WMinCycleTimeOut`, `maxTxPower`, `defaultSlotType`, `isABridge` and `isLowPowerDevice`. The schemas describe their bounds. Declarative `validationRules` edits accept up to 128 `required`, `range` or bounded `pattern` checks; they cannot execute code or bypass export checks.

`iodd_firmware_create` packages supplied base64 binary and optional resources into an IOLFW1.0 archive. `iodd_firmware_inspect` verifies the archive's metadata, file references and continuous CRC, and reports informational SHA-256 fingerprints. These operations create and inspect files; they do not sign firmware, approve device compatibility or flash hardware. The format follows the released [IO-Link BLOBs & Firmware Update V1.2.1 package](https://io-link.com/fileadmin/user_upload/Downloads/Package_2025/IO-Link_Profile_Firmware-Update_10.082_V1.2.1_Oct2025.zip), which retains IOLFW1.0.

Firmware metadata uses this shape:

```json
{
  "vendorId": 1234,
  "vendorName": "Example",
  "firmwareDescriptor": "Counter",
  "releaseDate": "2026-10-02",
  "version": "V1.0",
  "copyright": "Example",
  "fwRevision": "V1.0",
  "hardwareIds": [{ "idPattern": "COUNTER-A" }],
  "binaryName": "firmware.bin"
}
```

Replace example IDs and hardware patterns with values assigned to and implemented by your device. Optional fields include `fwPasswordRequired`, `fwActivationRetryCount`, `descriptions` and `infoMessages` (arrays of `{lang,description}`). Each MCP resource is `{id,name,base64}`. Package filenames are derived from vendor, descriptor and release date; the metadata XML uses the same basename.

The CLI supports the same workflows:

```sh
node tools/iodd/cli.mjs tree --input device.project.json
node tools/iodd/cli.mjs elements --input elements.xml
node tools/iodd/cli.mjs elements-export --input device.project.json --selectors selectors.json --output elements.xml
node tools/iodd/cli.mjs profile-inspect --input official-profile.xml
node tools/iodd/cli.mjs fw-create --metadata firmware.json --binary firmware.bin --output Example-Counter-20261002-IOLFW1.0.iolfw
node tools/iodd/cli.mjs fw-inspect --input Example-Counter-20261002-IOLFW1.0.iolfw
```

`selectors.json` is an array of XML IDs or child-index arrays. Firmware creation optionally takes `--resources resources.json`, an array of `{id,name,path}` entries pointing to local resource files. IOLFW output names must match the required naming convention. Packages contain flat filenames, at most 128 files and at most 16 MiB of expanded content. Firmware CRC covers metadata with the root CRC value emptied, then binary bytes, then resource bytes in metadata order.

## Capability and verification matrix

The [published IODD Studio feature list](https://teconcept.de/en/products/io-link-iodd-studio/) informed this workflow checklist. This records implemented functionality and observed tests; it does not establish equivalence with every behavior of proprietary software.

| Workflow                                       | Available here                                                                          | Independent verification and limits                                                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a device or manufacturer template       | True minimal `new` device plus editable counter/sensor examples; browser, CLI and MCP   | New projects have no invented application parameters or process fields. Default IDs are illustrative; enter assigned IDs.                                                                                                                                                   |
| Wired/wireless authoring                       | Typed communication forms and complete XML tree                                         | Generated wired/wireless XML checked with released official IODD XSD; no physical RF or device execution proof.                                                                                                                                                             |
| Parameter/process/XML editing                  | Atomic forms, bit layout, preserving tree and XML                                       | Negative edits leave prior projects intact; export keeps full safety checks. Unsupported mixed-content or prefixed-root documents are rejected with guidance.                                                                                                               |
| Configurable validators                        | Inspection switches and declarative required/range/pattern rules                        | Switches filter reports and cannot bypass export safety. Patterns use a bounded linear matcher supporting atoms, classes, anchors and quantifiers; groups, alternatives and backreferences are rejected.                                                                    |
| Save/reopen and templates                      | Project JSON, preserving ZIP/XML, revision comparison; explicit hosted 24-hour snapshots                                   | Browser desktop/mobile roundtrips, CLI atomic saves, real MCP roundtrips and package limits tested.                                                                                                                                                                         |
| Finder search/import                           | Browser search against the official public Finder through a narrow read-only CORS proxy | Real browser CORS, ten Festo SDAT results, 54,097-byte download and browser import verified through the deployed proxy. Finder requires network access; local edits and supplied imports stay local.                                                                        |
| Identification/diagnostic and BLOB/FW profiles | Load supplied official definition packs; inspect variants/placeholders, bind and apply  | Common Profile `16384`, Locator `33025` and BLOB Transfer `48` generated XML independently checked against released official XSD. Other pack variants are available for inspection/application but have not all been individually certified. Required-profile dependencies produce guidance. |
| Reusable imported elements                     | Export/import selected definitions and dependency closure with collision policies       | Existing IODDs and reusable libraries tested; collisions remap references and variable indexes or report errors.                                                                                                                                                            |
| IOLFW package creation                         | Original IOLFW1.0 flat ZIP creator/inspector in browser, CLI and MCP                    | Released V1.2.1 sample CRC, generated official-XSD validation, corruption rejection, and actual desktop/mobile browser downloads verified. Packaging does not sign, flash or validate hardware compatibility.                                                               |
| Official conformance checking                  | Optional operator-installed official checker and official XSD                           | Actual process status/output remains separate from model/CRC checks. No automatic manufacturer declaration or official checker approval is generated.                                                                                                                       |

The default MCP/CLI create mode is `new`. MCP creation accepts optional typed `identity` values; CLI creation accepts `--identity identity.json`. Use `iodd_validate` with a `checks` object or CLI `validate --checks '{"rules":false}'` to inspect a selected check set. Supported keys are `structure`, `references`, `ranges`, `processData`, `crc`, `assets` and `rules`. External validation runs only when the full basic check set passes.

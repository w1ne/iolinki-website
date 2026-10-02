# Local IODD authoring with MCP and CLI

The browser editor, command line and local MCP server use the same XML-preserving authoring engine. They create and reopen projects, edit identity, parameters, process fields, texts, events and menus, retain package assets, compare revisions and generate firmware mapping headers.

The examples contain example vendor/device IDs. Replace them with IDs assigned to your device before release. Basic model and CRC checks help catch authoring errors; they do not constitute official IODD approval or a manufacturer declaration. Run the official checker separately for release validation.

## Connect your assistant

Use the [client picker](https://iolinki.com/iodd-mcp.html) for copyable ChatGPT, Claude, Codex, Cursor and VS Code setup instructions.

The hosted Streamable HTTP endpoint is:

```text
https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp
```

No iolinki account is needed. Hosted projects are processed on the server; export project JSON or a ZIP to keep your work. For private files, run the local server.

- **ChatGPT:** enable Developer mode in Settings → Security and login, then open [Plugins](https://chatgpt.com/plugins), select +, and enter the endpoint. Availability depends on account and workspace policy. [Official guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
- **Claude Code:** `claude mcp add --transport http iolinki-iodd https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp`. [Official guide](https://code.claude.com/docs/en/mcp).
- **Codex:** `codex mcp add iolinki-iodd --url https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp`. [Official guide](https://developers.openai.com/codex/mcp).
- **Cursor:** use the install button in the client picker, or add the URL in MCP settings. [Official install-link format](https://prod.cursor.com/docs/mcp/install-links).
- **VS Code:** run **MCP: Add Server**, choose HTTP, and enter the endpoint. [Official guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

### Run locally

Install Node.js 22 or newer, then start the pinned package:

```sh
npx -y https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz
```

For clients using `mcpServers` JSON (such as Cursor or Claude Desktop):

```json
{
  "mcpServers": {
    "iolinki-iodd": {
      "command": "npx",
      "args": ["-y", "https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz"]
    }
  }
}
```

Codex local setup: `codex mcp add iolinki-iodd -- npx -y https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz`.
Claude Code local setup: `claude mcp add iolinki-iodd -- npx -y https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz`.
VS Code uses a top-level `servers` object and `type: "stdio"` for the local configuration.

The local server uses stdio and keeps projects in memory. Export project JSON or a ZIP before restarting. It reads bundled templates; imports receive content from the client without arbitrary filesystem paths or shell commands.

### Give your agent context

Read [llms.txt](https://iolinki.com/llms.txt) or download the [agent plugin and skills](https://iolinki.com/downloads/iolinki-agent-plugin.zip) for stack, hardware and IODD workflows.

Example prompt:

> Create a switching-sensor IODD. Ask me for my assigned vendor and device IDs. Inspect its threshold, hysteresis and process-data fields, validate it, and export the project, XML, ZIP and C firmware mapping header.

Validation covers model references, ranges, process bits and CRC. Official checker results are reported separately when a checker is configured.

## Tools

| Tool            | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `iodd_create`   | Create `counter` or `switching-sensor` template      |
| `iodd_import`   | Import XML, project JSON or package ZIP content      |
| `iodd_inspect`  | Read identity, parameters, process fields and assets |
| `iodd_edit`     | Apply one atomic authoring operation                 |
| `iodd_validate` | Report basic model and CRC checks                    |
| `iodd_export`   | Export XML, project JSON or ZIP                      |
| `iodd_diff`     | Compare two project revisions                        |
| `iodd_header`   | Generate a C mapping header                          |
| `iodd_close`    | Release a project from memory                        |

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

## Optional external validation

Install an official IODD XSD and, separately, a licensed official checker according to their distribution terms. The CLI can record actual results separately from basic checks:

```sh
node tools/iodd/cli.mjs validate --input edited.project.json --schema /absolute/path/IODD1.1.xsd
node tools/iodd/cli.mjs validate --input edited.project.json --checker /absolute/path/checker --checker-args '["{file}"]'
```

Use the argument list required by your installed checker, including one standalone `{file}` placeholder. The runner substitutes a temporary XML filename, invokes the executable without a shell, limits captured output and times out after 30 seconds. XSD validation requires `xmllint`. A successful XSD result is separate from an official checker result.

For MCP, the operator may set `IODD_SCHEMA`, `IODD_CHECKER`, and `IODD_CHECKER_ARGS` (a JSON argument array) in the server's startup environment. Tool calls cannot select an executable or argument list. Without configuration, external statuses are `not-run`. Resolve basic errors before external checks run; invalid projects retain their basic diagnostic report. The repository does not redistribute the official checker.

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
| Save/reopen and templates                      | Project JSON, preserving ZIP/XML, revision comparison                                   | Browser desktop/mobile roundtrips, CLI atomic saves, real MCP roundtrips and package limits tested.                                                                                                                                                                         |
| Finder search/import                           | Browser search against the official public Finder through a narrow read-only CORS proxy | Real browser CORS, ten Festo SDAT results, 54,097-byte download and browser import verified through the deployed proxy. Finder requires network access; local edits and supplied imports stay local.                                                                        |
| Identification/diagnostic and BLOB/FW profiles | Load supplied official definition packs; inspect variants/placeholders, bind and apply  | Common Profile `16384`, Locator `33025` and BLOB Transfer `48` generated XML independently checked against released official XSD. Other pack variants are available for inspection/application but have not all been individually certified. Required-profile dependencies produce guidance. |
| Reusable imported elements                     | Export/import selected definitions and dependency closure with collision policies       | Existing IODDs and reusable libraries tested; collisions remap references and variable indexes or report errors.                                                                                                                                                            |
| IOLFW package creation                         | Original IOLFW1.0 flat ZIP creator/inspector in browser, CLI and MCP                    | Released V1.2.1 sample CRC, generated official-XSD validation, corruption rejection, and actual desktop/mobile browser downloads verified. Packaging does not sign, flash or validate hardware compatibility.                                                               |
| Official conformance checking                  | Optional operator-installed official checker and official XSD                           | Actual process status/output remains separate from model/CRC checks. No automatic manufacturer declaration or official checker approval is generated.                                                                                                                       |

The default MCP/CLI create mode is `new`. MCP creation accepts optional typed `identity` values; CLI creation accepts `--identity identity.json`. Use `iodd_validate` with a `checks` object or CLI `validate --checks '{"rules":false}'` to inspect a selected check set. Supported keys are `structure`, `references`, `ranges`, `processData`, `crc`, `assets` and `rules`. External validation runs only when the full basic check set passes.

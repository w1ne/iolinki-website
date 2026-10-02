# Use iolinki with an agent

Connect the [IODD MCP tools](https://iolinki.com/iodd-mcp.html), then ask your agent to create, inspect, edit, validate and export a device description. The 20 tools also generate C mappings, save explicit recoverable snapshots and prepare sensor source for the connected LabWired compile/verify tools.

Try:

> Create a switching-sensor IODD with my assigned identity and parameter defaults. Inspect and validate it, export editable JSON/XML/ZIP, and save a recovery snapshot with its token kept private. Generate the source kit, then use LabWired to compile and verify the sensor application if connected. Report each validation and execution result separately.

## Give an agent the instructions

The public entry point is [iolinki.com/llms.txt](https://iolinki.com/llms.txt). It links to current releases, device and master documentation, examples, setup and test evidence. The [iolinki skill](https://iolinki.com/plugins/iolinki/skills/iolinki/SKILL.md) contains the actual authoring and integration workflow.

For a project's `AGENTS.md`, add:

```markdown
For IO-Link device descriptions and iolinki firmware integration, read
https://iolinki.com/plugins/iolinki/skills/iolinki/SKILL.md.
Use https://iolinki.com/llms.txt to find released documentation and examples.
Match vendor/device identity, ISDU indexes and process-data layout to the firmware.
Report compiler, simulation, physical and conformance checks separately.
```

This makes the guidance available when an agent works in that project. Publishing `llms.txt` also gives search and browsing agents a readable starting point; it does not force every search engine or agent to discover the site.

## Install the skill and plugin

Download the [portable agent plugin](https://iolinki.com/downloads/iolinki-agent-plugin.zip) and extract it into a directory of your choice. It includes `plugins/iolinki/plugin.json`, a remote `mcp.json`, the skill and a repo marketplace catalog.

To add the repository as a Codex marketplace:

```sh
codex plugin marketplace add w1ne/iolinki-website --ref master
```

Use the supported client's Plugins Directory to install **iolinki** from that marketplace and start a new session. Alternatively, copy `plugins/iolinki/skills/iolinki` into your client's skills directory; for Codex this is `~/.codex/skills/iolinki`. Add the MCP connection using the setup page.

## ChatGPT

In ChatGPT, enable Developer mode in **Settings → Security and login**, then open [Plugins](https://chatgpt.com/plugins), select **+** and register the hosted MCP URL shown on the setup page. Availability depends on your account and workspace policy.

The downloadable plugin follows the portable Agent Plugins format with a skill and Streamable HTTP MCP configuration. For a registered ChatGPT plugin, its technical `plugin_asdk_app…` connection ID is assigned after registration; it cannot be prefilled for another account. A public Plugins Directory listing requires submission and review. The downloadable package and direct MCP connection are separate from that listing.

A useful workflow is “describe my sensor → author and validate its IODD → export and save → compile its sensor application → verify the behavior.” Hosted snapshots survive session/runtime restarts for up to 24 hours; keep the private token and expiry, and restore into a new project. Local stdio snapshots disappear on process restart. Neither replaces a downloaded editable project for longer retention.

`iodd_firmware_source` returns LabWired compile/verify arguments; `iodd_firmware_kit` returns the same source as a ZIP. They support the released switching-sensor parameter/process contract and apply authored defaults. STM32F401 MCU execution proves application behavior against a UART oracle, not IO-Link transport, analog PHY/cable or physical-master communication. Report LabWired's actual verdict and model gaps. Source generation alone is not execution.

Hosted XSD validation uses the pinned October 2025 official schema package. Basic checks, XSD status and official Checker status are separate; the official Checker remains unavailable until an actual permitted executable is installed and run. Firmware flashing, physical wiring and official conformity require their own evidence.

Packaging and setup follow [OpenAI's plugin guide](https://developers.openai.com/plugins/build/plugins) and [MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

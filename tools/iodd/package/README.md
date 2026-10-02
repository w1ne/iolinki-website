# IODD MCP

Requires Node.js 22 or newer. This runs a local MCP server using standard input/output:

```sh
npx -y https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz
```

Configure your MCP client with command `npx` and arguments
`["-y", "https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz"]`.
The first launch downloads the package and its dependencies. No npm account or global installation is required.

Use the same package as a file-based CLI:

```sh
npx -y https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz cli --help
npx -y https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz cli create --template new --output device.iodd-project.json
```

The MCP server exposes 20 typed tools and keeps bounded projects in memory. `iodd_save`, `iodd_restore` and `iodd_delete_saved` use private recovery tokens, but local stdio snapshots report `durable:false` and disappear on process restart. Export project JSON or ZIP before restarting. The hosted endpoint supports explicit durable snapshots for up to 24 hours; anyone with its token can restore or delete a snapshot.

`iodd_firmware_source` returns arguments for the connected LabWired plugin's compile/verify tools. `iodd_firmware_kit` exports complete GPL-3.0-or-later sensor application source, generated mapping/defaults, authored IODD, license and provenance. The supported STM32F401 application witness checks threshold/hysteresis, validity, parameter readback, process bytes, teach and inversion. Generation is not execution; report the actual LabWired verdict and model gaps. This does not prove IO-Link PHY/cable, physical-master communication, retained flash, IAR or conformity. Sending source to LabWired uses that external service.

No arbitrary filesystem or shell-execution tool is exposed through MCP. CLI commands read and write files explicitly selected by the operator. Local XSD/official Checker validation uses operator configuration; hosted XSD validation uses the pinned official October 2025 package. Basic checks, schema validity and actual official Checker execution are separate. The hosted Checker is unavailable until an actual permitted executable is installed and run. IOLFW package creation does not flash or sign devices.

Original authoring tools and templates offer an additional MIT grant in `tools/iodd/LICENSE`. Preserved model and checker components and bundled fflate retain their MIT licenses; see bundled license files.

The bundled firmware implementation and witness use GPL-3.0-or-later. Its complete source and license are included in `assets/iodd/firmware-kit`; the MIT tooling grant does not change that firmware license.

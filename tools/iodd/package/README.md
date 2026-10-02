# IODD MCP

Requires Node.js 22 or newer. This runs a local MCP server using standard input/output:

```sh
npx -y https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz
```

Configure your MCP client with command `npx` and arguments
`["-y", "https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz"]`.
The first launch downloads the package and its dependencies. No npm account or global installation is required.

Use the same package as a file-based CLI:

```sh
npx -y https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz cli --help
npx -y https://iolinki.com/downloads/iodd-mcp-1.0.0.tgz cli create --template new --output device.iodd-project.json
```

The MCP server keeps bounded projects in memory and exposes no arbitrary filesystem, shell, or network tools. CLI commands read and write files explicitly selected by the operator. Validation reports distinguish local checks from an independently configured official checker. Firmware package creation does not flash or sign devices.

Original authoring tools and templates offer an additional MIT grant in `tools/iodd/LICENSE`. Preserved model and checker components and bundled fflate retain their MIT licenses; see bundled license files.

#!/usr/bin/env node
if (Number(process.versions.node.split(".")[0]) < 22) {
  process.stderr.write("IODD MCP requires Node.js 22 or newer.\n");
  process.exitCode = 1;
} else if (process.argv[2] === "cli") {
  process.argv.splice(2, 1);
  await import("../tools/iodd/cli.mjs");
} else if (process.argv.length > 2) {
  process.stderr.write("Use iodd-mcp with no arguments for MCP stdio, or iodd-mcp cli --help.\n");
  process.exitCode = 1;
} else {
  await import("../tools/iodd/mcp.mjs");
}

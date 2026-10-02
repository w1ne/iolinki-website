#!/usr/bin/env node
import "./node-runtime.mjs";
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runExternalValidation } from "./checker.mjs";
import { createIoddMcpServer } from "./mcp-factory.mjs";
const options = {
  schemaPath: process.env.IODD_SCHEMA,
  checkerPath: process.env.IODD_CHECKER,
  checkerArgs: process.env.IODD_CHECKER_ARGS
    ? JSON.parse(process.env.IODD_CHECKER_ARGS)
    : [],
};
const server = createIoddMcpServer({
  loadTemplate: (template) =>
    readFile(
      new URL(`../../assets/iodd/${template}.xml`, import.meta.url),
      "utf8",
    ),
  externalValidation: (project) => runExternalValidation(project, options),
});
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 32 * 1024 * 1024,
  }),
);

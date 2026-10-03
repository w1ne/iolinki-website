import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { profileView } from "../../assets/js/iodd/extensions.js";
import {
  createFirmwarePackage,
  inspectFirmwarePackage,
} from "../../assets/js/iodd/firmware-package.js";
import * as api from "../../assets/js/iodd/project.js";
import { importPackage, exportPackage } from "../../assets/js/iodd/package.js";
const projectId = z
  .string()
  .uuid()
  .describe("Session-local ID returned by create or import.");
const format = z.enum(["xml", "project", "package"]);
const text = z.string().max(4096);
const name = text.min(1);
const identifier = z
  .string()
  .min(1)
  .max(240)
  .describe("Existing XML ID from inspect, or a unique ID for a new object.");
function integer(min, max, description) {
  return z
    .union([
      z.number().int().min(min).max(max),
      z.string().max(20).regex(/^\d+$/),
    ])
    .refine((value) => Number(value) >= min && Number(value) <= max, {
      message: `Use an integer from ${min} to ${max}.`,
    })
    .describe(description);
}
const identityValues = z
  .object({
    vendorId: integer(
      1,
      65535,
      "Assigned vendor ID, decimal integer 1–65535.",
    ).optional(),
    deviceId: integer(
      1,
      16777215,
      "Assigned device ID, decimal integer 1–16777215.",
    ).optional(),
    vendorName: name.optional(),
    productName: name.optional(),
    productId: name.optional(),
    releaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Release date YYYY-MM-DD.")
      .optional(),
    version: z
      .string()
      .max(64)
      .regex(/^V\d+(\.\d+){1,7}$/)
      .describe("Document version such as V1.0.")
      .optional(),
  })
  .strict();
const variableFields = {
  name: name.optional(),
  index: integer(
    16,
    65535,
    "ISDU index in decimal; must be unique.",
  ).optional(),
  access: z
    .enum(["ro", "rw", "wo"])
    .describe("Read-only, read-write or write-only access.")
    .optional(),
  type: z.enum(["UIntegerT", "IntegerT", "StringT", "OctetStringT"]).optional(),
  bits: integer(
    2,
    1856,
    "Numeric types use 2–64 bits; strings use multiples of 8 up to 1856.",
  ).optional(),
  defaultValue: z
    .union([text, z.number().int().safe()])
    .describe(
      "Decimal numeric value or text/hex string for string types; empty string removes default. Use strings for 64-bit integers.",
    )
    .optional(),
  lower: z
    .union([
      z
        .string()
        .max(21)
        .regex(/^$|^-?\d+$/),
      z.number().int().safe(),
    ])
    .describe(
      "Inclusive decimal lower bound; empty string uses datatype minimum.",
    )
    .optional(),
  upper: z
    .union([
      z
        .string()
        .max(21)
        .regex(/^$|^-?\d+$/),
      z.number().int().safe(),
    ])
    .describe(
      "Inclusive decimal upper bound; empty string uses datatype maximum.",
    )
    .optional(),
};
const addVariableValues = z
  .object({ id: identifier.optional(), ...variableFields })
  .strict()
  .describe(
    "Optional overrides: defaults to a new 16-bit unsigned rw parameter with default 0 at the next free index from 256.",
  );
const editVariableValues = z
  .object(variableFields)
  .strict()
  .describe("Partial parameter update; omitted fields retain their values.");
const processFields = {
  name: name.optional(),
  type: z.enum(["UIntegerT", "IntegerT", "BooleanT"]).optional(),
  offset: integer(
    0,
    255,
    "IODD bit offset from least-significant bit 0; field must fit and not overlap.",
  ).optional(),
  bits: integer(
    1,
    64,
    "BooleanT requires 1 bit; IntegerT and UIntegerT require 2–64 bits.",
  ).optional(),
};
const addProcessValues = z
  .object(processFields)
  .strict()
  .describe(
    "New record field; defaults BooleanT, 1 bit, offset 0, New field. Supply a free offset to avoid overlap.",
  );
const editProcessValues = z
  .object(processFields)
  .strict()
  .describe("Partial record-field update; omitted fields retain values.");
const selector = z
  .union([identifier, z.array(z.number().int().min(0).max(50000)).max(128)])
  .describe("XML ID or root-relative child indexes; [] selects document root.");
const xmlContent = z
  .string()
  .max(4 * 1024 * 1024)
  .describe("Supplied XML content, no filesystem paths or URLs.");
const xmlNode = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("element"),
        name: z.string().min(1).max(128),
        attrs: z.record(z.string().max(4096)),
        children: z.array(xmlNode).max(50000),
      })
      .strict(),
    z
      .object({
        type: z.enum(["text", "comment"]),
        value: z.string().max(4 * 1024 * 1024),
      })
      .strict(),
  ]),
);
const rule = z
  .object({
    id: z.string().min(1).max(128),
    selector,
    kind: z.enum(["required", "range", "pattern"]),
    attribute: z.string().max(128).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    pattern: z.string().max(128).optional(),
    severity: z.enum(["error", "warning"]).optional(),
  })
  .strict();
const communicationValues = z
  .object({
    bitrate: z.enum(["COM1", "COM2", "COM3"]).optional(),
    minCycleTime: integer(
      0,
      132800,
      "Wired minimum cycle time in microseconds.",
    ).optional(),
    mSequenceCapability: integer(
      0,
      255,
      "Wired M-sequence capability byte.",
    ).optional(),
    sioSupported: z.boolean().optional(),
    WMinCycleTimeIn: integer(
      0,
      315000,
      "Wireless input cycle:0 or5000–315000 microseconds.",
    ).optional(),
    WMinCycleTimeOut: integer(
      0,
      315000,
      "Wireless output cycle:0 or5000–315000 microseconds.",
    ).optional(),
    maxTxPower: z.number().int().min(-20).max(10).optional(),
    defaultSlotType: z.enum(["SSLOT", "DSLOT"]).optional(),
    isABridge: z.boolean().optional(),
    isLowPowerDevice: z.boolean().optional(),
    revision: z.enum(["V1.1"]).optional(),
  })
  .strict();
const firmwareText = z
  .object({ lang: z.string().regex(/^[a-z]{2}$/), description: text })
  .strict();
const firmwareMetadata = z
  .object({
    vendorId: integer(1, 65535, "Assigned vendor ID."),
    vendorName: name.max(100),
    firmwareDescriptor: name.max(100),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    version: z
      .string()
      .max(64)
      .regex(/^V\d+(\.\d+){1,7}$/),
    copyright: text,
    fwRevision: name.max(64),
    binaryName: z.string().min(1).max(240),
    hardwareIds: z
      .array(
        z
          .object({
            idPattern: name.max(64),
            productName: text.optional(),
            productId: text.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
    descriptions: z.array(firmwareText).max(128).optional(),
    infoMessages: z.array(firmwareText).max(128).optional(),
    fwPasswordRequired: z.boolean().optional(),
    fwActivationRetryCount: integer(
      0,
      65535,
      "Activation retry count; default3.",
    ).optional(),
  })
  .strict();
const validationChecks = z
  .object(
    Object.fromEntries(
      [
        "structure",
        "references",
        "ranges",
        "processData",
        "crc",
        "assets",
        "rules",
      ].map((key) => [key, z.boolean().optional()]),
    ),
  )
  .strict()
  .describe(
    "Inspection-only check selection; exports and external checks always enforce all basic safety checks.",
  );
const operation = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("tree"),
      action: z.enum(["attributes", "text", "insert", "remove"]),
      selector,
      values: z.record(z.union([z.string().max(4096), z.null()])).optional(),
      value: z
        .string()
        .max(4 * 1024 * 1024)
        .optional(),
      node: xmlNode.optional(),
      index: z.number().int().min(0).max(50000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("importElements"),
      xml: xmlContent,
      selectors: z.array(selector).min(1).max(128),
      destination: selector.optional(),
      collision: z.enum(["rename", "error"]).optional(),
      prefix: z.string().max(128).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("communication"),
      mode: z.enum(["wired", "wireless"]),
      values: communicationValues,
    })
    .strict(),
  z
    .object({
      type: z.literal("validationRules"),
      rules: z.array(rule).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal("profile"),
      action: z.enum(["load", "apply"]),
      xml: xmlContent.optional(),
      name: text.optional(),
      id: identifier.optional(),
      profileId: z
        .union([z.string().max(128), z.number().int().min(0).max(65535)])
        .optional(),
      replacements: z
        .record(z.union([text, z.number().finite(), z.boolean()]))
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal("identity"), values: identityValues }).strict(),
  z
    .object({ type: z.literal("addVariable"), values: addVariableValues })
    .strict(),
  z
    .object({
      type: z.literal("editVariable"),
      id: identifier,
      values: editVariableValues,
    })
    .strict(),
  z.object({ type: z.literal("removeVariable"), id: identifier }).strict(),
  z
    .object({
      type: z.literal("editProcessField"),
      id: identifier,
      index: z
        .number()
        .int()
        .min(0)
        .max(254)
        .describe("Zero-based field position from inspect, not IODD subindex."),
      values: editProcessValues,
    })
    .strict(),
  z
    .object({
      type: z.literal("addProcessField"),
      id: identifier,
      values: addProcessValues,
    })
    .strict(),
  z
    .object({
      type: z.literal("removeProcessField"),
      id: identifier,
      index: z.number().int().min(0).max(254),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      language: z
        .string()
        .max(64)
        .regex(/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/),
      id: identifier,
      value: text,
    })
    .strict(),
  z
    .object({
      type: z.literal("event"),
      values: z
        .object({
          code: integer(0, 65535, "Event code in decimal."),
          type: z.enum(["Notification", "Warning", "Error"]),
          name,
          description: text.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("removeEvent"),
      code: integer(0, 65535, "Existing event code in decimal."),
    })
    .strict(),
  z
    .object({
      type: z.literal("menu"),
      values: z
        .object({
          id: identifier,
          name,
          variableIds: z.array(identifier).max(128).optional(),
          menuIds: z.array(identifier).max(128).optional(),
        })
        .strict()
        .describe(
          "At least one reference is required. Link a new menu from an existing reachable menu to display it.",
        ),
    })
    .strict(),
  z.object({ type: z.literal("removeMenu"), id: identifier }).strict(),
  z
    .object({
      type: z.literal("removeAsset"),
      name: z.string().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("asset"),
      name: z.string().min(1).max(240),
      base64: z.string().max(24 * 1024 * 1024),
    })
    .strict(),
]);
export function createIoddMcpServer({
  loadTemplate = async () => {
    throw Error("Example templates are unavailable.");
  },
  externalValidation = async () => ({
    schema: {
      status: "unavailable",
      output: "Official XSD validation is unavailable in this runtime.",
    },
    officialChecker: {
      status: "unavailable",
      output: "Official checker is unavailable in this runtime.",
    },
  }),
  publishArtifact,
  projectVault,
  firmwareKit,
  maxBytes = 64 * 1024 * 1024,
} = {}) {
  const projects = new Map();
  function get(id) {
    if (!projects.has(id))
      throw Error(
        "Unknown project ID. Create or import a project in this session first.",
      );
    return projects.get(id);
  }
  function put(project, id = crypto.randomUUID()) {
    if (!projects.has(id) && projects.size >= 32)
      throw Error(
        "Session limit is 32 projects. Close a project before importing another.",
      );
    let bytes = Buffer.byteLength(api.saveProject(project));
    for (const [key, value] of projects)
      if (key !== id) bytes += Buffer.byteLength(api.saveProject(value));
    if (bytes > maxBytes)
      throw Error(
        "Session memory limit exceeded. Close projects or reduce asset sizes.",
      );
    projects.set(id, project);
    return { projectId: id, ...api.inspectProject(project) };
  }
  function base64(source) {
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        source,
      )
    )
      throw Error("Package content must be valid base64.");
    return new Uint8Array(Buffer.from(source, "base64"));
  }
  const instructions =
    "Author IO-Link device descriptions with session-local projects. Start with iodd_create or import supplied XML; inspect before editing, validate after edits, and export downloadable artifacts. Basic checks do not certify official conformance. Vendor/device IDs must be assigned to the user. Use iodd_save for an explicit recoverable snapshot when available; keep its private token and restore in a new session. For the supported switching sensor, iodd_firmware_source supplies arguments for the LabWired compile and verify tools; record the returned verdict and model gaps. iodd_firmware_kit exports complete source. No device flashing or arbitrary filesystem/network access. Product and setup information: https://iolinki.com/llms.txt";
  const server = new McpServer(
    {
      name: "iolinki-iodd",
      version: "1.1.2",
      websiteUrl: "https://iolinki.com/iodd-mcp.html",
    },
    { instructions },
  );
  server.registerResource(
    "iodd-guide",
    "iodd://guide",
    {
      description: "IODD workflow and public setup information",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: instructions }],
    }),
  );
  server.registerPrompt(
    "author-device",
    {
      description: "Start a device-description authoring workflow",
      argsSchema: {
        device: z
          .string()
          .max(4096)
          .describe("Device purpose and known IO-Link interface details"),
      },
    },
    ({ device }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help author an IODD for: ${device}. Inspect the existing project or create one, collect assigned identity and actual parameter/process mapping, edit atomically and validate before export. Setup: https://iolinki.com/llms.txt`,
          },
        },
      ],
    }),
  );
  function tool(name, description, inputSchema, run) {
    server.registerTool(
      `iodd_${name}`,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: [
            "inspect",
            "validate",
            "export",
            "diff",
            "header",
            "tree",
            "elements_inspect",
            "elements_export",
            "profile_inspect",
            "firmware_create",
            "firmware_inspect",
            "firmware_source",
            "firmware_kit",
          ].includes(name),
          destructiveHint: ["edit", "close", "delete_saved"].includes(name),
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          let result = await run(args);
          if (
            publishArtifact &&
            ["export", "header", "firmware_create", "firmware_kit", "elements_export"].includes(
              name,
            )
          ) {
            const bytes =
              result.encoding === "base64"
                ? Buffer.from(result.content, "base64")
                : Buffer.from(result.content, "utf8");
            const filename =
              result.filename ??
              (name === "header"
                ? "iodd-mapping.h"
                : name === "firmware_create"
                  ? "firmware.iolfw"
                  : args.format === "package"
                    ? "device.zip"
                    : args.format === "project"
                      ? "device.iodd-project.json"
                      : "device.xml");
            const artifact = await publishArtifact({
              bytes,
              filename,
              mimeType:
                result.encoding === "base64"
                  ? "application/zip"
                  : "text/plain; charset=utf-8",
            });
            const { content, ...metadata } = result;
            result = { ...metadata, ...artifact };
          }
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: {
                    code: "IODD_OPERATION_FAILED",
                    message: error.message,
                    action:
                      "Correct the input and retry; the saved project was not changed.",
                  },
                }),
              },
            ],
          };
        }
      },
    );
  }
  tool(
    "create",
    "Create a new minimal device (default) or an editable example. Default vendor/device IDs are illustrative; replace with assigned IDs.",
    {
      template: z.enum(["new", "counter", "switching-sensor"]).default("new"),
      filename: z.string().max(240).optional(),
      identity: identityValues.optional(),
    },
    async ({ template, filename, identity = {} }) => {
      if (template === "new")
        return put(
          api.createNewProject(identity, filename),
        );
      let project = api.createProject(
        await loadTemplate(template),
        filename || `${template}.xml`,
      );
      if (Object.keys(identity).length)
        project = api.applyOperation(project, {
          type: "identity",
          values: identity,
        });
      if (filename === undefined) project.filename = api.suggestProjectFilename(project);
      return put(project);
    },
  );
  tool(
    "import",
    "Import supplied UTF-8 XML/project JSON or a base64 ZIP package. No file or network access.",
    {
      format,
      content: z.string().max(24 * 1024 * 1024),
      filename: z.string().optional(),
    },
    async ({ format, content, filename }) =>
      put(
        format === "xml"
          ? api.createProject(content, filename || "device.xml")
          : format === "project"
            ? api.loadProject(content)
            : await importPackage(base64(content)),
      ),
  );
  tool(
    "inspect",
    "Inspect identity, variables, process fields and assets.",
    { projectId },
    ({ projectId }) => api.inspectProject(get(projectId)),
  );
  if (firmwareKit) {
    tool("firmware_source", "Generate compile and verify arguments from a compatible switching-sensor IODD using released sensor C source. This tool does not compile, execute or prove physical IO-Link communication.", { projectId }, async ({ projectId }) => {
      const { compile, verify, scope, provenance } = await firmwareKit(get(projectId));
      return { compile, verify, scope, provenance };
    });
    tool("firmware_kit", "Export a complete GPL switching-sensor application proof kit with authored IODD, generated mapping/defaults, released C source, license, hashes and LabWired compile/verify instructions. Requires the supported parameter and process-data contract; not a complete IO-Link PHY/stack image.", { projectId }, async ({ projectId }) => {
      const { bytes, filename, scope, provenance } = await firmwareKit(get(projectId));
      return { filename, encoding: "base64", content: Buffer.from(bytes).toString("base64"), scope, provenance };
    });
  }
  if (projectVault) {
    const token = z.string().uuid().describe("Private recovery token returned by iodd_save. Anyone with this token can restore or delete the saved project.");
    tool("save", "Save a recoverable project snapshot. Hosted saves survive runtime/session restart for the reported lifetime; local saves report whether storage is durable. Keep the recovery token private.", { projectId },
      ({ projectId }) => projectVault.save(api.saveProject(get(projectId))));
    tool("restore", "Restore a saved snapshot into this session using its private recovery token. Returns a new projectId; the saved snapshot remains available until expiry or explicit deletion.", { token },
      async ({ token }) => put(api.loadProject(await projectVault.restore(token))));
    tool("delete_saved", "Permanently delete a saved snapshot using its private recovery token. Session-local projects and exported files remain available.", { token },
      async ({ token }) => ({ deleted: await projectVault.delete(token) }));
  }
  tool(
    "edit",
    "Apply one atomic edit to a session project, including replacing values or removing XML, variables or fields. Inspect IDs and values first; save or export a copy before edits that discard content.",
    { projectId, operation },
    ({ projectId, operation }) =>
      put(api.applyOperation(get(projectId), operation), projectId),
  );
  tool(
    "validate",
    "Run basic model and CRC checks. External XSD/checker results are reported separately when the operator configured them. Basic checks do not certify conformance.",
    { projectId, checks: validationChecks.optional() },
    async ({ projectId, checks }) => {
      const project = get(projectId),
        result = api.validateProject(project, { checks });
      const safe = checks ? api.validateProject(project).valid : result.valid;
      const external = safe
        ? await externalValidation(project)
        : {
            schema: {
              status: "not-run",
              output: "Resolve basic errors before external validation.",
            },
            officialChecker: {
              status: "not-run",
              output: "Resolve basic errors before external validation.",
            },
          };
      return {
        ...result, ...external,
        coverage: {
          ...result.coverage,
          xsd: ["passed", "failed"].includes(external.schema?.status),
          official: ["passed", "failed"].includes(external.officialChecker?.status),
        },
      };
    },
  );
  tool(
    "export",
    "Export XML, project JSON or ZIP. Exports enforce basic safety checks. Hosted exports return expiring download URLs; stdio ZIP exports use base64.",
    { projectId, format },
    async ({ projectId, format }) => {
      const project = get(projectId);
      const basename = project.filename.split(/[\\/]/).pop();
      const stem = basename.replace(/\.xml$/i, "");
      return {
        format,
        filename: format === "xml" ? basename : format === "package"
          ? `${stem.slice(0, 236)}.zip`
          : `${stem.slice(0, 222)}.iodd-project.json`,
        encoding: format === "package" ? "base64" : "utf8",
        content:
          format === "xml"
            ? api.exportProjectXML(project)
            : format === "project"
              ? api.saveProject(project)
              : Buffer.from(await exportPackage(project)).toString("base64"),
      };
    },
  );
  tool(
    "diff",
    "Compare two session projects.",
    { beforeId: projectId, afterId: projectId },
    ({ beforeId, afterId }) => api.diffProjects(get(beforeId), get(afterId)),
  );
  tool(
    "header",
    "Generate a C firmware header mapping parameter indexes and process field bit offsets.",
    { projectId },
    ({ projectId }) => ({
      encoding: "utf8",
      content: api.generateFirmwareHeader(get(projectId)),
    }),
  );
  tool(
    "close",
    "Delete a project and its assets from this session. Unsaved changes are discarded; separately saved snapshots and previously exported files remain available.",
    { projectId },
    ({ projectId }) => {
      get(projectId);
      projects.delete(projectId);
      return { closed: projectId };
    },
  );
  tool(
    "tree",
    "Read the complete preserving XML tree, including attrs, children, comments and text.",
    { projectId },
    ({ projectId }) => api.inspectDocumentTree(get(projectId)),
  );
  tool(
    "elements_inspect",
    "Inspect supplied reusable IODDElements/device/profile XML tree to choose selectors.",
    { xml: xmlContent },
    ({ xml }) => api.inspectElements(xml),
  );
  tool(
    "elements_export",
    "Export selected reusable elements with dependency closure as XML.",
    { projectId, selectors: z.array(selector).min(1).max(128) },
    ({ projectId, selectors }) => ({
      encoding: "utf8",
      content: api.exportElements(get(projectId), selectors),
    }),
  );
  tool(
    "profile_inspect",
    "Inspect actual profile variants and placeholders in supplied official profile-definition XML. Apply by loading then applying a profile operation.",
    { xml: xmlContent },
    ({ xml }) => profileView({ id: "ProvidedProfile", xml }),
  );
  tool(
    "firmware_create",
    "Create an IOLFW1.0 flat ZIP with continuous protocolCRC across metadata, supplied binary and resource order. This packages files; it does not sign or flash devices.",
    {
      metadata: firmwareMetadata,
      binary: z
        .string()
        .max(24 * 1024 * 1024)
        .describe("Firmware binary base64."),
      resources: z
        .array(
          z
            .object({
              id: name.max(128),
              name: name.max(240),
              base64: z.string().max(24 * 1024 * 1024),
            })
            .strict(),
        )
        .max(126)
        .optional(),
    },
    async ({ metadata, binary, resources = [] }) => {
      const bytes = await createFirmwarePackage(
        metadata,
        base64(binary),
        resources.map((r) => ({
          id: r.id,
          name: r.name,
          bytes: base64(r.base64),
        })),
      );
      const view = await inspectFirmwarePackage(bytes);
      return {
        filename: view.filename,
        encoding: "base64",
        content: Buffer.from(bytes).toString("base64"),
        metadata: view.metadata,
        validation: view.validation,
      };
    },
  );
  tool(
    "firmware_inspect",
    "Inspect supplied base64IOLFW archive metadata, file inventory, continuousCRC and informationalSHA256 fingerprints. No device compatibility or signature verification.",
    {
      content: z.string().max(24 * 1024 * 1024),
      filename: z.string().max(240).optional(),
    },
    ({ content, filename }) =>
      inspectFirmwarePackage(base64(content), filename),
  );
  return server;
}

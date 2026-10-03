const endpoint = "https://mcp.iolinki.com/mcp";
const archive = "https://iolinki.com/downloads/iodd-mcp-1.1.2.tgz";
const localServer = { command: "npx", args: ["-y", archive] };
const portableLocal = JSON.stringify(
  { mcpServers: { "iolinki-iodd": localServer } },
  null,
  2,
);
const clients = {
  chatgpt: {
    title: "Connect ChatGPT",
    instructions:
      "Enable Developer mode in Settings → Security and login. Open Plugins, select +, and add the server URL below. Availability depends on your account and workspace policy.",
    config: endpoint,
    copy: "Copy URL",
    install: "https://chatgpt.com/plugins",
    label: "Open ChatGPT Plugins",
    guide: "https://developers.openai.com/plugins/deploy/connect-chatgpt",
    localInstructions:
      "ChatGPT uses a hosted connection. For local files, use a supported desktop client below.",
    local: portableLocal,
  },
  claude: {
    title: "Connect Claude",
    instructions:
      "In Claude Code, run the command below, then use /mcp to check the connection. In Claude web or desktop, add the URL as a custom connector in Settings → Connectors.",
    config: `claude mcp add --transport http iolinki-iodd ${endpoint}`,
    copy: "Copy command",
    guide: "https://code.claude.com/docs/en/mcp",
    localInstructions:
      "Run this in Claude Code. For Claude Desktop, use the JSON configuration in its developer settings.",
    local: `claude mcp add iolinki-iodd -- npx -y ${archive}`,
  },
  codex: {
    title: "Connect Codex",
    instructions:
      "Run this command in your terminal. The connection is shared by the Codex CLI and IDE extension.",
    config: `codex mcp add iolinki-iodd --url ${endpoint}`,
    copy: "Copy command",
    guide: "https://developers.openai.com/codex/mcp",
    localInstructions: "Add the local server to Codex with this command:",
    local: `codex mcp add iolinki-iodd -- npx -y ${archive}`,
  },
  cursor: {
    title: "Connect Cursor",
    instructions:
      "Use the install button and review the configuration in Cursor. Or paste this into your MCP settings.",
    config: JSON.stringify(
      { mcpServers: { "iolinki-iodd": { url: endpoint } } },
      null,
      2,
    ),
    copy: "Copy config",
    install: `cursor://anysphere.cursor-deeplink/mcp/install?name=iolinki-iodd&config=${encodeURIComponent(btoa(JSON.stringify({ "iolinki-iodd": { url: endpoint } })))}`,
    label: "Install in Cursor",
    guide: "https://prod.cursor.com/docs/mcp/install-links",
    localInstructions: "Paste this in Cursor MCP settings:",
    local: portableLocal,
  },
  vscode: {
    title: "Connect VS Code",
    instructions:
      "Run “MCP: Add Server” from the Command Palette and choose HTTP, then paste the server URL. Or use this .vscode/mcp.json configuration.",
    config: JSON.stringify(
      { servers: { "iolinki-iodd": { type: "http", url: endpoint } } },
      null,
      2,
    ),
    copy: "Copy config",
    guide: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
    localInstructions:
      "Use this .vscode/mcp.json configuration for the local server:",
    local: JSON.stringify(
      { servers: { "iolinki-iodd": { type: "stdio", ...localServer } } },
      null,
      2,
    ),
  },
};
const find = (id) => document.getElementById(id);
function selectClient(name) {
  const client = clients[name];
  document
    .querySelectorAll("[data-client]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.client === name),
      ),
    );
  find("client-title").textContent = client.title;
  find("client-instructions").textContent = client.instructions;
  find("client-config").textContent = client.config;
  document.querySelector('[data-copy="client-config"]').textContent =
    client.copy;
  find("client-guide").href = client.guide;
  find("client-install").hidden = !client.install;
  if (client.install) {
    find("client-install").href = client.install;
    find("client-install").textContent = client.label;
  }
  find("local-instructions").textContent = client.localInstructions;
  find("local-config").textContent = client.local;
  find("copy-status").textContent = "";
}
document
  .querySelectorAll("[data-client]")
  .forEach((button) =>
    button.addEventListener("click", () => selectClient(button.dataset.client)),
  );
document.querySelectorAll("[data-copy]").forEach((button) =>
  button.addEventListener("click", async () => {
    const content = find(button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(content);
      find("copy-status").textContent =
        "Copied. Paste it into your assistant or configuration.";
    } catch {
      find("copy-status").textContent =
        "Select and copy the text above; clipboard access is unavailable in this browser.";
    }
  }),
);
selectClient("chatgpt");

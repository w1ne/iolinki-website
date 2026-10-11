// Where the studio's AI assistant lives. Keep googleClientId equal to GOOGLE_CLIENT_ID in
// agent-worker/wrangler.jsonc (a test checks this). The client ID is public, not a secret.
window.IOLINKI_AGENT = {
  api: "https://iolinki-studio-agent.shylenkoa.workers.dev",
  googleClientId: "",
};

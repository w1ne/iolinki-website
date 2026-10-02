import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = process.env.SITE_URL ? null : createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(root, `.${pathname}`);
    assert.ok(path.startsWith(root));
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.SITE_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
await mkdir(resolve(root, 'artifacts/iodd-setup'), { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copied = value; } } });
    });
    assert.equal((await page.goto(`${origin}/iodd-mcp.html`, { timeout: 60000 })).status(), 200);
    for (const client of ['chatgpt', 'claude', 'codex', 'cursor', 'vscode']) {
      await page.locator(`[data-client="${client}"]`).click();
      assert.equal(await page.locator(`[data-client="${client}"]`).getAttribute('aria-pressed'), 'true');
      const config = await page.locator('#client-config').textContent();
      assert.ok(config.includes('https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp'));
      await page.locator('[data-copy="client-config"]').click();
      assert.equal(await page.evaluate(() => window.copied), config);
      if (client === 'cursor') {
        assert.equal(JSON.parse(config).mcpServers['iolinki-iodd'].url, 'https://iolinki-iodd-mcp.shylenkoa.workers.dev/mcp');
        const link = new URL(await page.locator('#client-install').getAttribute('href'));
        const install = JSON.parse(Buffer.from(link.searchParams.get('config'), 'base64').toString());
        assert.equal(install['iolinki-iodd'].url, JSON.parse(config).mcpServers['iolinki-iodd'].url);
      }
      if (client === 'vscode') assert.equal(JSON.parse(config).servers['iolinki-iodd'].type, 'http');
      if (client === 'chatgpt') assert.equal(await page.locator('#client-install').getAttribute('href'), 'https://chatgpt.com/plugins');
      if (!await page.locator('.local-setup').evaluate(element => element.open)) await page.locator('.local-setup summary').click();
      const local = await page.locator('#local-config').textContent();
      assert.ok(local.includes('https://iolinki.com/downloads/iodd-mcp-1.1.0.tgz'));
      if (['chatgpt', 'cursor'].includes(client)) assert.equal(JSON.parse(local).mcpServers['iolinki-iodd'].command, 'npx');
      if (client === 'vscode') assert.equal(JSON.parse(local).servers['iolinki-iodd'].type, 'stdio');
      await page.locator('[data-copy="local-config"]').click();
      assert.equal(await page.evaluate(() => window.copied), local);
      const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(size.content <= size.width + 1, `${client} ${width}: overflow ${size.content}`);
    }
    await page.locator('[data-copy="example-prompt"]').click();
    assert.match(await page.evaluate(() => window.copied), /switching-sensor IODD/);
    await page.locator('[data-client="chatgpt"]').click();
    await page.locator('.local-setup summary').click();
    await page.screenshot({ path: resolve(root, `artifacts/iodd-setup/${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS MCP setup ${width}: five clients, copy, valid configs, install link, layout`);
    await page.close();
  }
} finally { await browser.close(); if (server) server.close(); }

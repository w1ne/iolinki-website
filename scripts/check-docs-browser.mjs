import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = process.env.SITE_URL ? null : createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!path.startsWith(root + '/')) throw new Error('Invalid path');
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.SITE_URL || `http://127.0.0.1:${server.address().port}`;
const artifactDir = resolve(root, 'artifacts/docs-browser');
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
const routes = ['docs/', 'docs/device/v2.1.0/', 'docs/device/v2.1.0/api/',
  'docs/device/v2.1.0/examples/stm32g0/', 'docs/device/v2.1.0/iodd/',
  'docs/device/v2.1.0/simulation/', 'docs/master/v1.0.0/', 'docs/master/v1.0.0/api/'];
let checked = 0;
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(10000);
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).origin === new URL(origin).origin)
        failures.push(`${response.status()} ${response.url()}`);
    });
    for (const route of routes) {
      const response = await page.goto(`${origin}/${route}`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, route);
      assert.equal(await page.locator('article h1').count(), 1, `${width} ${route}: rendered heading`);
      assert.ok((await page.locator('article').innerText()).length > 500, `${route}: actual content rendered`);
      const sizes = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(sizes.content <= sizes.width + 1, `${width} ${route}: overflow ${sizes.content}`);
      assert.deepEqual(failures, [], `${width} ${route}: browser errors`);
      checked++;
    }
    await page.goto(`${origin}/docs/`, { waitUntil: 'networkidle' });
    if (width < 1220) {
      await page.locator('.md-header label[for="__drawer"]').click();
      await page.locator('#__nav_2_label').click();
      await page.locator('.md-sidebar--primary a[href="device/v2.1.0/"]').click();
      await page.waitForURL('**/docs/device/v2.1.0/');
    }
    const search = page.locator('input[data-md-component="search-query"]');
    const searchToggle = page.locator('.md-header__button[for="__search"]');
    if (await searchToggle.isVisible()) await searchToggle.click();
    else await search.click();
    // Material updates its search query on keyup; emulate actual typing.
    await search.pressSequentially('TIOL112');
    await page.locator('.md-search-result__link').first().waitFor({ state: 'visible' });
    assert.ok((await page.locator('.md-search-result').innerText()).includes('TIOL112'), 'search finds transceiver guides');
    await page.keyboard.press('Escape');
    await page.goto(`${origin}/docs/device/v2.1.0/examples/stm32g0/`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: resolve(artifactDir, `stm32g0-${width}.png`), fullPage: true });
    await page.close();
  }
  console.log(`Checked ${checked} docs pages; desktop/mobile navigation and local search work`);
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = process.env.SITE_URL ? null : createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!path.startsWith(root)) throw new Error('Invalid path');
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.SITE_URL || `http://127.0.0.1:${server.address().port}`;
const artifactDir = resolve(root, 'artifacts/browser');
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
const routes = ['', 'getting-started.html', 'hardware.html', 'validation.html', 'faq.html', 'purchase.html', 'purchase-success.html', 'purchase-cancelled.html', 'terms/purchase-terms.html', 'legal.html', 'iodd-mcp.html'];
let checked = 0;
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(10000);
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).origin === new URL(origin).origin) failures.push(`${response.status()} ${response.url()}`);
    });
    for (const route of routes) {
      const label = `${width}px /${route}`;
      const response = await page.goto(`${origin.replace(/\/$/, '')}/${route}`, { waitUntil: 'networkidle', timeout: 60000 });
      assert.equal(response.status(), 200, label);
      await page.getByRole('link', { name: 'Skip to content', exact: true }).waitFor({ state: 'attached' });
      await page.locator('.site-header').getByRole('link', { name: 'iolinki home', exact: true }).waitFor();
      assert.equal(await page.locator('h1').count(), 1, `${label}: one main heading`);
      const sizes = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(sizes.content <= sizes.width + 1, `${label}: horizontal page overflow ${sizes.content}`);
      if (width <= 390) {
        const menu = page.getByRole('button', { name: 'Menu', exact: true });
        await menu.click();
        assert.equal(await menu.getAttribute('aria-expanded'), 'true', `${label}: menu opens`);
        await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Licensing', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await menu.getAttribute('aria-expanded'), 'false', `${label}: Escape closes menu`);
        assert.equal(await menu.evaluate(button => document.activeElement === button), true, `${label}: Escape returns focus`);
        await menu.click();
        await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Guides', exact: true }).click();
        await page.waitForURL('**/getting-started.html');
        await page.goto(`${origin.replace(/\/$/, '')}/${route}`, { waitUntil: 'networkidle' });
      }
      if (route === 'faq.html') {
        const details = page.locator('details').first();
        await details.locator('summary').click();
        assert.equal(await details.getAttribute('open'), '', `${label}: FAQ opens`);
      }
      if (route === 'purchase.html') {
        assert.equal(await page.locator('#purchase-button').isDisabled(), true, `${label}: checkout remains disabled`);
        assert.equal(await page.locator('meta[name="checkout-api"]').getAttribute('content'), '', `${label}: no live checkout configured`);
        await page.locator('label[for="tier-team"]').click();
        assert.equal(await page.locator('#tier-team').isChecked(), true, `${label}: license selector works`);

        assert.equal(await page.locator('#holder-kind').count(), 0, label + ': no obsolete business holder selector');
        assert.equal(await page.locator('#company-contact').isVisible(), true, label + ': Company contact is visible');
        assert.equal(await page.locator('#company-contact').getAttribute('required'), '', label + ': Company contact is required');
        await page.locator('label[for="tier-single"]').click();
        assert.equal(await page.locator('#company-contact').isVisible(), false, label + ': Indie contact is hidden');
        assert.equal(await page.locator('#company-contact').getAttribute('required'), null, label + ': Indie has no contact requirement');
        assert.match(await page.locator('#holder-label').textContent(), /individual/);
        assert.equal(await page.locator('#product-family').getAttribute('required'), '', label + ': agreed family is required');
        assert.equal(await page.locator('#quote-reference').getAttribute('required'), '', label + ': approved quote is required');

      }
      if (!route || route === 'purchase.html' || route === 'hardware.html') await page.screenshot({ path: resolve(artifactDir, `${width}-${route || 'home'}.png`), fullPage: true });
      assert.deepEqual(failures, [], `${label}: browser/asset errors`);
      checked++;
      console.log(`PASS ${label}`);
    }
    await page.close();
  }
  const noScript = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
  await noScript.goto(`${origin.replace(/\/$/, '')}/`, { waitUntil: 'networkidle' });
  await noScript.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Guides', exact: true }).waitFor();
  await noScript.getByRole('heading', { level: 1 }).waitFor();
  console.log(`Verified ${checked} page/viewports and mobile navigation without JavaScript on ${origin}`);
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}

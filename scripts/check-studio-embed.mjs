// Studio embed mode (?embed=1): one station inside another page, and the blog
// posts that load it on click.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const engine = require('../studio/engine.js');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.pdf': 'application/pdf', '.csv': 'text/csv' };
const server = createServer(async (request, response) => {
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
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

// A small station: one conveyor, one master, one optical sensor on X1.
const station = engine.newStation();
const library = { sensors: [require('../studio/library/sensors/ifm-o5d100.json')], masters: [require('../studio/library/sensors/ifm-al1100.json')], equipment: require('../studio/library/equipment.json') };
engine.addItem(station, library, 'conveyor', [0, 0]);
engine.addItem(station, library, 'ifm-al1100', [-1.6, -2.4]);
engine.addItem(station, library, 'ifm-o5d100', [0, -1.4]);
const hash = engine.encodeStation(station).split('#')[1];

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const width of [1024, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 640 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/studio/?embed=1#${hash}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => view.station.items.length === 3);
    const label = `${width}px embed`;
    for (const selector of ['.topbar', '.library', '.inspector']) {
      assert.equal(await page.locator(selector).isVisible(), false, `${label}: ${selector} hidden`);
    }
    assert.equal(await page.locator('#scene canvas').isVisible(), true, `${label}: 3D view shown`);
    const open = await page.locator('#open-full').getAttribute('href');
    assert.equal(open, `/studio/#${hash}`, `${label}: Open in the studio keeps the station and drops embed`);
    assert.equal(await page.locator('#open-full').getAttribute('target'), '_blank');
    // Read only: Delete and undo do nothing, a click on a part does not move it.
    const before = await page.evaluate(() => JSON.stringify(view.station));
    await page.evaluate(() => { view.selected = 'sensor1'; });
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    const box = await page.locator('#scene canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => JSON.stringify(view.station)), before, `${label}: station is read only`);
    // Plain wheel scrolls the host page; only Ctrl+wheel zooms.
    const radius = () => page.evaluate(() => document.querySelector('#scene').s3d.orbit.radius);
    const r0 = await radius();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    assert.equal(await radius(), r0, `${label}: plain wheel does not zoom`);
    // Run, then the Ports tab shows the live port.
    await page.locator('#run').click();
    await page.waitForFunction(() => /^Stop/.test(document.querySelector('#run-label').textContent));
    await page.locator('.tabs button[data-view="ports"]').click();
    await page.locator('#ports table').waitFor();
    assert.match(await page.locator('#ports table').textContent(), /O5D100/, `${label}: ports table`);
    assert.deepEqual(errors, [], `${label}: page errors`);
    console.log(`PASS ${label}`);
    await page.close();
  }
  // The full studio is unchanged: library and inspector visible, wheel zooms.
  const full = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await full.goto(`${origin}/studio/#${hash}`, { waitUntil: 'networkidle' });
  await full.waitForFunction(() => view.station.items.length === 3);
  assert.equal(await full.locator('.library').isVisible(), true, 'full studio: library shown');
  assert.equal(await full.locator('#open-full').count(), 0, 'full studio: no embed link');
  console.log('PASS full studio without embed');
  await full.close();
  // Blog posts: the poster turns into the embedded studio on click.
  const post = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await post.goto(`${origin}/blog/box-detection-on-conveyor.html`, { waitUntil: 'networkidle' });
  const embed = post.locator('[data-station-embed]');
  assert.equal(await embed.locator('img').isVisible(), true, 'blog: poster image shown');
  await embed.locator('button').click();
  const frame = embed.locator('iframe');
  await frame.waitFor();
  assert.match(await frame.getAttribute('src'), /^\/studio\/\?embed=1#s=/, 'blog: iframe loads the embed');
  await post.frameLocator('[data-station-embed] iframe').locator('#scene canvas').waitFor();
  console.log('PASS blog poster loads the embedded station');
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../", import.meta.url));
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".xml": "application/xml",
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      "." + new URL(req.url, "http://localhost").pathname,
    );
    if (!path.startsWith(root)) throw Error();
    const data = await readFile(path);
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || undefined,
  args: ["--no-sandbox"],
});
const artifacts = resolve(root, "artifacts/iodd-editor");
await mkdir(artifacts, { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    const writes = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() !== "GET") writes.push(r.url());
    });
    await page.goto(origin + "/iodd-editor.html");
    await page
      .getByRole("button", { name: "Switching sensor", exact: true })
      .click();
    await page
      .getByLabel("Vendor name", { exact: true })
      .fill("Example Instruments");
    await page
      .getByLabel("English device name", { exact: true })
      .fill("Edited sensor");
    await page
      .getByRole("button", { name: "Apply identity", exact: true })
      .click();
    await page.getByLabel("Index", { exact: true }).first().fill("300");
    await page
      .locator("[data-variable]")
      .first()
      .getByRole("button", { name: "Apply parameter", exact: true })
      .click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download IODD", exact: true })
      .click();
    const download = await downloadPromise;
    const file = resolve(artifacts, `sensor-${width}.xml`);
    await download.saveAs(file);
    const text = await readFile(file, "utf8");
    assert.match(text, /vendorName="Example Instruments"/);
    assert.match(text, /index="300"/);
    assert.match(text, /value="Edited sensor"/);
    await page.locator("#xml-panel").evaluate((node) => {
      node.open = true;
    });
    const pending = (await page.locator("#xml-source").inputValue()).replace(
      "Edited sensor",
      "Pending XML name",
    );
    await page.locator("#xml-source").fill(pending);
    await page
      .getByRole("button", { name: "Apply identity", exact: true })
      .click();
    assert.equal(await page.locator("#xml-source").inputValue(), pending);
    assert.ok(
      await page
        .getByRole("button", { name: "Download IODD", exact: true })
        .isDisabled(),
    );
    await page.getByRole("button", { name: "Apply XML", exact: true }).click();
    await page
      .getByRole("button", { name: "Counter / button / LED", exact: true })
      .click();
    const counterDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download IODD", exact: true })
      .click();
    await (
      await counterDownloadPromise
    ).saveAs(resolve(artifacts, `counter-${width}.xml`));
    await page
      .locator("#import-file")
      .setInputFiles(resolve(root, "assets/iodd/switching-sensor.xml"));
    await page
      .getByRole("status")
      .filter({ hasText: "XML opened locally" })
      .waitFor();
    assert.equal(
      await page.getByLabel("Index", { exact: true }).first().inputValue(),
      "256",
    );
    const rawBefore = await page.locator("#xml-source").inputValue();
    await page
      .locator("#import-file")
      .setInputFiles({
        name: "bad.xml",
        mimeType: "application/xml",
        buffer: Buffer.from(
          '<?xml version="1.0" encoding="ISO-8859-1"?><IODevice/>',
        ),
      });
    await page
      .getByRole("status")
      .filter({ hasText: "Import UTF-8 XML" })
      .waitFor();
    assert.equal(await page.locator("#xml-source").inputValue(), rawBefore);
    const result = await page.evaluate(async () => {
      const api = await import("/assets/js/iodd/document.js");
      const source = await (
        await fetch("/assets/iodd/switching-sensor.xml")
      ).text();
      const doc = api.importXML(source);
      const exported = api.exportXML(doc);
      const imported = api.importXML(exported);
      const issues = api.validateDocument(imported);
      const bad = api.importXML(exported.replace('index="256"', 'index="257"'));
      let dtdRejected = false,
        syntaxRejected = false;
      try {
        api.importXML("<!DOCTYPE IODevice><IODevice/>");
      } catch {
        dtdRejected = true;
      }
      try {
        api.importXML('<IODevice broken="a&bad"/>');
      } catch {
        syntaxRejected = true;
      }
      const modified = source.replace(
        "<ExternalTextCollection>",
        '<EventCollection xmlns="urn:custom"><Unknown x="keep" /></EventCollection><ExternalTextCollection>',
      );
      const preserved = api.importXML(modified);
      api.editIdentity(preserved, { vendorName: "Changed" });
      function rejected(source) {
        try {
          api.importXML(source);
          return false;
        } catch {
          return true;
        }
      }
      const padded = api.importXML(
        source.replace('index="257"', 'index="0256"'),
      );
      const dangling = api.importXML(
        source.replace('textId="T_DeviceName"', 'textId="T_Missing"'),
      );
      const overlap = api.importXML(
        source.replace('bitOffset="1"', 'bitOffset="8"'),
      );
      const range = api.importXML(
        source.replace('defaultValue="5000"', 'defaultValue="70000"'),
      );
      const sharedSource = source
        .replace(
          "<VariableCollection>",
          '<DatatypeCollection><Datatype id="D_Unknown" xsi:type="Float32T"/></DatatypeCollection><VariableCollection>',
        )
        .replace(
          '<Datatype xsi:type="UIntegerT" bitLength="16">',
          '<DatatypeRef datatypeId="D_Unknown"/><!--',
        )
        .replace("</Datatype>", "--><!-- shared datatype retained -->");
      const shared = api.importXML(sharedSource);
      const sharedReadonly = !api.getVariables(shared)[0].editable;
      api.editIdentity(shared, { vendorName: "Keep unknown types" });
      return {
        errors: issues.filter((i) => i.severity === "error"),
        duplicates: api
          .validateDocument(bad)
          .some((i) => i.message.includes("Duplicate variable index")),
        dtdRejected,
        syntaxRejected,
        preserved: api.exportXML(preserved).includes('Unknown x="keep"'),
        paddedDuplicate: api
          .validateDocument(padded)
          .some((i) => i.message.includes("Duplicate variable index")),
        dangling: api
          .validateDocument(dangling)
          .some((i) => i.message.includes("Unresolved textId")),
        overlap: api
          .validateDocument(overlap)
          .some((i) => i.message.includes("overlap")),
        range: api
          .validateDocument(range)
          .some((i) => i.message.includes("outside")),
        nonUTF8: rejected(
          source.replace(/encoding=['"]utf-8['"]/i, 'encoding="ISO-8859-1"'),
        ),
        preservedSpace: rejected(
          source.replace(
            "<ExternalTextCollection>",
            '<Ext xmlns="urn:custom" xml:space="preserve">   </Ext><ExternalTextCollection>',
          ),
        ),
        mixedContent: rejected(
          source.replace(
            "<ExternalTextCollection>",
            '<Ext xmlns="urn:custom">before<Child/>after</Ext><ExternalTextCollection>',
          ),
        ),
        sharedReadonly,
        sharedPreserved: api.exportXML(shared).includes('xsi:type="Float32T"'),
      };
    });
    assert.deepEqual(result, {
      errors: [],
      duplicates: true,
      dtdRejected: true,
      syntaxRejected: true,
      preserved: true,
      paddedDuplicate: true,
      dangling: true,
      overlap: true,
      range: true,
      nonUTF8: true,
      preservedSpace: true,
      mixedContent: true,
      sharedReadonly: true,
      sharedPreserved: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: resolve(artifacts, `${width}.png`),
      fullPage: true,
    });
    await page.close();
    console.log(
      `PASS ${width}px: edits, export, preservation, validation, no uploads`,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

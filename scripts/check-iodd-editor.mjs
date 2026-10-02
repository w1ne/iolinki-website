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
const server = process.env.SITE_URL
  ? null
  : createServer(async (req, res) => {
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
if (server) await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin =
  process.env.SITE_URL || `http://127.0.0.1:${server.address().port}`;
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
    if (width === 1440) {
      let receive;
      const counterURL = "**/assets/iodd/counter.xml";
      await page.route(counterURL, (route) => receive(route));
      async function delayedCounter() {
        const request = new Promise((resolve) => {
          receive = resolve;
        });
        await page
          .getByRole("button", { name: "Counter / button / LED", exact: true })
          .click();
        return request;
      }
      async function completeTemplate(route, status = 200) {
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/assets/iodd/counter.xml"),
        );
        await route.fulfill({
          status,
          contentType: "application/xml",
          body:
            status === 200
              ? await readFile(resolve(root, "assets/iodd/counter.xml"), "utf8")
              : "Unavailable",
        });
        await (await response).finished();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
      }
      await page
        .getByRole("button", { name: "New device", exact: true })
        .click();
      const delayed = await delayedCounter();
      assert.equal(
        await page
          .getByRole("button", { name: "Download IODD", exact: true })
          .isDisabled(),
        true,
        "Downloads are disabled while a template is loading",
      );
      assert.equal(
        await page.locator("#workspace").evaluate((node) => node.inert),
        true,
        "Workspace edits are blocked during template loading",
      );
      await page
        .locator("#import-file")
        .setInputFiles(resolve(root, "assets/iodd/switching-sensor.xml"));
      await page
        .locator("#status")
        .getByText(/XML opened locally/)
        .waitFor();
      await completeTemplate(delayed);
      assert.equal(
        await page.locator("#project-title").textContent(),
        "Switching sensor",
        "Late template must not replace an imported project",
      );
      assert.match(
        await page.locator("#status").textContent(),
        /XML opened locally/,
      );
      assert.equal(
        await page.locator("#workspace").evaluate((node) => node.inert),
        false,
      );
      const staleFailure = await delayedCounter();
      await page
        .getByRole("button", { name: "New device", exact: true })
        .click();
      await completeTemplate(staleFailure, 500);
      assert.equal(
        await page.locator("#project-title").textContent(),
        "New device",
        "New device supersedes a pending template",
      );
      assert.match(
        await page.locator("#status").textContent(),
        /New device created/,
      );
      const currentFailure = await delayedCounter();
      await completeTemplate(currentFailure, 500);
      assert.equal(
        await page.locator("#workspace").evaluate((node) => node.inert),
        false,
        "Current failures unlock editing",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Download IODD", exact: true })
          .isDisabled(),
        false,
      );
      assert.match(
        await page.locator("#status").textContent(),
        /could not be loaded/,
      );
      const olderRequest = await delayedCounter();
      const newerRequest = await delayedCounter();
      await completeTemplate(olderRequest, 500);
      assert.equal(
        await page.locator("#workspace").evaluate((node) => node.inert),
        true,
        "Stale failure must not unlock the newer pending request",
      );
      assert.match(
        await page.locator("#status").textContent(),
        /Loading example/,
      );
      await completeTemplate(newerRequest);
      assert.equal(
        await page.locator("#project-title").textContent(),
        "Counter button LED",
      );
      assert.equal(
        await page.locator("#workspace").evaluate((node) => node.inert),
        false,
      );
      await page.unroute(counterURL);
    }
    await page.getByRole("button", { name: "New device", exact: true }).click();
    await page
      .locator("#status")
      .getByText(/New device created/)
      .waitFor();
    assert.equal(await page.locator("#parameter-rows tr").count(), 0);
    assert.equal(await page.locator(".bit-cell").count(), 0);
    await page
      .getByLabel("Vendor name", { exact: true })
      .fill("From-scratch manufacturer");
    await page
      .getByLabel("English device name", { exact: true })
      .fill("From-scratch device");
    await page
      .getByRole("button", { name: "Apply identity", exact: true })
      .click();
    const newDeviceDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download IODD", exact: true })
      .click();
    await (
      await newDeviceDownload
    ).saveAs(resolve(artifacts, `new-device-${width}.xml`));
    await page
      .getByRole("button", { name: "Switching sensor", exact: true })
      .click();
    await page
      .locator("#status")
      .getByText(/Example loaded/)
      .waitFor();
    await page
      .getByLabel("Vendor name", { exact: true })
      .fill("Example Instruments");
    await page
      .getByLabel("English device name", { exact: true })
      .fill("Edited sensor");
    await page
      .getByRole("button", { name: "Apply identity", exact: true })
      .click();
    await page.getByRole("tab", { name: "Parameters", exact: true }).click();
    await page
      .getByRole("tab", { name: "Parameters", exact: true })
      .press("ArrowRight");
    await assert.equal(
      await page
        .getByRole("tab", { name: "Process data", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page
      .getByRole("tab", { name: "Process data", exact: true })
      .press("Home");
    await assert.equal(
      await page
        .getByRole("tab", { name: "Identity", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.getByRole("tab", { name: "Identity", exact: true }).press("End");
    await assert.equal(
      await page
        .getByRole("tab", { name: "XML", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.getByRole("tab", { name: "Parameters", exact: true }).click();
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
    const projectPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const projectFile = resolve(artifacts, `project-${width}.json`);
    await (await projectPromise).saveAs(projectFile);
    await page.locator("#import-file").setInputFiles(projectFile);
    await page
      .getByRole("status")
      .filter({ hasText: "Project opened" })
      .waitFor();
    await page.getByRole("tab", { name: "XML", exact: true }).click();
    const pending = (await page.locator("#xml-source").inputValue()).replace(
      "Edited sensor",
      "Pending XML name",
    );
    await page.locator("#xml-source").fill(pending);
    await page.getByRole("tab", { name: "Identity", exact: true }).click();
    await page
      .getByRole("button", { name: "Apply identity", exact: true })
      .click();
    assert.equal(await page.locator("#xml-source").inputValue(), pending);
    assert.ok(
      await page
        .getByRole("button", { name: "Download IODD", exact: true })
        .isDisabled(),
    );
    await page.getByRole("tab", { name: "XML", exact: true }).click();
    await page.getByRole("button", { name: "Apply XML", exact: true }).click();
    await page
      .getByRole("button", { name: "Counter / button / LED", exact: true })
      .click();
    await page
      .locator("#status")
      .getByText(/Example loaded/)
      .waitFor();
    await page.waitForFunction(() =>
      document.getElementById("xml-source").value.includes('deviceId="5678"'),
    );
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
    await page.getByRole("tab", { name: "Parameters", exact: true }).click();
    assert.equal(
      await page.getByLabel("Index", { exact: true }).first().inputValue(),
      "256",
    );
    const rawBefore = await page.locator("#xml-source").inputValue();
    await page.locator("#import-file").setInputFiles({
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
    await page.getByLabel("Search parameters").fill("hysteresis");
    assert.equal(await page.locator("#parameter-rows tr").count(), 1);
    await page.getByLabel("Search parameters").fill("");
    await page.getByRole("tab", { name: "Process data", exact: true }).click();
    assert.equal(await page.locator(".bit-cell").count(), 24);
    await page
      .getByRole("button", { name: "+ Add field", exact: true })
      .click();
    await page
      .getByLabel("Field name", { exact: true })
      .fill("Diagnostics flag");
    await page.getByRole("button", { name: "Add field", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Process field added" })
      .waitFor();
    await page
      .getByRole("button", { name: "Remove field", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Process field removed" })
      .waitFor();
    await page
      .getByRole("tab", { name: "Texts & languages", exact: true })
      .click();
    await page.getByLabel("Language code", { exact: true }).fill("fr");
    await page.getByLabel("Text ID", { exact: true }).fill("T_DeviceName");
    await page
      .getByLabel("Text value", { exact: true })
      .fill("Capteur de commutation");
    await page.getByRole("button", { name: "Save text", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Text saved" }).waitFor();
    await page
      .getByRole("tab", { name: "Events & menus", exact: true })
      .click();
    await page.getByLabel("Event code", { exact: true }).fill("36000");
    await page
      .getByLabel("Event name", { exact: true })
      .fill("Measurement ready");
    await page
      .getByLabel("Event description", { exact: true })
      .fill("A valid measurement is available.");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Event saved" }).waitFor();
    await page.getByLabel("Menu ID", { exact: true }).fill("M_Service");
    await page.getByLabel("Menu name", { exact: true }).fill("Service");
    await page.getByLabel("Variable IDs", { exact: true }).fill("V_SP1");
    await page.getByRole("button", { name: "Save menu", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Menu saved" }).waitFor();
    await page
      .getByRole("tab", { name: "Files & changes", exact: true })
      .click();
    await page.locator("#asset-file").setInputFiles({
      name: "device-logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJz8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByRole("status").filter({ hasText: "Files added" }).waitFor();
    await page.getByLabel("Export format").selectOption("zip");
    const zipPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download IODD", exact: true })
      .click();
    const zipFile = resolve(artifacts, `package-${width}.zip`);
    await (await zipPromise).saveAs(zipFile);
    await page.locator("#import-file").setInputFiles(zipFile);
    await page
      .getByRole("status")
      .filter({ hasText: "ZIP package opened" })
      .waitFor();
    await page
      .getByRole("tab", { name: "Files & changes", exact: true })
      .click();
    assert.match(
      await page.locator("#asset-list").textContent(),
      /device-logo.png/,
    );
    await page.locator("#compare-file").setInputFiles(projectFile);
    await page
      .getByRole("status")
      .filter({ hasText: "Saved revision compared" })
      .waitFor();
    assert.ok((await page.locator("#comparison-result li").count()) > 0);
    await page.getByLabel("Export format").selectOption("header");
    const headerPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download IODD", exact: true })
      .click();
    const headerFile = resolve(artifacts, `mapping-${width}.h`);
    await (await headerPromise).saveAs(headerFile);
    assert.match(
      await readFile(headerFile, "utf8"),
      /#define IODD_V_SP1_INDEX 256u/,
    );
    await page.getByRole("tab", { name: "Document tree", exact: true }).click();
    await page
      .getByRole("button", { name: "DeviceIdentity", exact: true })
      .click();
    await page
      .locator("#node-editor")
      .getByLabel("vendorName", { exact: true })
      .fill("Tree-edited manufacturer");
    await page
      .getByRole("button", { name: "Apply element attributes", exact: true })
      .click();
    await assert.equal(
      await page.getByLabel("Vendor name", { exact: true }).inputValue(),
      "Tree-edited manufacturer",
    );
    await page
      .locator("#document-tree")
      .getByRole("button", { name: "Text · T_DeviceName", exact: true })
      .first()
      .click();
    await page
      .getByRole("tab", { name: "Element library", exact: true })
      .click();
    const snippetDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export selected element", exact: true })
      .click();
    const snippetPath = resolve(artifacts, `elements-${width}.xml`);
    await (await snippetDownload).saveAs(snippetPath);
    await page.getByRole("tab", { name: "Document tree", exact: true }).click();
    await page
      .locator("#document-tree")
      .getByRole("button", { name: "PrimaryLanguage", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Element library", exact: true })
      .click();
    await page.locator("#snippet-file").setInputFiles(snippetPath);
    await page.getByText("Choose source element", { exact: true }).waitFor();
    await page
      .locator("#snippet-preview")
      .getByRole("button", { name: "Text · T_DeviceName", exact: true })
      .first()
      .click();
    await page
      .locator("#status")
      .getByText(/Element imported/)
      .waitFor();
    await page.getByRole("tab", { name: "Communication", exact: true }).click();
    await page
      .getByLabel("Communication mode", { exact: true })
      .selectOption("wired");
    await page.getByLabel("minCycleTime", { exact: true }).fill("1000");
    await page
      .getByRole("button", { name: "Apply communication", exact: true })
      .click();
    await page.getByRole("tab", { name: "Validation", exact: true }).click();
    await page.getByLabel("CRC", { exact: true }).uncheck();
    await page.getByLabel("CRC", { exact: true }).check();
    await page.getByLabel("Rule ID", { exact: true }).fill("Threshold present");
    await page.getByLabel("Element ID or path", { exact: true }).fill("V_SP1");
    await page
      .getByLabel("Rule kind", { exact: true })
      .selectOption("required");
    await page.getByLabel("Attribute to check", { exact: true }).fill("index");
    await page
      .getByRole("button", { name: "Save validation rule", exact: true })
      .click();
    await page
      .locator(".rules-list")
      .getByText(/Threshold present/)
      .waitFor();
    await page
      .getByRole("tab", { name: "Firmware package", exact: true })
      .click();
    await page.locator("#firmware-binary").setInputFiles({
      name: "firmware.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0, 1, 2, 3, 128, 255]),
    });
    await page.locator("#firmware-resources").setInputFiles({
      name: "release-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Example firmware release"),
    });
    const firmwareDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Create firmware package", exact: true })
      .click();
    await (
      await firmwareDownload
    ).saveAs(resolve(artifacts, `firmware-${width}.iolfw`));
    await page
      .locator("#firmware-result")
      .getByText(/Package CRC verified/)
      .waitFor();
    for (const tab of [
      "Document tree",
      "Communication",
      "Validation",
      "Firmware package",
      "Element library",
    ]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${tab} must fit ${width}px`,
      );
      if (["Document tree", "Firmware package"].includes(tab)) {
        await page.evaluate(() => {
          document.activeElement?.blur();
          window.scrollTo({ top: 0, behavior: "instant" });
        });
        await page.screenshot({
          path: resolve(
            artifacts,
            `${tab.toLowerCase().replaceAll(" ", "-")}-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
    await page.getByLabel("Export format").selectOption("xml");
    const authoredXMLPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download IODD", exact: true })
      .click();
    await (
      await authoredXMLPromise
    ).saveAs(resolve(artifacts, `authored-${width}.xml`));
    const profilePath =
      process.env.IODD_PROFILE_XML ||
      "/tmp/io-link-fwupdate-v121/IO-Link_Profile_Firmware-Update_10.082_V1.2.1_Oct2025/IODD-Snippets/IODD-Snippets-BT-FU.xml";
    let profileXML = null;
    try {
      profileXML = await readFile(profilePath);
    } catch {}
    if (profileXML) {
      await page
        .getByRole("tab", { name: "Element library", exact: true })
        .click();
      await page.locator("#profile-file").setInputFiles({
        name: "IODD-Snippets-BT-FU.xml",
        mimeType: "application/xml",
        buffer: profileXML,
      });
      await page
        .getByLabel("Profile variant", { exact: true })
        .selectOption("48");
      await page
        .getByRole("button", { name: "Apply profile", exact: true })
        .click();
      await page
        .locator("#status")
        .getByText(/Profile applied/)
        .waitFor();
      const profileDownload = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download IODD", exact: true })
        .click();
      await (
        await profileDownload
      ).saveAs(resolve(artifacts, `profile-${width}.xml`));
    }
    await page.route("**/search?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          content: [
            {
              ioddId: 5679,
              vendorId: 1234,
              productName: "Mock switching sensor",
              vendorName: "Fixture manufacturer",
              driverName: "fixture",
              productVariantId: 42,
            },
          ],
          totalElements: 1,
          number: 0,
          last: true,
        }),
      }),
    );
    await page.route("**/download?**", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/zip",
        body: await readFile(zipFile),
      }),
    );
    await page.getByRole("tab", { name: "IODD Finder", exact: true }).click();
    await page
      .getByLabel("Device, product or manufacturer", { exact: true })
      .fill("switching sensor");
    await page
      .getByRole("button", { name: "Search IODD Finder", exact: true })
      .click();
    await page.getByText("Mock switching sensor", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Open manufacturer package", exact: true })
      .click();
    await page
      .locator("#status")
      .getByText(/Manufacturer package opened locally/)
      .waitFor();
    await page
      .locator("#asset-list")
      .getByText(/device-logo.png/)
      .waitFor({ state: "attached" });
    for (const [label, filename] of [
      ["Counter / button / LED IODD ZIP", "counter"],
      ["Switching sensor IODD ZIP", "switching-sensor"],
    ]) {
      const publicDownload = page.waitForEvent("download");
      await page.getByRole("link", { name: label, exact: true }).click();
      const publicZIP = resolve(artifacts, `public-${filename}-${width}.zip`);
      await (await publicDownload).saveAs(publicZIP);
      await page.locator("#import-file").setInputFiles(publicZIP);
      await page
        .locator("#status")
        .getByText(/ZIP package opened locally/)
        .waitFor();
      await page.waitForFunction(
        (deviceId) =>
          document
            .getElementById("xml-source")
            .value.includes(`deviceId="${deviceId}"`),
        filename === "switching-sensor" ? "5679" : "5678",
      );
      const publicMapping = await page.evaluate(() => {
        const xml = new DOMParser().parseFromString(
          document.getElementById("xml-source").value,
          "application/xml",
        );
        return {
          threshold: xml
            .querySelector('Variable[id="V_SP1"]')
            ?.getAttribute("index"),
          inputBits: xml
            .querySelector("ProcessDataIn")
            ?.getAttribute("bitLength"),
          outputBits: xml
            .querySelector("ProcessDataOut")
            ?.getAttribute("bitLength"),
          offsets: [...xml.querySelectorAll("ProcessDataIn RecordItem")].map(
            (n) => n.getAttribute("bitOffset"),
          ),
        };
      });
      assert.equal(publicMapping.inputBits, "24");
      if (filename === "switching-sensor") {
        assert.equal(publicMapping.threshold, "256");
        assert.deepEqual(publicMapping.offsets, ["8", "1", "0"]);
        await page.locator("#compare-file").setInputFiles(projectFile);
        await page
          .getByRole("tab", { name: "Files & changes", exact: true })
          .click();
        await page.locator("#comparison-result li").first().waitFor();
      } else {
        assert.equal(publicMapping.outputBits, "8");
        assert.deepEqual(publicMapping.offsets, ["8", "0"]);
      }
    }
    await page.getByRole("tab", { name: "Parameters", exact: true }).click();
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
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
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
  if (server) await new Promise((r) => server.close(r));
}

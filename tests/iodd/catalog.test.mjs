import test from "node:test";
import assert from "node:assert/strict";
import { handleCatalogRequest } from "../../catalog-worker/index.mjs";

test("catalog accepts only bounded public GET routes and never arbitrary upstream URLs", async () => {
  let calls = 0;
  const upstream = async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    assert.match(
      String(url),
      /^https:\/\/ioddfinder.io-link.com\/api\/drivers\?/,
    );
    return new Response('{"content":[],"totalElements":0}');
  };
  const ok = await handleCatalogRequest(
    new Request("https://catalog.example/search?q=SDAT", {
      headers: { Origin: "https://iolinki.com" },
    }),
    upstream,
  );
  assert.equal(ok.status, 200);
  assert.equal(
    ok.headers.get("Access-Control-Allow-Origin"),
    "https://iolinki.com",
  );
  for (const path of [
    "/search?q=x",
    "/download?vendorId=-1&ioddId=2",
    "/fetch?url=https://evil.example",
    "/search?q=SDAT&field=bad",
  ]) {
    const result = await handleCatalogRequest(
      new Request("https://catalog.example" + path),
      upstream,
    );
    assert.equal(result.status, 400);
  }
  assert.equal(calls, 1);
  assert.equal(
    (
      await handleCatalogRequest(
        new Request("https://catalog.example/search?q=SDAT", {
          method: "POST",
        }),
        upstream,
      )
    ).status,
    405,
  );
});

test("catalog strips cookies and bounds returned data", async () => {
  const result = await handleCatalogRequest(
    new Request("https://catalog.example/download?vendorId=333&ioddId=12979"),
    async (url) => {
      assert.equal(
        String(url),
        "https://ioddfinder.io-link.com/api/vendors/333/iodds/12979/files/zip/rated",
      );
      return new Response(new Uint8Array([80, 75, 1, 2]), {
        headers: {
          "Set-Cookie": "private=value",
          "Content-Type": "application/zip",
        },
      });
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Set-Cookie"), null);
  const tooBig = await handleCatalogRequest(
    new Request("https://catalog.example/search?q=SDAT"),
    async () =>
      new Response("large", {
        headers: { "Content-Length": String(20 * 1024 * 1024) },
      }),
  );
  assert.equal(tooBig.status, 502);
});

test("/part converts the IODD in the Worker and caches it per converter version", async () => {
  const { readFileSync } = await import("node:fs");
  const { CONVERTER_VERSION } = await import("../../tools/iodd/iodd-part.mjs");
  const zip = readFileSync(new URL("./fixtures/station/ifm-pn7092-97.zip", import.meta.url));
  const store = new Map();
  const cache = {
    match: async (key) => (store.has(key.url) ? store.get(key.url).clone() : undefined),
    put: async (key, response) => {
      store.set(key.url, response);
    },
  };
  let calls = 0;
  const upstream = async (url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    assert.equal(String(url), "https://ioddfinder.io-link.com/api/vendors/310/iodds/97/files/zip/rated");
    return new Response(zip, { headers: { "Content-Type": "application/zip" } });
  };
  const ask = () => handleCatalogRequest(new Request("https://catalog.example/part?vendorId=310&ioddId=97", { headers: { Origin: "https://iolinki.com" } }), upstream, cache);
  const first = await ask();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("X-Part-Cache"), "miss");
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), "https://iolinki.com");
  const part = await first.json();
  assert.equal(part.id, "iodd-310-97");
  assert.equal(part.category, "pressure");
  assert.ok(part.settings[0].write.index > 0);
  const second = await ask();
  assert.equal(second.headers.get("X-Part-Cache"), "hit");
  assert.deepEqual(await second.json(), part);
  assert.equal(calls, 1);
  assert.ok([...store.keys()][0].includes("/v" + CONVERTER_VERSION + "/310/97"));
  const bad = await handleCatalogRequest(new Request("https://catalog.example/part?vendorId=0&ioddId=97"), upstream, cache);
  assert.equal(bad.status, 400);
  const broken = await handleCatalogRequest(new Request("https://catalog.example/part?vendorId=310&ioddId=98"), async () => new Response(new Uint8Array([1, 2, 3])), null);
  assert.equal(broken.status, 422);
  const missing = await handleCatalogRequest(new Request("https://catalog.example/part?vendorId=310&ioddId=99"), async () => new Response("", { status: 404 }), null);
  assert.equal(missing.status, 404);
});

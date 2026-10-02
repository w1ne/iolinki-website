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

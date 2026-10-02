import test from "node:test";
import assert from "node:assert/strict";
import { searchIODDs } from "../../assets/js/iodd/finder.js";
const baseUrl = "https://catalog.example";
const empty = { content: [], totalElements: 0, number: 0, last: true };
const entry = {
  ioddId: 7,
  productVariantId: 9,
  vendorName: "ifm electronic",
  productName: "Sensor",
  driverName: "ifm-Sensor",
};
async function mocked(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return handler(new URL(url), calls.length);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
test("automatic manufacturer fallback finds ifm and retains result mapping", async () => {
  await mocked(
    (url) =>
      response(
        url.searchParams.get("field") === "vendorName"
          ? { ...empty, content: [entry], totalElements: 2597, last: false }
          : empty,
      ),
    async (calls) => {
      const result = await searchIODDs("ifm", { baseUrl });
      assert.deepEqual(
        calls.map((c) => c.url.searchParams.get("field")),
        ["productName", "vendorName"],
      );
      assert.equal(result.matchedField, "vendorName");
      assert.equal(result.total, 2597);
      assert.equal(result.entries[0].filename, "ifm-Sensor.xml");
      assert.equal(
        result.entries[0].sourceUrl,
        "https://ioddfinder.io-link.com/#/productvariants/9",
      );
      assert.equal(calls[0].options.signal, calls[1].options.signal);
    },
  );
});
test("automatic searches have a bounded ordered fallback and numeric device lookup", async () => {
  for (const [query, fields] of [
    ["unknown", ["productName", "vendorName", "productId"]],
    ["310", ["productName", "vendorName", "productId", "deviceId"]],
  ]) {
    await mocked(
      () => response(empty),
      async (calls) => {
        const result = await searchIODDs(query, { baseUrl, field: "auto" });
        assert.equal(result.total, 0);
        assert.equal(result.matchedField, null);
        assert.deepEqual(
          calls.map((c) => c.url.searchParams.get("field")),
          fields,
        );
        assert.ok(calls.every((c) => c.url.searchParams.get("q") === query));
      },
    );
  }
});
test("automatic search stops on positive total even when requested page is empty", async () => {
  await mocked(
    () => response({ ...empty, totalElements: 3, number: 2 }),
    async (calls) => {
      const result = await searchIODDs("sensor", { baseUrl, page: 2, size: 5 });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url.searchParams.get("page"), "2");
      assert.equal(calls[0].url.searchParams.get("size"), "5");
      assert.equal(result.matchedField, "productName");
      assert.equal(result.page, 2);
    },
  );
});
test("explicit fields preserve a single search and automatic lookup stops at product ID", async () => {
  await mocked(
    () => response(empty),
    async (calls) => {
      const result = await searchIODDs("ifm", {
        baseUrl,
        field: "productName",
      });
      assert.equal(calls.length, 1);
      assert.equal(result.matchedField, "productName");
    },
  );
  await mocked(
    (url) =>
      response(
        url.searchParams.get("field") === "productId"
          ? { ...empty, content: [entry], totalElements: 1 }
          : empty,
      ),
    async (calls) => {
      const result = await searchIODDs("310", { baseUrl });
      assert.equal(result.matchedField, "productId");
      assert.equal(calls.length, 3);
    },
  );
});
test("network and upstream errors terminate fallback with actionable errors", async () => {
  await mocked(
    () => {
      throw new TypeError("Failed to fetch");
    },
    async (calls) => {
      await assert.rejects(
        searchIODDs("ifm", { baseUrl }),
        /Finder search.*official Finder/,
      );
      assert.equal(calls.length, 1);
    },
  );
  await mocked(
    () => response({ error: "Catalog unavailable" }, 503),
    async (calls) => {
      await assert.rejects(
        searchIODDs("ifm", { baseUrl }),
        /Catalog unavailable/,
      );
      assert.equal(calls.length, 1);
    },
  );
});

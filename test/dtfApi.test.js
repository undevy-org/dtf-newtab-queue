import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DtfApiError, fetchNews } from "../src/dtfApi.js";

const UNSAFE_DTF_URLS = [
  "javascript:alert(1)",
  "http://dtf.ru/news/1",
  "https://dtf.ru.evil.example/news/1",
  "https://.dtf.ru/news/1",
  "https://user:pass@dtf.ru/news/1",
  "https://dtf.ru:444/news/1",
  "not a URL"
];

function response(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return body;
    }
  };
}

describe("fetchNews", () => {
  it("maps DTF news response into queue items", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return response({
        message: "",
        result: {
          news: [
            {
              id: 1,
              title: "First",
              url: "https://dtf.ru/news/1-first",
              date: 1781691557
            },
            {
              id: 2,
              title: "Second",
              url: "https://dtf.ru/news/2-second",
              date: 1781691500
            }
          ],
          lastId: 2
        }
      });
    };

    const result = await fetchNews({ lastId: 10, fetchImpl });

    assert.equal(
      calls[0].url,
      "https://api.dtf.ru/v2.10/news?markdown=false&lastId=10"
    );
    assert.deepEqual(calls[0].options, { credentials: "include" });
    assert.deepEqual(result, {
      items: [
        {
          id: 1,
          title: "First",
          url: "https://dtf.ru/news/1-first",
          date: 1781691557,
          sourceBatchLastId: 2
        },
        {
          id: 2,
          title: "Second",
          url: "https://dtf.ru/news/2-second",
          date: 1781691500,
          sourceBatchLastId: 2
        }
      ],
      lastId: 2
    });
  });

  it("accepts news URLs on legitimate DTF subdomains", async () => {
    const fetchImpl = async () =>
      response({
        result: {
          news: [
            {
              id: 1,
              title: "Subdomain",
              url: "https://m.dtf.ru/news/1-subdomain",
              date: 1781691557
            }
          ],
          lastId: 1
        }
      });

    const result = await fetchNews({ fetchImpl });

    assert.equal(result.items[0].url, "https://m.dtf.ru/news/1-subdomain");
  });

  it("rejects unsafe news URLs as DtfApiError", async () => {
    for (const unsafeUrl of UNSAFE_DTF_URLS) {
      const fetchImpl = async () =>
        response({
          result: {
            news: [
              {
                id: 1,
                title: "Unsafe",
                url: unsafeUrl,
                date: 1781691557
              }
            ],
            lastId: 1
          }
        });

      await assert.rejects(
        () => fetchNews({ fetchImpl }),
        (error) =>
          error instanceof DtfApiError &&
          error.message.includes("url") &&
          error.details?.value === unsafeUrl
      );
    }
  });

  it("omits lastId query on first request", async () => {
    let requestedUrl = "";
    const fetchImpl = async (url) => {
      requestedUrl = url;
      return response({
        result: {
          news: [],
          lastId: null
        }
      });
    };

    await fetchNews({ fetchImpl });

    assert.equal(requestedUrl, "https://api.dtf.ru/v2.10/news?markdown=false");
  });

  it("throws DtfApiError for invalid request lastId values", async () => {
    const invalidValues = [Number.NaN, Infinity, "10"];
    const fetchImpl = async () => {
      throw new Error("fetchImpl should not be called for invalid lastId");
    };

    for (const lastId of invalidValues) {
      await assert.rejects(
        () => fetchNews({ lastId, fetchImpl }),
        (error) =>
          error instanceof DtfApiError &&
          error.message.includes("lastId") &&
          Object.is(error.details?.lastId, lastId)
      );
    }
  });

  it("normalizes invalid item date to null", async () => {
    const fetchImpl = async () =>
      response({
        result: {
          news: [
            {
              id: 1,
              title: "Missing Date",
              url: "https://dtf.ru/news/1-missing-date"
            }
          ],
          lastId: 1
        }
      });

    const result = await fetchNews({ fetchImpl });

    assert.equal(result.items[0].date, null);
  });

  it("throws DtfApiError for invalid response lastId", async () => {
    const fetchImpl = async () =>
      response({
        result: {
          news: [],
          lastId: "not-a-number"
        }
      });

    await assert.rejects(
      () => fetchNews({ fetchImpl }),
      (error) => error instanceof DtfApiError && error.message.includes("lastId")
    );
  });

  it("throws DtfApiError for coercible invalid response lastId values", async () => {
    const invalidValues = ["", "   ", false, []];

    for (const lastId of invalidValues) {
      const fetchImpl = async () =>
        response({
          result: {
            news: [],
            lastId
          }
        });

      await assert.rejects(
        () => fetchNews({ fetchImpl }),
        (error) =>
          error instanceof DtfApiError &&
          error.message.includes("lastId") &&
          Object.is(error.details?.lastId, lastId)
      );
    }
  });

  it("throws DtfApiError for HTTP failures", async () => {
    const fetchImpl = async () => response({}, { ok: false, status: 503 });

    await assert.rejects(
      () => fetchNews({ fetchImpl }),
      (error) => error instanceof DtfApiError && error.message.includes("503")
    );
  });

  it("throws DtfApiError for malformed items without url", async () => {
    const fetchImpl = async () =>
      response({
        result: {
          news: [{ id: 1, title: "Broken", date: 1781691557 }],
          lastId: 1
        }
      });

    await assert.rejects(
      () => fetchNews({ fetchImpl }),
      (error) => error instanceof DtfApiError && error.message.includes("url")
    );
  });

  it("throws DtfApiError for malformed items with invalid id or blank title", async () => {
    const cases = [
      {
        item: {
          id: Number.NaN,
          title: "Broken",
          url: "https://dtf.ru/news/1-broken"
        },
        fieldName: "id"
      },
      {
        item: {
          id: 1,
          title: "   ",
          url: "https://dtf.ru/news/1-broken"
        },
        fieldName: "title"
      }
    ];

    for (const { item, fieldName } of cases) {
      const fetchImpl = async () =>
        response({
          result: {
            news: [item],
            lastId: 1
          }
        });

      await assert.rejects(
        () => fetchNews({ fetchImpl }),
        (error) =>
          error instanceof DtfApiError &&
          error.message.includes(fieldName) &&
          error.details?.fieldName === fieldName
      );
    }
  });
});

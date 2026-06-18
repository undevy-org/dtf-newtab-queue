import { isSafeDtfUrl } from "./dtfUrl.js";

const NEWS_ENDPOINT = "https://api.dtf.ru/v2.10/news";

export class DtfApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DtfApiError";
    this.details = details;
  }
}

function assertNumber(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new DtfApiError(`DTF news item has invalid ${fieldName}`, {
      fieldName,
      value
    });
  }
}

function assertString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DtfApiError(`DTF news item has invalid ${fieldName}`, {
      fieldName,
      value
    });
  }
}

function assertDtfUrl(value) {
  assertString(value, "url");

  if (!isSafeDtfUrl(value)) {
    throw new DtfApiError("DTF news item has invalid url", {
      fieldName: "url",
      value
    });
  }
}

export function normalizeNewsItem(item, sourceBatchLastId) {
  assertNumber(item?.id, "id");
  assertString(item?.title, "title");
  assertDtfUrl(item?.url);

  return {
    id: item.id,
    title: item.title,
    url: item.url,
    date: Number.isFinite(item.date) ? item.date : null,
    sourceBatchLastId
  };
}

export async function fetchNews({ lastId, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new DtfApiError("No fetch implementation is available");
  }

  const url = new URL(NEWS_ENDPOINT);
  url.searchParams.set("markdown", "false");

  if (lastId !== undefined && lastId !== null) {
    if (typeof lastId !== "number" || !Number.isFinite(lastId)) {
      throw new DtfApiError("DTF API request contains invalid lastId", {
        lastId
      });
    }

    url.searchParams.set("lastId", String(lastId));
  }

  const response = await fetchImpl(url.toString(), { credentials: "include" });

  if (!response.ok) {
    throw new DtfApiError(`DTF API request failed with status ${response.status}`, {
      status: response.status,
      url: url.toString()
    });
  }

  const body = await response.json();
  const result = body?.result;

  if (!result || !Array.isArray(result.news)) {
    throw new DtfApiError("DTF API response does not contain result.news", {
      url: url.toString()
    });
  }

  let nextLastId = null;
  if (result.lastId !== undefined && result.lastId !== null) {
    if (typeof result.lastId !== "number" || !Number.isFinite(result.lastId)) {
      throw new DtfApiError("DTF API response contains invalid lastId", {
        lastId: result.lastId
      });
    }

    nextLastId = result.lastId;
  }

  return {
    items: result.news.map((item) => normalizeNewsItem(item, nextLastId)),
    lastId: nextLastId
  };
}

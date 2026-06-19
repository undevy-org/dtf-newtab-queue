import { isSafeDtfUrl } from "./dtfUrl.js";

export const STORAGE_KEY = "dtfQueueState";
export const MAX_EVENTS = 500;

// Upper bound for `seenIds`, the set of already-surfaced article ids the forward
// "Проверить новые" catch-up dedups against. Without a cap it grows forever (one
// id per viewed/opened item), leaking into chrome.storage.local and slowing the
// O(n) dedup in queueService. 500 mirrors MAX_EVENTS and dwarfs a single DTF
// forward page, so the newest page's ids are never at risk of eviction.
export const MAX_SEEN_IDS = 500;

// Bound `seenIds` to the newest ids. DTF ids increase monotonically with publish
// time (the same assumption the backward `lastId` cursor relies on), so the
// highest ids are the newest articles — exactly what a forward fetch (first page)
// returns and must dedup against. Keeping the top-N by *value* (not by insertion
// order) means a recently dismissed newest item never gets evicted by a later
// burst of deep-archive dismissals, which a naive keep-last cap would resurface.
//
// Tradeoff: the lowest (deepest-archive) ids are dropped. That is safe because
// the backward `lastId` cursor only advances deeper within a session, so passed
// archive pages are never re-fetched, and `reset` clears `seenIds` entirely.
export function capSeenIds(seenIds) {
  if (!Array.isArray(seenIds) || seenIds.length <= MAX_SEEN_IDS) {
    return seenIds;
  }

  return [...seenIds].sort((a, b) => a - b).slice(-MAX_SEEN_IDS);
}

export function createInitialState(initializedAt = new Date().toISOString()) {
  return {
    current: null,
    backlog: [],
    seenIds: [],
    lastId: null,
    initializedAt,
    updatedAt: initializedAt,
    exhausted: false,
    events: []
  };
}

export function appendEvent(
  state,
  type,
  details = {},
  now = () => new Date().toISOString()
) {
  const at = now();
  const event = {
    type,
    at,
    details
  };

  return {
    ...state,
    updatedAt: at,
    events: [...(state.events ?? []), event].slice(-MAX_EVENTS)
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwnFields(value, fields) {
  return fields.every((field) => Object.hasOwn(value, field));
}

function isFiniteNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isParseableTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isQueueItem(value) {
  return (
    isRecord(value) &&
    hasOwnFields(value, ["id", "title", "url", "date", "sourceBatchLastId"]) &&
    typeof value.id === "number" &&
    Number.isFinite(value.id) &&
    isNonEmptyString(value.title) &&
    isSafeDtfUrl(value.url) &&
    isFiniteNumberOrNull(value.date) &&
    isFiniteNumberOrNull(value.sourceBatchLastId)
  );
}

function isQueueEvent(value) {
  return (
    isRecord(value) &&
    hasOwnFields(value, ["type", "at", "details"]) &&
    isNonEmptyString(value.type) &&
    isParseableTimestamp(value.at) &&
    isRecord(value.details)
  );
}

export function isQueueState(value) {
  const requiredFields = [
    "current",
    "backlog",
    "seenIds",
    "lastId",
    "initializedAt",
    "updatedAt",
    "exhausted",
    "events"
  ];

  return (
    isRecord(value) &&
    hasOwnFields(value, requiredFields) &&
    (value.current === null || isQueueItem(value.current)) &&
    Array.isArray(value.backlog) &&
    value.backlog.every(isQueueItem) &&
    Array.isArray(value.seenIds) &&
    value.seenIds.length <= MAX_SEEN_IDS &&
    value.seenIds.every(
      (seenId) => typeof seenId === "number" && Number.isFinite(seenId)
    ) &&
    Array.isArray(value.events) &&
    value.events.length <= MAX_EVENTS &&
    value.events.every(isQueueEvent) &&
    isParseableTimestamp(value.initializedAt) &&
    isParseableTimestamp(value.updatedAt) &&
    typeof value.exhausted === "boolean" &&
    isFiniteNumberOrNull(value.lastId)
  );
}

export function createQueueStore(
  storageArea,
  { now = () => new Date().toISOString() } = {}
) {
  return {
    async getState() {
      const result = await storageArea.get(STORAGE_KEY);
      const hasStoredState = Object.hasOwn(result ?? {}, STORAGE_KEY);

      if (!hasStoredState) {
        return createInitialState(now());
      }

      const state = result[STORAGE_KEY];
      // Migrate legacy states whose `seenIds` predates the cap: trim rather than
      // discard the whole state (which would lose the archive cursor and history).
      const repaired =
        isRecord(state) && Array.isArray(state.seenIds)
          ? { ...state, seenIds: capSeenIds(state.seenIds) }
          : state;
      return isQueueState(repaired) ? repaired : createInitialState(now());
    },

    async setState(state) {
      await storageArea.set({ [STORAGE_KEY]: state });
      return state;
    },

    async clearState() {
      await storageArea.remove(STORAGE_KEY);
    }
  };
}

export function createMemoryStorageArea(initialValues = {}) {
  const values = cloneValue(initialValues);

  return {
    async get(key) {
      if (Array.isArray(key)) {
        return Object.fromEntries(
          key
            .filter((itemKey) => Object.hasOwn(values, itemKey))
            .map((itemKey) => [itemKey, cloneValue(values[itemKey])])
        );
      }

      if (typeof key === "string") {
        return Object.hasOwn(values, key) ? { [key]: cloneValue(values[key]) } : {};
      }

      if (key !== null && typeof key === "object") {
        return Object.fromEntries(
          Object.entries(key).map(([itemKey, defaultValue]) => [
            itemKey,
            Object.hasOwn(values, itemKey)
              ? cloneValue(values[itemKey])
              : cloneValue(defaultValue)
          ])
        );
      }

      return cloneValue(values);
    },

    async set(nextValues) {
      Object.assign(values, cloneValue(nextValues));
    },

    async remove(key) {
      if (Array.isArray(key)) {
        for (const itemKey of key) {
          delete values[itemKey];
        }
        return;
      }

      delete values[key];
    }
  };
}

function cloneValue(value) {
  return structuredClone(value);
}

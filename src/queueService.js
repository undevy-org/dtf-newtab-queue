import { fetchNews as defaultFetchNews } from "./dtfApi.js";
import { isSafeDtfUrl } from "./dtfUrl.js";
import { appendEvent, createInitialState } from "./queueStore.js";

const MAX_FETCH_PAGES_PER_ACTION = 3;
const QUEUE_MUTATION_LOCK_NAME = "dtf-newtab-queue-extension:mutation";

let fallbackMutationTail = Promise.resolve();

function withQueueMutationLock(mutation) {
  const lockManager = globalThis.navigator?.locks;

  if (lockManager && typeof lockManager.request === "function") {
    return lockManager.request(QUEUE_MUTATION_LOCK_NAME, mutation);
  }

  const result = fallbackMutationTail.then(mutation);
  fallbackMutationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function statusForState(state) {
  if (state.current) {
    return "ready";
  }

  if (state.exhausted) {
    return "empty";
  }

  return "idle";
}

function resultFor(state, { status = statusForState(state), error = null } = {}) {
  return { state, status, error };
}

function isPristineState(state) {
  return (
    state.current === null &&
    state.backlog.length === 0 &&
    state.seenIds.length === 0 &&
    state.lastId === null &&
    state.exhausted === false &&
    state.events.length === 0
  );
}

function normalizeFetchedBatch(batch) {
  if (!batch || !Array.isArray(batch.items)) {
    throw new Error("fetchNews returned an invalid batch");
  }

  return {
    items: batch.items,
    lastId: batch.lastId ?? null
  };
}

function appendQueueEvent(state, type, details, now) {
  return appendEvent(state, type, details, now);
}

function rememberFetch(state, requestedLastId, batch, now) {
  const fetched = normalizeFetchedBatch(batch);
  const nextState = appendQueueEvent(
    state,
    "fetch",
    {
      requestedLastId,
      resultCount: fetched.items.length,
      nextLastId: fetched.lastId
    },
    now
  );

  return {
    state: {
      ...nextState,
      lastId: fetched.lastId
    },
    items: fetched.items
  };
}

function rememberForwardFetch(state, batch, now) {
  const fetched = normalizeFetchedBatch(batch);
  const nextLastId = state.lastId === null ? fetched.lastId : state.lastId;
  const nextState = appendQueueEvent(
    state,
    "fetch",
    {
      requestedLastId: null,
      resultCount: fetched.items.length,
      nextLastId
    },
    now
  );

  return {
    state: {
      ...nextState,
      lastId: nextLastId
    },
    items: fetched.items
  };
}

function showForwardItems(state, items, now) {
  if (items.length === 0) {
    return appendQueueEvent(
      { ...state, current: null, backlog: [], exhausted: false },
      "caught-up",
      { reason: "no-newer-items" },
      now
    );
  }

  const [current, ...backlog] = items;

  return appendQueueEvent(
    { ...state, current, backlog, exhausted: false },
    "shown",
    { id: current.id },
    now
  );
}

function dedupeItems(items, state) {
  const blockedIds = new Set(state.seenIds);

  if (state.current) {
    blockedIds.add(state.current.id);
  }

  for (const item of state.backlog) {
    blockedIds.add(item.id);
  }

  const deduped = [];

  for (const item of items) {
    if (blockedIds.has(item.id)) {
      continue;
    }

    blockedIds.add(item.id);
    deduped.push(item);
  }

  return deduped;
}

function addSeenId(state, id) {
  if (state.seenIds.includes(id)) {
    return state;
  }

  return {
    ...state,
    seenIds: [...state.seenIds, id]
  };
}

function showItems(state, items, now) {
  if (items.length === 0) {
    const emptyState = {
      ...state,
      current: null,
      backlog: [],
      exhausted: true
    };

    return appendQueueEvent(
      emptyState,
      "empty",
      { reason: "no-usable-items" },
      now
    );
  }

  const [current, ...backlog] = items;
  const shownState = {
    ...state,
    current,
    backlog,
    exhausted: false
  };

  return appendQueueEvent(shownState, "shown", { id: current.id }, now);
}

function showNextBacklogItem(state, now) {
  const [current, ...backlog] = state.backlog;

  return appendQueueEvent(
    {
      ...state,
      current,
      backlog,
      exhausted: false
    },
    "shown",
    { id: current.id },
    now
  );
}

function defaultOpenUrl(url) {
  const tabs = globalThis.chrome?.tabs;

  if (!tabs || typeof tabs.create !== "function") {
    throw new Error("No URL opener is available");
  }

  return tabs.create({ url });
}

export function createQueueService({
  store,
  fetchNews = defaultFetchNews,
  openUrl = defaultOpenUrl,
  now = () => new Date().toISOString()
}) {
  async function save(state) {
    await store.setState(state);
    return state;
  }

  async function saveError(state, action, error) {
    const erroredState = appendQueueEvent(
      state,
      "error",
      { action, message: errorMessage(error) },
      now
    );

    await save(erroredState);
    return resultFor(erroredState, {
      status: "error",
      error: errorMessage(error)
    });
  }

  async function createStateFromFirstBatch(firstEventType) {
    let state = createInitialState(now());
    state = appendQueueEvent(state, firstEventType, {}, now);

    const fetched = await fetchNews({});
    const remembered = rememberFetch(state, null, fetched, now);
    state = remembered.state;

    const items = dedupeItems(remembered.items, state);
    state = showItems(state, items, now);

    return save(state);
  }

  async function fetchUsableItems(state) {
    let nextState = state;

    for (let attempt = 0; attempt < MAX_FETCH_PAGES_PER_ACTION; attempt += 1) {
      if (nextState.lastId === null) {
        break;
      }

      const requestedLastId = nextState.lastId;
      const fetched = await fetchNews({ lastId: requestedLastId });
      const remembered = rememberFetch(nextState, requestedLastId, fetched, now);
      nextState = remembered.state;

      if (remembered.items.length === 0) {
        break;
      }

      const items = dedupeItems(remembered.items, nextState);

      if (items.length > 0) {
        return { state: nextState, items };
      }
    }

    return { state: nextState, items: [] };
  }

  function fetchNextUsableItems(state) {
    return fetchUsableItems(state);
  }

  async function fetchNewerItems(state) {
    const fetched = await fetchNews({});
    const remembered = rememberForwardFetch(state, fetched, now);
    const items = dedupeItems(remembered.items, remembered.state);
    return { state: remembered.state, items };
  }

  async function advance(actionType) {
    const originalState = await store.getState();

    if (!originalState.current) {
      return resultFor(originalState);
    }

    const currentId = originalState.current.id;
    let nextState = addSeenId(originalState, currentId);
    nextState = appendQueueEvent(
      nextState,
      actionType,
      { id: currentId },
      now
    );

    if (nextState.backlog.length > 0) {
      nextState = showNextBacklogItem(nextState, now);
      return resultFor(await save(nextState));
    }

    nextState = {
      ...nextState,
      current: null,
      exhausted: false
    };

    try {
      const fetched = await fetchNewerItems(nextState);
      nextState = showForwardItems(fetched.state, fetched.items, now);
    } catch (error) {
      return saveError(originalState, actionType, error);
    }

    return resultFor(await save(nextState));
  }

  async function resumeForward(state, actionType) {
    if (state.current) {
      return resultFor(state);
    }

    if (state.backlog.length > 0) {
      const nextState = showNextBacklogItem(state, now);
      return resultFor(await save(nextState));
    }

    try {
      const fetched = await fetchNewerItems(state);
      const nextState = showForwardItems(fetched.state, fetched.items, now);
      return resultFor(await save(nextState));
    } catch (error) {
      return saveError(state, actionType, error);
    }
  }

  return {
    async getState() {
      const state = await store.getState();
      return resultFor(state);
    },

    async initialize() {
      return withQueueMutationLock(async () => {
        const state = await store.getState();

        if (!isPristineState(state)) {
          return resultFor(state);
        }

        try {
          return resultFor(await createStateFromFirstBatch("init"));
        } catch (error) {
          return saveError(state, "init", error);
        }
      });
    },

    async markViewed() {
      return withQueueMutationLock(() => advance("dismissed"));
    },

    async openCurrent() {
      return withQueueMutationLock(async () => {
        const state = await store.getState();

        if (!state.current) {
          return resultFor(state);
        }

        if (!isSafeDtfUrl(state.current.url)) {
          return saveError(
            state,
            "opened",
            new Error("Current item has an invalid DTF URL")
          );
        }

        try {
          await openUrl(state.current.url, state.current);
        } catch (error) {
          return saveError(state, "opened", error);
        }

        let openedState = addSeenId(state, state.current.id);
        openedState = appendQueueEvent(
          openedState,
          "opened",
          { id: state.current.id },
          now
        );

        if (openedState.backlog.length > 0) {
          const nextState = showNextBacklogItem(openedState, now);
          return resultFor(await save(nextState));
        }

        openedState = {
          ...openedState,
          current: null,
          exhausted: false
        };
        await save(openedState);

        try {
          const fetched = await fetchNewerItems(openedState);
          const nextState = showForwardItems(fetched.state, fetched.items, now);
          return resultFor(await save(nextState));
        } catch (error) {
          return saveError(openedState, "opened", error);
        }
      });
    },

    async retry() {
      return withQueueMutationLock(async () => {
        const state = await store.getState();
        return resumeForward(state, "retry");
      });
    },

    async reset() {
      return withQueueMutationLock(async () => {
        const state = await store.getState();

        try {
          return resultFor(await createStateFromFirstBatch("reset"));
        } catch (error) {
          return saveError(state, "reset", error);
        }
      });
    },

    async loadArchive() {
      return withQueueMutationLock(async () => {
        const state = await store.getState();

        if (state.current) {
          return resultFor(state);
        }

        if (state.backlog.length > 0) {
          return resultFor(await save(showNextBacklogItem(state, now)));
        }

        try {
          const fetched = await fetchNextUsableItems(state);
          const nextState = showItems(fetched.state, fetched.items, now);
          return resultFor(await save(nextState));
        } catch (error) {
          return saveError(state, "archive", error);
        }
      });
    }
  };
}

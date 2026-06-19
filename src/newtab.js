import { fetchNews } from "./dtfApi.js";
import { createQueueService } from "./queueService.js";
import { createInitialState, createQueueStore } from "./queueStore.js";

const app = document.querySelector("#app");
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit"
});

function createNode(tagName, className, textContent) {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (textContent !== undefined) {
    node.textContent = textContent;
  }

  return node;
}

function formatDate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) {
    return "";
  }

  return dateFormatter.format(new Date(epochSeconds * 1000));
}

function createButton(label, action, { primary = false } = {}) {
  const button = createNode(
    "button",
    primary ? "button button--primary" : "button",
    label
  );

  button.type = "button";
  button.dataset.action = action;
  button.disabled = busy;
  button.setAttribute("aria-disabled", String(busy));

  return button;
}

function createStatus(text, { error = false, live = "polite" } = {}) {
  const status = createNode(
    "p",
    error ? "status status--error" : "status",
    text
  );

  status.setAttribute("role", error ? "alert" : "status");
  status.setAttribute("aria-live", live);
  return status;
}

function buildMeta(item, backlogCount) {
  const parts = ["DTF"];

  const date = formatDate(item.date);
  if (date) {
    parts.push(date);
  }

  if (backlogCount > 0) {
    parts.push(`В очереди: ${backlogCount}`);
  }

  return parts.join(" · ");
}

function renderShell({ title, meta = "", status = null, error = null, actions = [] }) {
  if (!app) {
    return;
  }

  const fragment = document.createDocumentFragment();

  fragment.appendChild(createNode("p", "eyebrow", "DTF"));
  fragment.appendChild(createNode("h1", "title", title));

  if (meta) {
    fragment.appendChild(createNode("p", "meta", meta));
  }

  if (actions.length > 0) {
    const actionRow = createNode("div", "actions");

    for (const action of actions) {
      actionRow.appendChild(action);
    }

    fragment.appendChild(actionRow);
  }

  if (status) {
    fragment.appendChild(createStatus(status));
  }

  if (error) {
    fragment.appendChild(createStatus(error, { error: true, live: "assertive" }));
  }

  app.replaceChildren(fragment);
  app.setAttribute("aria-busy", String(busy));
}

function renderLoading(message = "Подключаюсь к очереди.") {
  renderShell({
    title: "Загружаю новость...",
    status: message
  });
}

function renderCard(state, error = null, busyMessage = "") {
  const item = state.current;
  const actions = [
    createButton("Просмотрел", "viewed"),
    createButton("Перейти", "open", { primary: true })
  ];

  renderShell({
    title: item.title,
    meta: buildMeta(item, state.backlog.length),
    status: busy ? busyMessage : null,
    error,
    actions
  });
}

function renderArchiveEnded(error = null, busyMessage = "") {
  renderShell({
    title: "Вы прочитали всё, включая архив",
    meta: "Новых карточек нет. Можно проверить ещё раз позже.",
    status: busy ? busyMessage : null,
    error,
    actions: [
      createButton("Проверить новые", "retry", { primary: true }),
      createButton("Сбросить", "reset")
    ]
  });
}

function renderFork(error = null, busyMessage = "") {
  renderShell({
    title: "Вы прочитали всё свежее",
    meta: "Проверьте новые сверху или загляните глубже в архив.",
    status: busy ? busyMessage : null,
    error,
    actions: [
      createButton("Проверить новые", "retry", { primary: true }),
      createButton("Глубже в архив", "archive"),
      createButton("Сбросить", "reset")
    ]
  });
}

function renderResult(result) {
  currentResult = result;

  if (!result?.state) {
    renderLoading();
    return;
  }

  const { state, error = null } = result;

  if (state.current) {
    renderCard(state, error, busyMessage);
    return;
  }

  if (state.exhausted) {
    renderArchiveEnded(error, busyMessage);
    return;
  }

  renderFork(error, busyMessage);
}

function setBusy(nextBusy, message = "") {
  busy = nextBusy;
  busyMessage = message;

  if (app) {
    app.setAttribute("aria-busy", String(nextBusy));
  }
}

async function runAction(message, action) {
  if (busy) {
    return;
  }

  setBusy(true, message);
  renderResult(currentResult);

  try {
    const result = await action();
    setBusy(false, "");
    renderResult(result);
  } catch (error) {
    setBusy(false, "");
    renderResult({
      state: currentResult?.state ?? createInitialState(),
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function createUnavailableService(message) {
  const state = createInitialState();
  const result = {
    state,
    status: "error",
    error: message
  };

  return {
    async initialize() {
      return result;
    },
    async markViewed() {
      return result;
    },
    async openCurrent() {
      return result;
    },
    async loadArchive() {
      return result;
    },
    async retry() {
      return result;
    },
    async reset() {
      return result;
    }
  };
}

const chromeApi = globalThis.chrome;
const storageArea = chromeApi?.storage?.local;

const service =
  storageArea &&
  typeof storageArea.get === "function" &&
  typeof storageArea.set === "function"
    ? createQueueService({
        store: createQueueStore(storageArea),
        fetchNews,
        openUrl(url) {
          const tabs = globalThis.chrome?.tabs;

          if (!tabs || typeof tabs.create !== "function") {
            throw new Error("Недоступен chrome.tabs.create");
          }

          return tabs.create({ url });
        }
      })
    : createUnavailableService("Недоступны API Chrome.");

let currentResult = null;
let busy = false;
let busyMessage = "";

if (app) {
  setBusy(true, "Подключаюсь к очереди.");
  renderLoading();

  void (async () => {
    try {
      const result = await service.initialize();
      setBusy(false, "");
      renderResult(result);
    } catch (error) {
      setBusy(false, "");
      renderResult({
        state: createInitialState(),
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  app.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-action]");

    if (!(button instanceof HTMLButtonElement) || busy) {
      return;
    }

    const action = button.dataset.action;

    if (action === "viewed") {
      void runAction("Загружаю следующую карточку...", () =>
        service.markViewed()
      );
    } else if (action === "open") {
      void runAction("Открываю ссылку...", () => service.openCurrent());
    } else if (action === "archive") {
      void runAction("Загружаю архив...", () => service.loadArchive());
    } else if (action === "retry") {
      void runAction("Проверяю ещё раз...", () => service.retry());
    } else if (action === "reset") {
      void runAction("Сбрасываю очередь...", () => service.reset());
    }
  });
}

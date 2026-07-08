import { fallbackColorForDomain, readableTextColor } from "./favoriteColor.js";
import { getFavoriteIconModel, getFavoriteLetter } from "./favoriteIcon.js";
import { createFavoritesService } from "./favoritesService.js";
import { createFavoritesStore } from "./favoritesStore.js";
import { fetchNews } from "./dtfApi.js";
import { createQueueService } from "./queueService.js";
import { createInitialState, createQueueStore } from "./queueStore.js";

const app = document.querySelector("#app");
const favoritesRoot = document.querySelector("#favorites");
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
const extensionId = chromeApi?.runtime?.id ?? "";

const favoritesService =
  storageArea &&
  typeof storageArea.get === "function" &&
  typeof storageArea.set === "function"
    ? createFavoritesService({
        store: createFavoritesStore(storageArea),
        defaultBackgroundColor: fallbackColorForDomain
      })
    : null;

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
let favoritesState = null;
let favoritesMode = "view";
let favoritesEditingId = null;
let favoritesError = "";

function createFavoriteIconNode(model, item) {
  if (model.type === "image") {
    const image = createNode("img", "favorite-icon");
    image.src = model.src;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.replaceWith(
        createNode("span", "favorite-letter", getFavoriteLetter(item))
      );
    });
    return image;
  }

  return createNode("span", "favorite-letter", model.letter);
}

function createFavoriteTile(item) {
  const button = createNode("button", "favorite-tile");
  const iconModel = getFavoriteIconModel(item, { extensionId });

  button.type = "button";
  button.dataset.favoriteAction = "open";
  button.dataset.favoriteId = item.id;
  button.title = item.label;
  button.setAttribute("aria-label", `Открыть ${item.label}`);
  button.style.setProperty("--favorite-bg", item.backgroundColor);
  button.style.setProperty("--favorite-fg", readableTextColor(item.backgroundColor));
  button.appendChild(createFavoriteIconNode(iconModel, item));
  return button;
}

function createFavoriteAddButton() {
  const button = createNode("button", "favorite-tile favorite-tile--add", "+");
  button.type = "button";
  button.dataset.favoriteAction = "start-add";
  button.setAttribute("aria-label", "Добавить избранную ссылку");
  return button;
}

function createFavoritesActions() {
  const actions = createNode("div", "favorites-actions");
  const settings = createNode("button", "favorite-settings", "⚙");
  settings.type = "button";
  settings.dataset.favoriteAction = "toggle-edit";
  settings.setAttribute("aria-label", "Настройки избранных ссылок");
  actions.appendChild(settings);
  return actions;
}

function createAddForm() {
  const form = createNode("form", "favorite-form");
  form.dataset.favoriteForm = "add";

  const input = createNode("input", "favorite-input");
  input.name = "url";
  input.type = "url";
  input.placeholder = "https://example.com";
  input.required = true;
  input.autocomplete = "url";

  const save = createNode("button", "button button--primary", "Сохранить");
  save.type = "submit";

  const cancel = createNode("button", "button", "Отмена");
  cancel.type = "button";
  cancel.dataset.favoriteAction = "cancel";

  form.append(input, save, cancel);
  return form;
}

function renderFavorites() {
  if (!favoritesRoot) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const grid = createNode("div", "favorites-grid");

  for (const item of favoritesState?.items ?? []) {
    grid.appendChild(createFavoriteTile(item));
  }

  grid.appendChild(createFavoriteAddButton());
  fragment.appendChild(grid);
  fragment.appendChild(createFavoritesActions());

  if (favoritesMode === "add") {
    fragment.appendChild(createAddForm());
  }

  if (favoritesError) {
    fragment.appendChild(
      createStatus(favoritesError, { error: true, live: "assertive" })
    );
  }

  favoritesRoot.replaceChildren(fragment);
}

if (app) {
  void (async () => {
    if (!favoritesService) {
      favoritesError = "Недоступны API Chrome для избранного.";
      renderFavorites();
      return;
    }

    try {
      favoritesState = await favoritesService.getState();
      renderFavorites();
    } catch (error) {
      favoritesError = error instanceof Error ? error.message : String(error);
      renderFavorites();
    }
  })();

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

  favoritesRoot?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const target = event.target.closest("[data-favorite-action]");

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.favoriteAction;

    if (action === "start-add") {
      favoritesMode = "add";
      favoritesError = "";
      renderFavorites();
    } else if (action === "cancel") {
      favoritesMode = "view";
      favoritesEditingId = null;
      favoritesError = "";
      renderFavorites();
    } else if (action === "open") {
      const favorite = favoritesState?.items.find(
        (item) => item.id === target.dataset.favoriteId
      );

      if (favorite) {
        window.location.assign(favorite.url);
      }
    }
  });

  favoritesRoot?.addEventListener("submit", (event) => {
    const form = event.target;

    if (!(form instanceof HTMLFormElement) || form.dataset.favoriteForm !== "add") {
      return;
    }

    event.preventDefault();

    void (async () => {
      if (!favoritesService) {
        favoritesError = "Недоступны API Chrome для избранного.";
        renderFavorites();
        return;
      }

      const data = new FormData(form);

      try {
        favoritesState = await favoritesService.addFavorite({
          url: data.get("url")
        });
        favoritesMode = "view";
        favoritesError = "";
        renderFavorites();
      } catch (error) {
        favoritesError = error instanceof Error ? error.message : String(error);
        renderFavorites();
      }
    })();
  });
}

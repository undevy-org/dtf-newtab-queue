import {
  extractImageBackgroundColor,
  fallbackColorForDomain,
  readableTextColor
} from "./favoriteColor.js";
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
const faviconBaseUrl =
  typeof chromeApi?.runtime?.getURL === "function"
    ? chromeApi.runtime.getURL("/_favicon/")
    : "";

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
let favoritesBusy = false;
let favoritesGeneration = 0;

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
  const iconModel = getFavoriteIconModel(item, { faviconBaseUrl });

  button.type = "button";
  button.dataset.favoriteAction = favoritesMode === "edit" ? "edit" : "open";
  button.dataset.favoriteId = item.id;
  button.title = item.label;
  button.setAttribute(
    "aria-label",
    favoritesMode === "edit" ? `Редактировать ${item.label}` : `Открыть ${item.label}`
  );
  button.style.setProperty("--favorite-bg", item.backgroundColor);
  button.style.setProperty("--favorite-fg", readableTextColor(item.backgroundColor));
  button.appendChild(createFavoriteIconNode(iconModel, item));
  const tileDisabled = favoritesBusy || favoritesEditingId !== null;
  button.disabled = tileDisabled;
  button.setAttribute("aria-disabled", String(tileDisabled));
  return button;
}

function createFavoriteAddButton() {
  const button = createNode("button", "favorite-tile favorite-tile--add", "+");
  button.type = "button";
  button.dataset.favoriteAction = "start-add";
  button.setAttribute("aria-label", "Добавить избранную ссылку");
  const addDisabled = favoritesBusy || favoritesEditingId !== null || favoritesMode === "add";
  button.disabled = addDisabled;
  button.setAttribute("aria-disabled", String(addDisabled));
  return button;
}

function createFavoritesActions() {
  const actions = createNode("div", "favorites-actions");
  const settings = createNode("button", "favorite-settings", "⚙");
  settings.type = "button";
  settings.dataset.favoriteAction = "toggle-edit";
  settings.setAttribute("aria-label", "Настройки избранных ссылок");
  const settingsDisabled = favoritesBusy || favoritesEditingId !== null || favoritesMode === "add";
  settings.disabled = settingsDisabled;
  settings.setAttribute("aria-disabled", String(settingsDisabled));
  actions.appendChild(settings);
  return actions;
}

function createAddForm() {
  const form = createNode("form", "favorite-form");
  form.dataset.favoriteForm = "add";

  const input = createNode("input", "favorite-input");
  input.name = "url";
  input.type = "text";
  input.inputMode = "url";
  input.placeholder = "https://example.com";
  input.required = true;
  input.autocomplete = "url";

  const save = createNode("button", "button button--primary", "Сохранить");
  save.type = "submit";
  save.disabled = favoritesBusy;

  const cancel = createNode("button", "button", "Отмена");
  cancel.type = "button";
  cancel.dataset.favoriteAction = "cancel";
  cancel.disabled = favoritesBusy;

  form.append(input, save, cancel);
  return form;
}

function createEditForm(item) {
  const form = createNode("form", "favorite-form favorite-form--editor");
  form.dataset.favoriteForm = "edit";
  form.dataset.favoriteId = item.id;

  const url = createNode("input", "favorite-input");
  url.name = "url";
  url.type = "text";
  url.inputMode = "url";
  url.value = item.url;
  url.required = true;
  url.autocomplete = "url";

  const label = createNode("input", "favorite-input");
  label.name = "label";
  label.type = "text";
  label.value = item.label;
  label.placeholder = item.domain;

  const iconMode = createNode("select", "favorite-input");
  iconMode.name = "iconMode";

  for (const [value, text] of [
    ["favicon", "С сайта"],
    ["letter", "Буква"],
    ["custom", "Своя"]
  ]) {
    const option = createNode("option", "", text);
    option.value = value;
    option.selected = value === item.iconMode;
    iconMode.appendChild(option);
  }

  const customIconUrl = createNode("input", "favorite-input");
  customIconUrl.name = "customIconUrl";
  customIconUrl.type = "text";
  customIconUrl.inputMode = "url";
  customIconUrl.value = item.customIconUrl ?? "";
  customIconUrl.placeholder = "https://example.com/icon.png";

  const backgroundColorSource = createNode("select", "favorite-input");
  backgroundColorSource.name = "backgroundColorSource";

  for (const [value, text] of [
    ["auto", "Автоцвет"],
    ["manual", "Ручной цвет"]
  ]) {
    const option = createNode("option", "", text);
    option.value = value;
    option.selected = value === item.backgroundColorSource;
    backgroundColorSource.appendChild(option);
  }

  const color = createNode("input", "favorite-color-input");
  color.name = "backgroundColor";
  color.type = "color";
  color.value = item.backgroundColor;

  const save = createNode("button", "button button--primary", "Сохранить");
  save.type = "submit";
  save.disabled = favoritesBusy;

  const cancel = createNode("button", "button", "Отмена");
  cancel.type = "button";
  cancel.dataset.favoriteAction = "cancel";
  cancel.disabled = favoritesBusy;

  const remove = createNode("button", "button button--danger", "Удалить");
  remove.type = "button";
  remove.dataset.favoriteAction = "delete";
  remove.dataset.favoriteId = item.id;
  remove.disabled = favoritesBusy;

  form.append(
    url,
    label,
    iconMode,
    customIconUrl,
    backgroundColorSource,
    color,
    save,
    cancel,
    remove
  );
  return form;
}

function loadBrowserImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function createBrowserCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function resolveAutoBackgroundColor(item) {
  const fallback = fallbackColorForDomain(item.domain);
  const iconModel = getFavoriteIconModel(item, { faviconBaseUrl });
  const imageUrl = iconModel.type === "image" ? iconModel.src : "";

  if (!imageUrl) {
    return fallback;
  }

  return (
    (await extractImageBackgroundColor(imageUrl, {
      loadImage: loadBrowserImage,
      createCanvas: createBrowserCanvas
    })) ?? fallback
  );
}

function renderFavorites() {
  if (!favoritesRoot) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const grid = createNode("div", "favorites-grid");
  const items = favoritesState?.items ?? [];

  items.forEach((item, index) => {
    const wrapper = createNode("div", "favorite-tile-wrap");
    wrapper.appendChild(createFavoriteTile(item));

    if (favoritesMode === "edit") {
      const moveRow = createNode("div", "favorite-move-row");
      const left = createNode("button", "favorite-mini-button", "‹");
      const right = createNode("button", "favorite-mini-button", "›");

      left.type = "button";
      right.type = "button";
      left.dataset.favoriteAction = "move-left";
      right.dataset.favoriteAction = "move-right";
      left.dataset.favoriteId = item.id;
      right.dataset.favoriteId = item.id;
      const moveDisabled = favoritesBusy || favoritesEditingId !== null || favoritesMode === "add";
      left.disabled = moveDisabled || index === 0;
      right.disabled = moveDisabled || index === items.length - 1;
      moveRow.append(left, right);
      wrapper.appendChild(moveRow);
    }

    grid.appendChild(wrapper);
  });

  grid.appendChild(createFavoriteAddButton());
  fragment.appendChild(grid);
  fragment.appendChild(createFavoritesActions());

  if (favoritesMode === "add") {
    fragment.appendChild(createAddForm());
  }

  const editingItem = items.find((item) => item.id === favoritesEditingId);

  if (favoritesMode === "edit" && editingItem) {
    fragment.appendChild(createEditForm(editingItem));
  }

  if (favoritesError) {
    fragment.appendChild(
      createStatus(favoritesError, { error: true, live: "assertive" })
    );
  }

  favoritesRoot.replaceChildren(fragment);
}

function setFavoritesBusy(nextBusy) {
  favoritesBusy = nextBusy;
}

function startFavoritesAction() {
  favoritesGeneration += 1;
  setFavoritesBusy(true);
  renderFavorites();
  return favoritesGeneration;
}

function finishFavoritesAction(generation, applyResult) {
  setFavoritesBusy(false);

  if (generation !== favoritesGeneration) {
    return;
  }

  applyResult();
  renderFavorites();
}

if (favoritesRoot) {
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

  favoritesRoot.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const target = event.target.closest("[data-favorite-action]");

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (favoritesBusy) {
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
    } else if (action === "toggle-edit") {
      favoritesMode = favoritesMode === "edit" ? "view" : "edit";
      favoritesEditingId = null;
      favoritesError = "";
      renderFavorites();
    } else if (action === "edit") {
      favoritesEditingId = target.dataset.favoriteId ?? null;
      favoritesError = "";
      renderFavorites();
    } else if (action === "delete") {
      const generation = startFavoritesAction();

      void (async () => {
        if (!favoritesService) {
          finishFavoritesAction(generation, () => {
            favoritesError = "Недоступны API Chrome для избранного.";
          });
          return;
        }

        try {
          const nextState = await favoritesService.deleteFavorite(
            target.dataset.favoriteId
          );
          finishFavoritesAction(generation, () => {
            favoritesState = nextState;
            favoritesEditingId = null;
            favoritesError = "";
          });
        } catch (error) {
          finishFavoritesAction(generation, () => {
            favoritesError = error instanceof Error ? error.message : String(error);
          });
        }
      })();
    } else if (action === "move-left" || action === "move-right") {
      const generation = startFavoritesAction();

      void (async () => {
        if (!favoritesService) {
          finishFavoritesAction(generation, () => {
            favoritesError = "Недоступны API Chrome для избранного.";
          });
          return;
        }

        try {
          const nextState = await favoritesService.moveFavorite(
            target.dataset.favoriteId,
            action === "move-left" ? -1 : 1
          );
          finishFavoritesAction(generation, () => {
            favoritesState = nextState;
            favoritesError = "";
          });
        } catch (error) {
          finishFavoritesAction(generation, () => {
            favoritesError = error instanceof Error ? error.message : String(error);
          });
        }
      })();
    } else if (action === "open") {
      const favorite = favoritesState?.items.find(
        (item) => item.id === target.dataset.favoriteId
      );

      if (favorite) {
        window.location.assign(favorite.url);
      }
    }
  });

  favoritesRoot.addEventListener("submit", (event) => {
    const form = event.target;

    if (
      !(form instanceof HTMLFormElement) ||
      !["add", "edit"].includes(form.dataset.favoriteForm ?? "")
    ) {
      return;
    }

    event.preventDefault();

    if (favoritesBusy) {
      return;
    }

    const generation = startFavoritesAction();

    void (async () => {
      if (!favoritesService) {
        finishFavoritesAction(generation, () => {
          favoritesError = "Недоступны API Chrome для избранного.";
        });
        return;
      }

      const data = new FormData(form);

      try {
        if (form.dataset.favoriteForm === "edit") {
          const backgroundColorSource =
            data.get("backgroundColorSource") === "manual" ? "manual" : "auto";
          favoritesState = await favoritesService.updateFavorite(
            form.dataset.favoriteId,
            {
              url: data.get("url"),
              label: data.get("label"),
              iconMode: data.get("iconMode"),
              customIconUrl: data.get("customIconUrl"),
              backgroundColor: data.get("backgroundColor"),
              backgroundColorSource
            }
          );

          const updatedItem = favoritesState.items.find(
            (item) => item.id === form.dataset.favoriteId
          );

          if (backgroundColorSource === "auto" && updatedItem) {
            const autoColor = await resolveAutoBackgroundColor(updatedItem);

            if (autoColor !== updatedItem.backgroundColor) {
              favoritesState = await favoritesService.updateFavorite(
                updatedItem.id,
                {
                  backgroundColor: autoColor,
                  backgroundColorSource: "auto"
                }
              );
            }
          }

          finishFavoritesAction(generation, () => {
            favoritesEditingId = null;
            favoritesError = "";
          });
          return;
        }

        favoritesState = await favoritesService.addFavorite({
          url: data.get("url"),
          backgroundColorSource: "auto"
        });
        const added = favoritesState.items.at(-1);

        if (added) {
          const autoColor = await resolveAutoBackgroundColor(added);

          if (autoColor !== added.backgroundColor) {
            favoritesState = await favoritesService.updateFavorite(added.id, {
              backgroundColor: autoColor,
              backgroundColorSource: "auto"
            });
          }
        }

        finishFavoritesAction(generation, () => {
          favoritesMode = "view";
          favoritesError = "";
        });
      } catch (error) {
        finishFavoritesAction(generation, () => {
          favoritesError = error instanceof Error ? error.message : String(error);
        });
      }
    })();
  });
}

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

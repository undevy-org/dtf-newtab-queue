import {
  extractImageBackgroundColor,
  fallbackColorForDomain,
  readableTextColor
} from "./favoriteColor.js";
import { getFavoriteIconModel, getFavoriteLetter } from "./favoriteIcon.js";
import {
  cancelForm,
  closeSettings,
  createInitialFavoritesUiState,
  editingId,
  isAdding,
  isFormOpen,
  isSettingsOpen,
  openSettings,
  startAdd,
  startEdit
} from "./favoritesUiState.js";
import { createFavoritesService } from "./favoritesService.js";
import { createFavoritesStore } from "./favoritesStore.js";
import { fetchNews } from "./dtfApi.js";
import { createQueueService } from "./queueService.js";
import { createInitialState, createQueueStore } from "./queueStore.js";

const app = document.querySelector("#app");
const favoritesRoot = document.querySelector("#favorites");
const favoritesPanelRoot = document.querySelector("#favorites-panel");
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
let favoritesUi = createInitialFavoritesUiState();
let favoritesError = "";
let favoritesBusy = false;
let favoritesGeneration = 0;
let pendingGearFocus = false;

function createFavoriteLetterNode(item, source) {
  const span = createNode("span", "favorite-letter", getFavoriteLetter(item));
  span.dataset.iconSource = source;
  return span;
}

function createFavoriteIconNode(model, item) {
  if (model.type === "image") {
    const image = createNode("img", "favorite-icon");
    image.src = model.src;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.dataset.iconSource = item.iconMode === "custom" ? "custom" : "favicon";
    image.addEventListener("error", () => {
      image.replaceWith(createFavoriteLetterNode(item, "letter"));
    });
    return image;
  }

  return createFavoriteLetterNode(item, "letter");
}

function createFavoriteTile(item) {
  const button = createNode("button", "favorite-tile");
  const iconModel = getFavoriteIconModel(item, { faviconBaseUrl });

  button.type = "button";
  button.dataset.favoriteAction = "open";
  button.dataset.favoriteId = item.id;
  button.title = item.label;
  button.setAttribute("aria-label", `Открыть ${item.label}`);
  button.style.setProperty("--favorite-bg", item.backgroundColor);
  button.appendChild(createFavoriteIconNode(iconModel, item));

  const tileDisabled = favoritesBusy || isFormOpen(favoritesUi);
  button.disabled = tileDisabled;
  button.setAttribute("aria-disabled", String(tileDisabled));
  return button;
}

function createFavoritesGear() {
  const gear = createNode("button", "favorite-settings", "⚙");
  gear.type = "button";
  gear.dataset.favoriteAction = "open-settings";
  gear.setAttribute("aria-label", "Настроить быстрые ссылки");
  gear.setAttribute("aria-expanded", String(isSettingsOpen(favoritesUi)));
  gear.setAttribute("aria-controls", "favorites-panel");
  gear.disabled = favoritesBusy;
  gear.setAttribute("aria-disabled", String(favoritesBusy));
  return gear;
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

async function refreshAutoAccent(id) {
  if (!favoritesService || !id) {
    return;
  }

  const item = favoritesState?.items.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  try {
    const autoColor = await resolveAutoBackgroundColor(item);
    if (autoColor === item.backgroundColor) {
      return;
    }

    const nextState = await favoritesService.updateFavorite(id, {
      backgroundColor: autoColor,
      backgroundColorSource: "auto"
    });

    favoritesState = nextState;
    renderFavorites();
  } catch {
    // Auto-accent is best-effort; a canvas/CORS failure keeps the fallback accent
    // and must never disturb the displayed icon.
  }
}

function createFavoritesPanelRow(item, index, itemCount) {
  const row = createNode("div", "favorites-panel__row");

  const info = createNode("div", "favorites-panel__item");
  info.appendChild(createFavoriteIconNode(getFavoriteIconModel(item, { faviconBaseUrl }), item));
  const text = createNode("div");
  text.appendChild(createNode("strong", null, item.label));
  text.appendChild(createNode("span", null, item.domain));
  info.appendChild(text);

  const controls = createNode("div", "favorites-panel__controls");
  const disabled = favoritesBusy || isFormOpen(favoritesUi);

  const left = createNode("button", "icon-button", "‹");
  left.type = "button";
  left.dataset.favoriteAction = "move-left";
  left.dataset.favoriteId = item.id;
  left.setAttribute("aria-label", `Сдвинуть ${item.label} влево`);
  left.disabled = disabled || index === 0;

  const right = createNode("button", "icon-button", "›");
  right.type = "button";
  right.dataset.favoriteAction = "move-right";
  right.dataset.favoriteId = item.id;
  right.setAttribute("aria-label", `Сдвинуть ${item.label} вправо`);
  right.disabled = disabled || index === itemCount - 1;

  const edit = createNode("button", "icon-button", "✎");
  edit.type = "button";
  edit.dataset.favoriteAction = "edit";
  edit.dataset.favoriteId = item.id;
  edit.setAttribute("aria-label", `Редактировать ${item.label}`);
  edit.disabled = disabled;

  controls.append(left, right, edit);
  row.append(info, controls);
  return row;
}

function renderFavoritesToolbar() {
  if (!favoritesRoot) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const items = favoritesState?.items ?? [];
  const list = createNode("div", "favorites-grid");

  for (const item of items) {
    list.appendChild(createFavoriteTile(item));
  }

  fragment.appendChild(list);
  fragment.appendChild(createFavoritesGear());
  favoritesRoot.replaceChildren(fragment);
}

function renderFavoritesPanel() {
  if (!favoritesPanelRoot) {
    return;
  }

  const open = isSettingsOpen(favoritesUi);
  favoritesPanelRoot.hidden = !open;

  if (!open) {
    favoritesPanelRoot.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  const items = favoritesState?.items ?? [];

  const top = createNode("div", "favorites-panel__top");
  const heading = createNode("div");
  heading.appendChild(createNode("h2", null, "Быстрые ссылки"));
  heading.appendChild(
    createNode("p", null, "Добавление, порядок, иконка и цвет — в одном месте.")
  );
  const addButton = createNode("button", "button button--primary", "Добавить ссылку");
  addButton.type = "button";
  addButton.dataset.favoriteAction = "start-add";
  addButton.disabled = favoritesBusy || isFormOpen(favoritesUi);
  top.append(heading, addButton);
  fragment.appendChild(top);

  if (isAdding(favoritesUi)) {
    fragment.appendChild(createAddForm());
  }

  const currentEditingId = editingId(favoritesUi);
  const editingItem = items.find((item) => item.id === currentEditingId);
  if (editingItem) {
    fragment.appendChild(createEditForm(editingItem));
  }

  const listWrap = createNode("div", "favorites-panel__list");
  items.forEach((item, index) => {
    listWrap.appendChild(createFavoritesPanelRow(item, index, items.length));
  });
  fragment.appendChild(listWrap);

  const footer = createNode("div", "favorites-panel__footer");
  const done = createNode("button", "button", "Готово");
  done.type = "button";
  done.dataset.favoriteAction = "close-settings";
  footer.appendChild(done);
  fragment.appendChild(footer);

  if (favoritesError) {
    fragment.appendChild(
      createStatus(favoritesError, { error: true, live: "assertive" })
    );
  }

  favoritesPanelRoot.replaceChildren(fragment);
}

function renderFavorites() {
  renderFavoritesToolbar();
  renderFavoritesPanel();

  if (pendingGearFocus) {
    pendingGearFocus = false;
    const gear = favoritesRoot?.querySelector('[data-favorite-action="open-settings"]');
    if (gear instanceof HTMLElement) {
      gear.focus();
    }
  }
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

  function handleFavoritesClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const target = event.target.closest("[data-favorite-action]");

    if (!(target instanceof HTMLElement) || favoritesBusy) {
      return;
    }

    const action = target.dataset.favoriteAction;

    if (action === "open-settings") {
      favoritesUi = openSettings(favoritesUi);
      favoritesError = "";
      renderFavorites();
    } else if (action === "close-settings") {
      favoritesUi = closeSettings(favoritesUi);
      favoritesError = "";
      pendingGearFocus = true;
      renderFavorites();
    } else if (action === "start-add") {
      favoritesUi = startAdd(favoritesUi);
      favoritesError = "";
      renderFavorites();
    } else if (action === "cancel") {
      favoritesUi = cancelForm(favoritesUi);
      favoritesError = "";
      renderFavorites();
    } else if (action === "edit") {
      const id = target.dataset.favoriteId;
      if (id) {
        favoritesUi = startEdit(favoritesUi, id);
        favoritesError = "";
        renderFavorites();
      }
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
            favoritesUi = cancelForm(favoritesUi);
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
  }

  favoritesRoot.addEventListener("click", handleFavoritesClick);
  favoritesPanelRoot?.addEventListener("click", handleFavoritesClick);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || favoritesBusy) {
      return;
    }

    if (isSettingsOpen(favoritesUi)) {
      favoritesUi = closeSettings(favoritesUi);
      favoritesError = "";
      pendingGearFocus = true;
      renderFavorites();
    }
  });

  favoritesPanelRoot?.addEventListener("submit", (event) => {
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

          finishFavoritesAction(generation, () => {
            favoritesUi = cancelForm(favoritesUi);
            favoritesError = "";
          });

          if (backgroundColorSource === "auto") {
            void refreshAutoAccent(form.dataset.favoriteId);
          }
          return;
        }

        favoritesState = await favoritesService.addFavorite({
          url: data.get("url"),
          backgroundColorSource: "auto"
        });
        const added = favoritesState.items.at(-1);

        finishFavoritesAction(generation, () => {
          favoritesUi = cancelForm(favoritesUi);
          favoritesError = "";
        });

        if (added) {
          void refreshAutoAccent(added.id);
        }
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

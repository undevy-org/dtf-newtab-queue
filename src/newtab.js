import {
  extractImageBackgroundColor,
  fallbackColorForDomain,
  hexToRgbChannels,
  normalizeAccentLightness
} from "./favoriteColor.js";
import { getFavoriteIconModel, getFavoriteLetter } from "./favoriteIcon.js";
import { createIconNode } from "./icons.js";
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
import { createFavoritesStore, migrateLegacyFavorites } from "./favoritesStore.js";
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
  const parts = [];

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
const localStorageArea = chromeApi?.storage?.local;
const syncStorageArea = chromeApi?.storage?.sync;
const faviconBaseUrl =
  typeof chromeApi?.runtime?.getURL === "function"
    ? chromeApi.runtime.getURL("/_favicon/")
    : "";

function hasStorageArea(area) {
  return area && typeof area.get === "function" && typeof area.set === "function";
}

const favoritesStore = hasStorageArea(syncStorageArea)
  ? createFavoritesStore(syncStorageArea)
  : null;

const favoritesService = favoritesStore
  ? createFavoritesService({
      store: favoritesStore,
      defaultBackgroundColor: fallbackColorForDomain
    })
  : null;

const service = hasStorageArea(localStorageArea)
  ? createQueueService({
      store: createQueueStore(localStorageArea),
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
  button.dataset.tileSize = item.tileSize === "wide" ? "wide" : "square";
  button.title = item.label;
  button.setAttribute("aria-label", `Открыть ${item.label}`);
  button.style.setProperty(
    "--favorite-accent-rgb",
    hexToRgbChannels(normalizeAccentLightness(item.backgroundColor))
  );
  button.appendChild(createFavoriteIconNode(iconModel, item));

  const tileDisabled = favoritesBusy || isFormOpen(favoritesUi);
  button.disabled = tileDisabled;
  button.setAttribute("aria-disabled", String(tileDisabled));
  return button;
}

function createFavoritesGear() {
  const gear = createNode("button", "favorite-settings");
  gear.type = "button";
  gear.dataset.favoriteAction = "open-settings";
  gear.setAttribute("aria-label", "Настроить быстрые ссылки");
  gear.setAttribute("aria-expanded", String(isSettingsOpen(favoritesUi)));
  gear.setAttribute("aria-controls", "favorites-panel");
  gear.disabled = favoritesBusy;
  gear.setAttribute("aria-disabled", String(favoritesBusy));
  gear.appendChild(createIconNode("settings", { size: 20 }));
  return gear;
}

function createSegmentedControl(name, options, selectedValue) {
  const group = createNode("div", "segmented");
  group.setAttribute("role", "radiogroup");

  for (const [value, text] of options) {
    const option = createNode("label", "segmented__option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = value === selectedValue;
    option.appendChild(input);
    option.appendChild(createNode("span", null, text));
    group.appendChild(option);
  }

  return group;
}

let formRowIdSeq = 0;

function createFormRow(labelText, control) {
  const row = createNode("div", "favorite-form__row");
  const labelSpan = createNode("span", "favorite-form__row-label", labelText);
  labelSpan.id = `favorite-form-row-label-${formRowIdSeq++}`;
  row.append(labelSpan, control);

  const labelTarget =
    control.tagName === "INPUT" || control.getAttribute("role") === "radiogroup"
      ? control
      : control.querySelector('input, [role="radiogroup"]');
  labelTarget?.setAttribute("aria-labelledby", labelSpan.id);

  return row;
}

function createIconButton(className, text, iconName) {
  const button = createNode("button", className);
  button.append(createIconNode(iconName), document.createTextNode(text));
  return button;
}

function createFavoriteForm(item) {
  const isEdit = item !== null;
  const form = createNode("form", "favorite-form");
  form.dataset.favoriteForm = isEdit ? "edit" : "add";
  if (isEdit) {
    form.dataset.favoriteId = item.id;
  }

  const url = createNode("input", "favorite-input");
  url.name = "url";
  url.type = "text";
  url.inputMode = "url";
  url.value = isEdit ? item.url : "";
  url.placeholder = "https://example.com";
  url.required = true;
  url.autocomplete = "url";

  const label = createNode("input", "favorite-input");
  label.name = "label";
  label.type = "text";
  label.value = isEdit ? item.label : "";
  label.placeholder = isEdit ? item.domain : "Необязательно";

  const iconMode = createSegmentedControl(
    "iconMode",
    [
      ["favicon", "С сайта"],
      ["letter", "Буква"],
      ["custom", "Своя"]
    ],
    isEdit ? item.iconMode : "favicon"
  );

  const customIconUrl = createNode("input", "favorite-input");
  customIconUrl.name = "customIconUrl";
  customIconUrl.type = "text";
  customIconUrl.inputMode = "url";
  customIconUrl.value = isEdit ? item.customIconUrl ?? "" : "";
  customIconUrl.placeholder = "https://example.com/icon.png";
  const customIconRow = createFormRow("Своя иконка", customIconUrl);
  customIconRow.classList.add("favorite-form__row--custom-icon");

  const backgroundColorSource = createSegmentedControl(
    "backgroundColorSource",
    [
      ["auto", "Авто"],
      ["manual", "Вручную"]
    ],
    isEdit ? item.backgroundColorSource : "auto"
  );

  const color = createNode("input", "favorite-color-input");
  color.name = "backgroundColor";
  color.type = "color";
  color.value = isEdit ? item.backgroundColor : "#24292f";

  const colorControls = createNode("div", "favorite-form__color-controls");
  colorControls.append(backgroundColorSource, color);
  const colorRow = createFormRow("Цвет", colorControls);

  const tileSize = createSegmentedControl(
    "tileSize",
    [
      ["square", "Квадрат"],
      ["wide", "Широкая 2:1"]
    ],
    isEdit ? item.tileSize ?? "square" : "square"
  );

  const footer = createNode("div", "favorite-form__footer");

  if (isEdit) {
    const remove = createIconButton("button button--danger", "Удалить", "trash2");
    remove.type = "button";
    remove.dataset.favoriteAction = "delete";
    remove.dataset.favoriteId = item.id;
    remove.disabled = favoritesBusy;
    footer.appendChild(remove);
  }

  const cancel = createIconButton("button", "Отмена", "x");
  cancel.type = "button";
  cancel.dataset.favoriteAction = "cancel";
  cancel.disabled = favoritesBusy;

  const save = createIconButton(
    "button button--primary",
    isEdit ? "Сохранить" : "Добавить",
    "check"
  );
  save.type = "submit";
  save.disabled = favoritesBusy;

  footer.append(cancel, save);

  form.append(
    createFormRow("Ссылка", url),
    createFormRow("Название", label),
    createFormRow("Иконка", iconMode),
    customIconRow,
    colorRow,
    createFormRow("Размер плашки", tileSize),
    footer
  );

  return form;
}

function readFavoriteFormPayload(data) {
  const backgroundColorSource =
    data.get("backgroundColorSource") === "manual" ? "manual" : "auto";
  const payload = {
    url: data.get("url"),
    label: data.get("label"),
    iconMode: data.get("iconMode"),
    customIconUrl: data.get("customIconUrl"),
    backgroundColorSource,
    tileSize: data.get("tileSize") === "wide" ? "wide" : "square"
  };

  if (backgroundColorSource === "manual") {
    payload.backgroundColor = data.get("backgroundColor");
  }

  return payload;
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

  if (!iconModel.sampleable) {
    return fallback;
  }

  return (
    (await extractImageBackgroundColor(iconModel.src, {
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

    // Re-read the item after the async resolve: the user may have switched it to
    // manual (or deleted it) while the favicon was being fetched/analyzed. A late
    // auto write must never clobber a manual color the user just chose.
    const current = favoritesState?.items.find((entry) => entry.id === id);
    if (!current || current.backgroundColorSource !== "auto") {
      return;
    }

    if (autoColor === current.backgroundColor) {
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

  const left = createNode("button", "icon-button");
  left.type = "button";
  left.dataset.favoriteAction = "move-left";
  left.dataset.favoriteId = item.id;
  left.setAttribute("aria-label", `Сдвинуть ${item.label} влево`);
  left.disabled = disabled || index === 0;
  left.appendChild(createIconNode("chevronLeft"));

  const right = createNode("button", "icon-button");
  right.type = "button";
  right.dataset.favoriteAction = "move-right";
  right.dataset.favoriteId = item.id;
  right.setAttribute("aria-label", `Сдвинуть ${item.label} вправо`);
  right.disabled = disabled || index === itemCount - 1;
  right.appendChild(createIconNode("chevronRight"));

  const edit = createNode("button", "icon-button");
  edit.type = "button";
  edit.dataset.favoriteAction = "edit";
  edit.dataset.favoriteId = item.id;
  edit.setAttribute("aria-label", `Редактировать ${item.label}`);
  edit.disabled = disabled;
  edit.appendChild(createIconNode("pencil"));

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

  if (items.length > 0) {
    const list = createNode("div", "favorites-grid");
    for (const item of items) {
      list.appendChild(createFavoriteTile(item));
    }
    fragment.appendChild(list);
  }

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
  const addButton = createIconButton("button button--primary", "Добавить ссылку", "plus");
  addButton.type = "button";
  addButton.dataset.favoriteAction = "start-add";
  addButton.disabled = favoritesBusy || isFormOpen(favoritesUi);
  top.append(heading, addButton);
  fragment.appendChild(top);

  if (isAdding(favoritesUi)) {
    fragment.appendChild(createFavoriteForm(null));
  }

  const currentEditingId = editingId(favoritesUi);
  const editingItem = items.find((item) => item.id === currentEditingId);
  if (editingItem) {
    fragment.appendChild(createFavoriteForm(editingItem));
  }

  const listWrap = createNode("div", "favorites-panel__list");
  items.forEach((item, index) => {
    listWrap.appendChild(createFavoritesPanelRow(item, index, items.length));
  });
  fragment.appendChild(listWrap);

  const footer = createNode("div", "favorites-panel__footer");
  const done = createIconButton("button", "Готово", "check");
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

    if (hasStorageArea(localStorageArea)) {
      try {
        await migrateLegacyFavorites(localStorageArea, favoritesStore);
      } catch (error) {
        favoritesError = error instanceof Error ? error.message : String(error);
      }
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

  document.addEventListener("pointerdown", (event) => {
    if (!isSettingsOpen(favoritesUi) || favoritesBusy) {
      return;
    }

    if (!(event.target instanceof Node)) {
      return;
    }

    if (
      favoritesPanelRoot?.contains(event.target) ||
      favoritesRoot?.contains(event.target)
    ) {
      return;
    }

    favoritesUi = closeSettings(favoritesUi);
    favoritesError = "";
    pendingGearFocus = true;
    renderFavorites();
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
          const payload = readFavoriteFormPayload(data);
          favoritesState = await favoritesService.updateFavorite(
            form.dataset.favoriteId,
            payload
          );

          finishFavoritesAction(generation, () => {
            favoritesUi = cancelForm(favoritesUi);
            favoritesError = "";
          });

          if (payload.backgroundColorSource === "auto") {
            void refreshAutoAccent(form.dataset.favoriteId);
          }
          return;
        }

        const payload = readFavoriteFormPayload(data);
        favoritesState = await favoritesService.addFavorite(payload);
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

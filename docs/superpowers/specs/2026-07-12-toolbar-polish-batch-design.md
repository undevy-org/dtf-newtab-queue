# Design: Toolbar & Form Polish Batch

Date: 2026-07-12
Status: approved by user, ready for implementation planning.

## Goal

A batch of eight small, mostly-independent UI/UX fixes to the pinned favorites
toolbar and the DTF news card, gathered so an agent (or a chain of agents) can
work through them sequentially in one pass. None of these touch the DTF queue
logic (`queueService.js`, `queueStore.js`, `dtfApi.js`) or the favorites
mutation logic beyond adding one new field.

## Scope (the eight items)

1. Favorite tiles get a user-chosen aspect ratio: square (1:1, current) or
   wide (2:1).
2. The settings gear button matches the square tile's exact box size.
3. The blue accent color across the UI becomes black (light theme) / white
   (dark theme).
4. Every glyph-as-icon (⚙ ‹ › ✎) and every icon-less text button becomes a
   real SVG icon, vendored locally from Lucide — no new runtime dependency.
5. The settings panel renders above the toolbar in stacking order (currently
   it renders below it).
6. The literal string "DTF" is removed from the news card everywhere it
   appears.
7. The toolbar's width becomes content-driven (hugs its tiles) instead of a
   fixed width, up to the existing viewport-based cap, beyond which the
   existing horizontal scroll takes over.
8. The add/edit favorite form is redesigned from an unlabeled flat list of
   inputs into a labeled, structured layout, and is unified into one
   component (add and edit are currently two separate, diverging render
   functions).

Items 1 and 8 are coupled (the tile-size control lives inside the redesigned
form) and should land together. The rest are independent and can be done in
any order.

## 1 & 7. Data model and toolbar/tile rendering

### New field: `tileSize`

`src/favoritesShared.js` gains:

```js
export const TILE_SIZES = new Set(["square", "wide"]);
```

`src/favoritesStore.js`: `tileSize` is validated **if present** (must be a
member of `TILE_SIZES`) but is **not** added to `isFavoriteItem`'s
`requiredFields`, and `FAVORITES_VERSION` stays `1`. This is a deliberate,
additive, backward-compatible schema change — favorites saved before this
feature simply lack the field and are treated as `"square"` at render time.
No migration, no version bump.

`src/favoritesService.js`:
- `addFavorite`: always sets `tileSize` on the created item, defaulting to
  `"square"` when the caller didn't pass one.
- `updateFavorite`: sets `tileSize` when the payload includes it (same
  pattern as the other optional fields already handled there).

### Tile rendering (`newtab.js` / `newtab.css`)

Both tile shapes get an explicit, fixed width instead of the current
content/padding-driven auto width:

- `square`: `width: var(--favorite-tile-height)` (52×52).
- `wide`: `width: calc(var(--favorite-tile-height) * 2)` (104×52 — exactly
  2:1).

The icon inside stays 26×26, centered, unchanged in both shapes — a wide
tile is a wider box around the same icon, no label, no icon resize. Missing
`tileSize` on legacy items renders as `square` (matches current visual
behavior exactly, so this is a no-op for existing users until they touch a
favorite).

### Settings gear sizing

`.favorite-settings` changes from 44×44 / 12px radius to 52×52 / 13px
radius — the same box as a square tile. It stays visually neutral (panel
background, plain border) — no per-site accent color is applied to it; only
its dimensions change to stop it looking like a mismatched, smaller control
next to the tiles.

### Flexible toolbar width

`.favorites-bar` changes from a fixed `width: min(920px, calc(100vw - 32px))`
to:

```css
width: fit-content;
max-width: min(920px, calc(100vw - 32px));
```

The bar hugs its content (tile row + gear) and only grows up to the existing
cap; beyond that, the existing `.favorites-grid { overflow-x: auto }`
horizontal scroll takes over exactly as it does today. The mobile media
query's separate `width: calc(100vw - 20px)` override is updated to the same
`fit-content` + `max-width` pattern for consistency.

## 8 (with 1 and 4). Unified favorite form

`createAddForm()` and `createEditForm()` are merged into a single
`createFavoriteForm(item)`:
- `item === null` → add mode: empty URL, empty label, defaults
  `iconMode: "favicon"`, `backgroundColorSource: "auto"`, `tileSize:
  "square"`; no delete button; primary submit reads "Добавить".
- `item` provided → edit mode: current values pre-filled (as today); delete
  button present; primary submit reads "Сохранить".

This also resolves an existing inconsistency where add-mode only exposed a
URL field and everything else (icon, color, and now size) could only be set
via a follow-up edit — tile size must be choosable at creation time per
item 1, so the two forms converge on the same field set.

### Layout: dense list-rows

Chosen over a sectioned/grouped-card layout after a visual comparison (see
`.superpowers/brainstorm/870-1783832731/content/edit-form-layout.html`,
option B). Each field is one row: a fixed-width label (~90–100px) on the
left, its control on the right, rows separated by a thin top border. No
section headings.

Rows, top to bottom:

1. **Ссылка** — URL text input (unchanged behavior).
2. **Название** — text input. Placeholder is the item's domain in edit mode
   (as today); in add mode, a generic "необязательно" placeholder (live
   domain-from-URL preview as the user types is explicitly out of scope).
3. **Иконка** — a 3-way segmented control (С сайта / Буква / Своя) replacing
   the current bare `<select>`. Selecting "Своя" reveals an additional row
   below with the custom icon URL input (same conditional-visibility pattern
   already used for the color swatch).
4. **Цвет** — a 2-way segmented control (Авто / Вручную) plus the color
   swatch in the same row, interactive only when "Вручную" is selected
   (same enable/disable behavior as today).
5. **Размер плашки** — new row, 2-way segmented control (Квадрат / Широкая
   2:1). This is the UI for item 1.
6. A divider, then the action row: **Удалить** (danger, edit-mode only,
   pushed to the left via margin) — **Отмена** — **Добавить/Сохранить**
   (primary, right-aligned).

Segmented controls are implemented as grouped native `<input type="radio">`
+ `<label>` pairs styled as a pill, not `<div onclick>` — this keeps native
keyboard navigation and the existing `:focus-visible` styling that already
applies to other form controls, rather than reinventing it.

Every button gets a leading icon (decorative, `aria-hidden`, doesn't change
the button's accessible name since the visible text stays): Добавить/
Сохранить → `check`, Отмена → `x`, Удалить → `trash2`. The "Добавить ссылку"
button that opens this form from the panel's top gets a `plus` icon, and the
panel's "Готово" (close) button gets a `check` icon.

## 4. Icon system

No new runtime dependency is added — this repo has no bundler, `newtab.js`
loads as a plain ES module directly in the browser, so an `import "lucide"`
bare specifier has nothing to resolve against without introducing a build
step, which is disproportionate to swapping eight glyphs for SVGs. A prior
plan for this same toolbar already established "no new runtime
dependencies" as a hard constraint; this keeps it.

New module `src/icons.js`: hand-copied SVG markup for the specific Lucide
icons needed, as string constants, with a short attribution comment
(Lucide, permissive license — confirm exact license text when
implementing). Plus a small helper:

```js
export function createIconNode(name, { size = 18 } = {}) { ... }
```

Returns a `<span class="icon" aria-hidden="true">` wrapping the SVG, sized
via width/height attributes, `stroke="currentColor"` so it inherits the
button's text color automatically (including the danger-red delete button
and the dark/light theme swap of the primary button's text color — see
below). The SVG markup is a static, hardcoded string authored into the
source, not runtime/user data, so building the node via `innerHTML` carries
no injection risk.

Icons needed and where they land:

| Icon | Replaces | Location |
|---|---|---|
| `settings` | `⚙` | toolbar gear |
| `chevronLeft` / `chevronRight` | `‹` `›` | panel row reorder buttons |
| `pencil` | `✎` | panel row edit button |
| `plus` | (text only) | "Добавить ссылку" panel button |
| `check` | (text only) | form submit, panel "Готово" |
| `x` | (text only) | form cancel |
| `trash2` | (text only) | form delete |

Buttons that already carry an `aria-label` (gear, chevrons, pencil) are
unaffected accessibility-wise by the glyph swap. Buttons with visible text
keep that text as their accessible name; the icon is purely decorative.

## 3. Accent color: black ⇄ white

`newtab.css` variable changes:

| Variable | Light (before → after) | Dark (before → after) |
|---|---|---|
| `--primary` | `#1473e6` → `#111318` | `#4d9aff` → `#f4f6f8` |
| `--primary-hover` | `#0f63c7` → `#2a2d33` | `#6aabff` → `#d9dce0` |
| `--focus` | `rgb(20 115 230 / 24%)` → `rgb(0 0 0 / 24%)` | `rgb(77 154 255 / 28%)` → `rgb(255 255 255 / 28%)` |

`--danger` (the delete button's red) is untouched — it's a semantic
destructive-action color, not part of the brand accent.

One non-mechanical change is required: `.button--primary` currently
hardcodes `color: #fff` regardless of theme, which worked while the button's
background was blue in both themes. Once the dark-theme background becomes
white, white-on-white text would be invisible. A new variable
`--primary-contrast` is introduced (`#ffffff` light / `#14171c` dark) and
`.button--primary` uses it instead of the hardcoded `#fff`. Every other
accent usage (`border-color: var(--primary)` on the gear's expanded state,
focus rings) only needs the variable value swap, no logic change.

The per-favorite accent tile color (`--favorite-accent-rgb`, user-chosen per
bookmark) is a separate concept and is out of scope here — this section only
covers the UI chrome accent (buttons, focus rings, gear's active border).

## 5 & 6. Small fixes

**Z-index.** `.favorites-panel` changes from `z-index: 20` to `z-index: 40`
(above the toolbar's `z-index: 30`, which is left unchanged).

**Remove "DTF".** Three removal points:
1. `<p class="eyebrow">DTF</p>` emitted by `renderShell()` in `newtab.js`.
2. The same markup in the static `newtab.html` pre-render fallback (the
   "Загружаю новость..." shell shown before the first JS render) — removing
   only the JS-rendered copy would leave a flash of "DTF" before hydration.
3. The `"DTF"` seed value in `buildMeta()`'s `parts` array — the meta line
   becomes `"дата · В очереди: N"` (or renders nothing, per existing
   behavior, if both are empty).

The now-unused `.eyebrow` CSS rule is deleted as part of this change
(matches this repo's existing practice of not leaving dead CSS behind after
a change removes its last use).

## Out of scope

- Any change to DTF queue fetching/paging logic.
- Live URL-to-domain preview while typing in the add form.
- Migrating/bumping `FAVORITES_VERSION`.
- Changing the per-favorite accent color feature (`backgroundColor` /
  `--favorite-accent-rgb`).
- Adding a real npm/build dependency for icons.

## Testing

Existing coverage that needs updating rather than new coverage being
invented:
- `favoritesStore`/`favoritesService` tests: add `tileSize` validation and
  default-on-create/update cases.
- The source-regex test(s) covering `newtab.js` DOM structure (panel rows,
  form fields, button dataset actions) need updating for the merged form,
  new rows, and icon nodes.
- A small smoke test for `src/icons.js` (each exported icon name resolves to
  a non-empty string of SVG path/circle markup — the `<svg>` wrapper is
  assembled at runtime by `createIconNode`, so `ICON_PATHS` holds only the
  inner `<path>`/`<circle>` markup).
- Manual browser matrix (this repo's established pattern for anything
  touching favicon/color/layout): empty state, few tiles vs many (scroll
  cutover), square vs wide tiles, add vs edit form, light vs dark theme,
  mobile width.

Exact task breakdown and file-by-file sequencing is left to the
implementation plan.

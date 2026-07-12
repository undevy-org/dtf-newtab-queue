# Design: Milestone-State Icons (Fill the Empty Title Reservation)

Date: 2026-07-12
Status: approved by user, ready for implementation planning.

## Goal

The news card (`.panel` in `newtab.js`/`newtab.css`) was locked to one
constant height across every app state (see
[`2026-07-12-stable-news-card-height-design.md`](2026-07-12-stable-news-card-height-design.md)),
via a `.title` that always reserves exactly 3 lines of vertical space
(`min-height: calc(1.22em * 3)`) regardless of how long the actual title
text is. That fix is correct and shipped, but it exposed a follow-on visual
problem: the three "informational" states — `renderLoading`,
`renderFork` ("Вы прочитали всё свежее"), `renderArchiveEnded` ("Вы
прочитали всё, включая архив") — always render a short, single-line,
static UI string as their title, never a real (often multi-line) DTF
headline. Reserving 3 lines for a 1-line string leaves a large, awkward
blank rectangle between the title text and the content below it (see the
screenshot that prompted this design). Fix it by giving these three states
a themed icon badge that fills that reserved space intentionally, instead
of leaving it blank — without changing `.panel`'s fixed height or touching
any of the tested CSS/JS from the prior plan.

## Problem

`renderCard` (the actual news card) shows real DTF headlines — average 84
characters, wrapping to 2–3 lines most of the time — so the 3-line
reservation is usually filled with real text. `renderLoading` /
`renderFork` / `renderArchiveEnded` show fixed, short, single-line
strings instead ("Загружаю новость...", "Вы прочитали всё свежее", "Вы
прочитали всё, включая архив"). For these three, the reservation is
*always* mostly empty — not an occasional edge case like a short real
headline, but the permanent, guaranteed shape of every render in these
states.

## Decision: a centered icon badge above the title, only for these 3 states

Real news-card titles (`renderCard`) are completely untouched by this
design — `.title`, `createTitleNode`, `attachTruncatedTitlePopover`, and
their tests from the prior plan keep working exactly as built. The new
treatment applies only when `renderShell` is called with an `icon`
option, which only `renderLoading` / `renderFork` / `renderArchiveEnded`
do.

Three layout directions were mocked up at real card dimensions (680px /
282px, live in a browser via the brainstorming visual companion) and
compared with real copy for all three states: icon left of the title
(horizontal lockup), icon above the title with both centered, and the
same centered layout with the icon sitting inside a soft circular badge.
**The circular badge, centered above the title,** was the one selected —
it reads as a deliberate "milestone reached" moment rather than a
smaller/awkward version of the same blank-space problem, and stays
inside the extension's existing monochrome visual language (no new
color, no new dependency).

## 1. Markup and CSS

New elements, additive only — nothing below is applied to the real
news-card path:

```css
.title-wrap--milestone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 26px; /* must match .title's own font-size: see "Height budget" below */
  min-height: calc(1.22em * 3);
  text-align: center;
}

.milestone-badge {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--bg);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}

.milestone-title {
  margin: 0;
  font-size: 26px;
  line-height: 1.22;
  font-weight: 700;
}
```

`.milestone-title` deliberately does **not** reuse the `.title` class —
it needs the same look (font-size/line-height/weight) but none of
`.title`'s line-clamp/`min-height`/`aria-label` machinery, since a
milestone string is always one line and never truncates. `meta` /
`actions` / `status` below the milestone header are unaffected — they
stay left-aligned exactly as they render today; only the title row's
internal layout changes.

Mobile (`@media (max-width: 600px)`, mirroring `.title`'s own mobile
override): `.title-wrap--milestone` and `.milestone-title` both drop to
`font-size: 22px`, keeping the `em`-based `min-height` calculation
correct at the smaller breakpoint (see "Height budget" below for why this
matters).

## 2. Icons and the loading spinner

Two new entries in `src/icons.js`'s vendored Lucide set (same format and
license note as the existing 8 icons — `check` is reused as-is, no
change needed there):

- `checkCheck` (archive-ended — "even more thoroughly done" than a single
  check): `<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>`
- `loaderCircle` (loading): `<path d="M21 12a9 9 0 1 1-6.219-8.56"/>` — an
  open ~270° arc, the standard shape for a rotating spinner.

`createIconNode(name, { size, className })` gains an optional
`className` param (generic — icons.js stays unaware of what "spin" means;
that's newtab.css's concern) so the loading state can attach a modifier
class to just its own icon instance:

```css
.icon--spin {
  animation: milestone-spin 0.9s linear infinite;
  transform-origin: center;
}

@keyframes milestone-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .icon--spin {
    animation: none;
  }
}
```

The `prefers-reduced-motion` override is required, not optional — this is
an infinite CSS animation, and the extension has no other animation
today that needed this consideration.

State → icon mapping:

| State | Icon | Spin |
|---|---|---|
| `renderFork` ("Вы прочитали всё свежее") | `check` | no |
| `renderArchiveEnded` ("...включая архив") | `checkCheck` | no |
| `renderLoading` ("Загружаю новость...") | `loaderCircle` | yes |

## 3. `newtab.js` integration (non-invasive)

```js
function createMilestoneTitleNode(title, iconName, { spin = false } = {}) {
  const titleWrap = createNode("div", "title-wrap title-wrap--milestone");
  const badge = createNode("div", "milestone-badge");
  badge.appendChild(
    createIconNode(iconName, { size: 24, className: spin ? "icon--spin" : "" })
  );
  const titleNode = createNode("h1", "milestone-title", title);
  titleWrap.append(badge, titleNode);
  return titleWrap;
}
```

`renderShell` gains one new optional option, `icon` (and `iconSpin`,
default `false`):

```js
function renderShell({
  title,
  meta = "",
  status = null,
  error = null,
  actions = [],
  icon = null,
  iconSpin = false
}) {
  if (!app) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let titleNode = null;

  if (icon) {
    fragment.appendChild(createMilestoneTitleNode(title, icon, { spin: iconSpin }));
  } else {
    const created = createTitleNode(title);
    fragment.appendChild(created.titleWrap);
    titleNode = created.titleNode;
  }

  // ...meta / actions / status / error unchanged...

  app.replaceChildren(fragment);
  app.setAttribute("aria-busy", String(busy));

  if (titleNode) {
    attachTruncatedTitlePopover(titleNode, title);
  }
}
```

When `icon` is omitted (the `renderCard` path, unchanged), behavior is
byte-for-byte identical to today: `createTitleNode` /
`attachTruncatedTitlePopover` still run exactly as the prior plan built
and tested them. `renderLoading` / `renderFork` / `renderArchiveEnded`
each add one argument to their existing `renderShell(...)` call
(`icon: "check"`, `icon: "checkCheck"`, `icon: "loaderCircle", iconSpin:
true` respectively) — no other change to those three functions.

## Height budget: why `.panel`'s fixed height doesn't need to change

The prior plan's `.panel` height (282px desktop / 356px mobile) was
measured against the worst-case *real* content sum: padding + the 3-line
title reservation + row gaps + meta + actions + status. This design
reuses that exact same title-row budget — it does not add a new row or
grow an existing one:

- Old title row: 3-line reserved box, ~95px (desktop: `1.22 × 26px × 3`).
- New milestone header: badge (52px) + gap (10px) + one-line title
  (~32px) ≈ 94px — matches the old reservation almost exactly.

This is why `.title-wrap--milestone` must declare its own `font-size:
26px` (`22px` on mobile) rather than inheriting: `min-height: calc(1.22em
* 3)` needs the same `em` basis `.title` used, or the reserved height
would silently drift from what the panel's fixed height was measured
against. Because the row's total footprint is unchanged, no re-measurement
of the 282px/356px constants (or the Measurement Methodology behind them)
is needed.

## Out of scope

- Any change to `.panel`'s fixed height, width, or the real news-card
  title path (`.title`, `createTitleNode`, `attachTruncatedTitlePopover`).
- Re-checking icon/spinner state on window resize — it's static per
  render, same as everything else in `renderShell`.
- New color tokens — the badge reuses `var(--bg)` / `var(--border)` /
  `var(--muted)`, already defined for both light and dark theme.
- Any icon/animation on the real news card itself.

## Coordination note

A separate, concurrently-running session is implementing the weather
widget plan on this same `main` branch (no worktree isolation). It has
not touched `src/newtab.js` / `src/newtab.css` yet as of this writing,
but its own plan says it eventually will (the weather widget shares the
news card's fixed-height treatment). Whoever implements this design
should re-check `git log` / `git status` immediately before editing
those two files, and re-resolve line numbers if anything landed in the
meantime — don't assume the file state described here is still current.

## Testing

Same constraint as the prior plan: no DOM/jsdom in this repo's test
runner, so `npm test` verifies everything checkable from source text
only (`test/newtabSource.test.js`'s established pattern), plus a manual
browser pass for anything visual:

- `test/icons.test.js`: add `"checkCheck"` and `"loaderCircle"` to the
  existing `ICON_NAMES` list (the file already asserts every name in that
  list has valid `<path|circle>` markup).
- `test/newtabSource.test.js`:
  - `.title-wrap--milestone`, `.milestone-badge`, `.milestone-title`,
    `@keyframes milestone-spin`, and `.icon--spin`'s animation rule exist
    with the exact properties above.
  - The `prefers-reduced-motion: reduce` block exists and sets
    `animation: none` on `.icon--spin`.
  - `createMilestoneTitleNode` exists with the signature above.
  - `renderFork` / `renderArchiveEnded` / `renderLoading` each actually
    pass the mapped `icon` (and `iconSpin` where applicable) into their
    `renderShell(...)` call — not just that the icon exists somewhere in
    the file. (The prior plan's task review flagged exactly this class of
    gap — asserting a helper exists without asserting it's wired in — as
    a minor, non-blocking finding; closing it here instead of repeating
    it.)
- Manual matrix (real Chrome, per this repo's established
  browser-verification pattern):
  - Badge and title are centered as designed, in all three states, at
    both the desktop width and the ≤600px mobile breakpoint.
  - `.panel`'s height is still 282px/356px (unchanged) in all three
    states — the milestone header doesn't push the card taller or leave
    a new gap.
  - The loading state's icon visibly rotates; toggling "reduce motion" in
    system accessibility settings freezes it.
  - Light and dark theme: the badge's circular background
    (`var(--bg)`) reads as a subtle, visible ring against `.panel`
    (`var(--panel)`) in both.

Exact task breakdown and file-by-file sequencing is left to the
implementation plan.

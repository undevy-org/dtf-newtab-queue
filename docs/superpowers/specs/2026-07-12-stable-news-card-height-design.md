# Design: Stable News-Card Height (No Layout Jump)

Date: 2026-07-12
Status: approved by user, ready for implementation planning.

## Goal

The news card (`.panel` in `newtab.js`/`newtab.css`) visibly grows and
shrinks every time it re-renders — most noticeably on the DTF headline's
length, but also across the different app states (loading, active card,
"read everything fresh" fork, "read everything including archive" end).
Fix it so the card is **exactly one constant height, always**, regardless
of which state is showing or how long the current title is.

## Problem

`.panel` is a CSS grid with no explicit height — its size is the sum of
whatever children happen to be rendered inside it:

- `renderLoading()`: title + status only.
- `renderCard()`: title + meta + 2 action buttons.
- `renderArchiveEnded()` / `renderFork()`: title + meta + 2–3 action
  buttons.

The title (`<h1 class="title">`) has no line limit today, so its own
height alone already varies a lot. Real data confirms this: 100 titles
sampled live from DTF's public news API (`api.dtf.ru/v2.10/news`) came out
to min 18 / avg 84.3 / max 141 characters — at the card's current width
(680px, 26px bold), that's anywhere from 1 to 6+ wrapped lines depending
purely on text length, with no upper bound.

Combined, every transition — a new card loading in, clicking through the
queue, hitting the end of the queue — visibly resizes the box. This is the
layout jump the user is fixing.

## Decision: the whole panel is fixed to one constant height, in every state

Not just the active-card title jump — `renderLoading`, `renderCard`,
`renderArchiveEnded`, and `renderFork` all get the identical panel
footprint. Shorter states simply leave blank space at the bottom rather
than shrinking the box; this trade-off (accepted explicitly) is the price
of a true zero-jump guarantee.

## 1. Title gets a fixed 3-line reservation

```css
.title {
  min-height: calc(1.22em * 3);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

The title box is always exactly 3 lines tall — a 1-line title doesn't
shrink it, a 6-line title gets truncated with an ellipsis rather than
growing it.

**Why 3 lines, and why no width change.** Measured against the same
100-title real sample, rendered at the card's current, *unchanged* width
(680px):

| Reserved lines | Panel width | Titles truncated |
|---|---|---|
| 2 | 680px (current) | 45% |
| 2 | 920px | 9% |
| 2 | 960px | 5% |
| **3** | **680px (current)** | **4%** |
| 3 | 720px+ | 0% |

Widening the panel was explored as a way to make a 2-line reservation
viable (it would need to grow to ~900–960px to get truncation down to a
tolerable rate), but became unnecessary once 3 lines was chosen: 3 lines
at the *current* 680px width already truncates only the most extreme
outliers (4/100 sampled, all 122–141 characters long) — good enough to
leave the card's width untouched. The truncated case is handled by the
popover in section 3, and the full headline is always one click away on
DTF itself regardless.

## 2. Panel gets an explicit fixed height (pure CSS, no `newtab.js` changes)

```css
.panel {
  height: <worst-case content sum, computed per breakpoint — see below>;
  align-content: start;
  overflow: hidden;
}
```

- `height` (not `min-height`) replaces the current auto-sizing. `overflow:
  hidden` is a safety clamp, not the primary mechanism — the height itself
  is computed to fit the worst case, so this should not visibly clip
  anything in normal operation.
- `align-content: start` keeps rows anchored to the top of the box; any
  leftover space (a state with fewer/shorter children than the worst case)
  appears as blank space below the content, not as vertical centering or
  stretching.
- The height is the sum of: padding + the 3-line title block (section 1) +
  row gaps + the meta line + the action-button row + the status line —
  i.e. the tallest any real state can get, not the tallest any *one*
  state's own content is today.
- **Actions row**, specifically: the fork state has 3 buttons, every other
  state has 2. On desktop the row doesn't wrap (`display: flex; flex-wrap:
  wrap` with room to spare at 680px), so 2 vs 3 buttons is already the same
  single-row height — no special handling needed there. On the ≤600px
  mobile breakpoint, actions stack in a column (`flex-direction: column`),
  so 3 buttons is taller than 2; the reserved height must assume the
  3-button case, and 2-button states leave a blank gap at the bottom of the
  actions area on mobile. Accepted, per the "always one height" decision.
- Two separate fixed-height constants are needed — one for the desktop
  layout, one for the `@media (max-width: 600px)` block — since padding,
  title `font-size`, and the actions layout all differ there already.
- **Exact pixel values are not pinned in this spec.** They're measured
  live in a real browser during implementation and hand-tuned against the
  actual rendered rows (this repo has no DOM/jsdom test environment — see
  Testing). This is a one-time tuning pass, not an ongoing maintenance
  burden; it only needs revisiting if the row structure itself changes.
- No changes to `newtab.js`'s render functions are required for this part.
  Every state already conditionally appends whatever subset of children it
  needs (`renderShell`'s existing `if (meta)` / `if (actions.length > 0)` /
  `if (status)` / `if (error)` branches); fixing the *container's* height
  is sufficient regardless of which children exist inside it on a given
  render.

## 3. Hover/focus popover for truncated titles

Only titles that actually clamp (the rare >3-line outlier from section 1)
get a popover — untouched titles get no new markup, no `tabindex`, nothing.

- After the title node is in the DOM (`renderShell` already rebuilds it via
  `app.replaceChildren(fragment)` on every render), check `titleNode.
  scrollHeight > titleNode.clientHeight`.
- If truncated:
  - add `tabindex="0"` so it's reachable by keyboard, not just mouse hover;
  - attach a custom popover element, shown on `:hover` and `:focus-visible`
    — not the native `title` attribute, so it appears instantly (no ~1s
    OS tooltip delay) and can be themed.
  - Popover styling matches the panel's own visual language: `background:
    var(--panel)`, `border: 1px solid var(--border)`, `color: var(--text)`,
    the same box-shadow language as `.panel`, positioned below the title,
    following light/dark theme automatically via the existing CSS
    variables.
- The `<h1>` always gets `aria-label` set to the full, untruncated title
  text — regardless of whether it's visually clamped. Clamping is
  presentational only; a screen reader should always get the complete
  headline.
- This re-runs on every render (the title node is replaced wholesale each
  time), so no stale truncation state can persist across a card change.

## Out of scope

- Widening `.panel` — width stays `min(680px, 100%)`, unchanged. (The
  wider-panel path was measured in section 1 and rejected as unnecessary.)
- Re-checking truncation/popover attachment on window resize.
- The native browser `title` attribute — explicitly rejected in favor of
  the custom popover for instant timing and theme control.
- Any change to DTF queue fetching/paging logic, favorites, or any other
  feature untouched by this spec.

## Testing

This repo has no DOM/jsdom test environment — `npm test` runs `node
--test` against source-regex assertions (see `test/newtabSource.test.js`),
and the new-tab page itself is sandboxed from browser automation (per
prior verification in this project). New/updated coverage follows the
same source-pattern style:

- Assert the truncation-detection code path exists (`scrollHeight` /
  `clientHeight` comparison) and that it gates the popover/`tabindex`
  attachment — i.e. it doesn't unconditionally add either.
- Assert the title node always receives an `aria-label` containing the
  full title text.

CSS layout (line-clamp, fixed panel height, popover appearance and
positioning, light/dark theme) can't be exercised by the test suite at
all and must be verified manually in a real browser, per this repo's
established pattern. Manual matrix for the implementer to run through:

- Short / medium / long / extreme-outlier (clamped) title, in each of:
  loading, active card, fork ("read everything fresh"), archive-ended
  ("read everything including archive") state — confirm the box is the
  same height in all of them.
- Hover and keyboard-focus (Tab key) an extreme-outlier clamped title —
  popover appears immediately, shows the full text, matches the current
  theme.
- Light and dark theme (`prefers-color-scheme`).
- Desktop width and the ≤600px mobile breakpoint — specifically the
  2-button vs 3-button action row on mobile (column stack).

Exact task breakdown and file-by-file sequencing is left to the
implementation plan.

# Milestone-State Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Do NOT create a git worktree or a feature branch for this plan.** Work
> directly on `main`. This is a deliberate, already-authorized decision made
> by the human during brainstorming — do not invoke
> `superpowers:using-git-worktrees` and do not ask for confirmation on this
> point again. If `subagent-driven-development`'s own process mentions
> worktree isolation as a prerequisite, skip that step for this plan.

> **Sequencing:** this plan is meant to be started by a fresh session **after**
> a separate, concurrently-running session finishes implementing
> `docs/superpowers/plans/2026-07-12-weather-widget.md` on this same `main`
> branch (no worktree isolation was used for that plan either — both plans
> share one working tree, sequentially). Task 0 below verifies that
> handoff actually happened before any other work starts.

**Goal:** Give the three "informational" news-card states —
`renderLoading` ("Загружаю новость..."), `renderFork` ("Вы прочитали всё
свежее"), `renderArchiveEnded` ("Вы прочитали всё, включая архив") — a
centered icon badge that fills the blank space `.title`'s 3-line
reservation otherwise leaves around their always-short, always-one-line
static text, without changing `.panel`'s fixed height or touching the real
news-card title path (`.title`, `createTitleNode`,
`attachTruncatedTitlePopover`) at all.

**Architecture:** A new, additive-only `icon` option on `renderShell`. When
absent (the real news-card path, `renderCard`), behavior is byte-for-byte
identical to today. When present, `renderShell` builds a small centered
"milestone header" (icon badge + title, both vertically centered, replacing
the top-anchored 3-line-reserved `<h1 class="title">`) instead of the usual
title node — same total reserved height as before, just filled
intentionally instead of left blank. Two new icons are added to the
existing hand-vendored Lucide set in `src/icons.js`; the loading state's
icon spins via a CSS animation that respects `prefers-reduced-motion`.

**Tech Stack:** Vanilla ES modules, no bundler, `node:test` (`npm test`),
`node --check` (`npm run check`). No new dependency, no new copy string, no
new color token.

Design spec: [`docs/superpowers/specs/2026-07-12-milestone-state-icons-design.md`](../specs/2026-07-12-milestone-state-icons-design.md).

## Global Constraints

- **Every task must leave `npm test` and `npm run check` green** before its commit.
- **No jsdom, no DOM in `node:test`.** Same constraint as the rest of this
  repo's test suite: everything checkable from code is checked via
  source-regex assertions against file text (matching
  `test/newtabSource.test.js` and `test/icons.test.js`'s existing pattern).
  Anything visual (centering, the spinner actually rotating,
  `prefers-reduced-motion` actually freezing it, light/dark theme) is a
  manual browser check, not something the test suite can assert.
- **`.panel`'s fixed height (`282px` desktop / `356px` mobile) and width
  (`min(680px, 100%)`) do not change**, and neither does `.title`,
  `createTitleNode`, or `attachTruncatedTitlePopover` — the real news-card
  path (`renderCard`) must behave exactly as it does today. This plan is
  purely additive for the three non-card states.
- **No new runtime dependency, no new user-facing copy string, no new CSS
  color token.** The two new icons reuse the existing hand-vendored
  Lucide-path format already in `src/icons.js`; the badge reuses the
  existing `--bg` / `--border` / `--muted` variables already defined for
  both light and dark theme.
- **Commit after every task** with the task's own commit message; do not
  batch multiple tasks into one commit.
- **File anchors in this plan are given as exact "find this block / replace
  with this block" snippets, not line numbers** — `src/newtab.js` and
  `src/newtab.css` will have shifted from whatever line numbers existed
  when this plan was written, because the weather-widget plan (see
  Sequencing note above) inserts its own code first. If a "find" block
  doesn't match verbatim when you get to a task, do not guess — that is a
  staleness finding: locate the equivalent code by its function/selector
  name and content, and treat a real mismatch as a blocker for Task 0's
  review (or, if found mid-plan after Task 0 already passed, stop and
  escalate rather than patching around it silently).

---

## Task 0: Branch/state check and independent plan self-review

**Files:** none modified, except this plan file itself if the review finds errors.

This plan was written in a different session than the one that will
execute it, against a repository state that a separate, concurrently-running
session was actively changing at the time (the weather-widget plan). Before
any code changes happen, verify the handoff actually completed, then have a
fresh, independent agent (no memory of how this plan was produced) check
the plan itself for drift and internal errors.

- [ ] **Step 1: Verify the repository is ready for this plan to begin**

Run each of these and confirm the stated expectation — if any fails, **stop
here and report the specific failing condition to the human; do not
proceed to Step 2 or Task 1**:

```bash
git rev-parse --abbrev-ref HEAD
```
Expected: `main`. If it's anything else, stop — this plan must run
directly on `main` (see the header note above), and a different current
branch means something unexpected has happened.

```bash
git status --short
```
Expected: empty (clean working tree). A non-empty result means there is
uncommitted work in progress — investigate what it is before touching
anything; do not run `git checkout`/`git restore`/`git clean` to force a
clean state.

```bash
test -f src/weatherApi.js && test -f src/weatherStore.js && test -f src/weatherService.js && test -f src/weatherUiState.js && grep -q "weatherRoot" src/newtab.js && grep -q "weather-panel" src/newtab.css && echo "weather widget present"
```
Expected: prints `weather widget present`. This confirms the
concurrently-running weather-widget plan has actually landed on `main`
before this plan starts (see Sequencing note above). If this fails, the
weather-widget plan is not finished yet — stop and report this; do not
start implementing milestone-state icons against a mid-flight `main`.

```bash
npm test && npm run check
```
Expected: full suite green, `npm run check` clean. This establishes the
pre-existing baseline this plan's Global Constraints require every task to
preserve. If this is red before any of this plan's code has been touched,
stop and report it — it is not this plan's job to fix a pre-existing
regression from other work.

- [ ] **Step 2: Dispatch an independent review agent**

Once Step 1 passes cleanly, dispatch a fresh subagent with this exact task
(it should only need Read/Grep/Bash-for-reading — no code changes, no
writes beyond this plan file if fixes are needed):

```
Review the implementation plan at
docs/superpowers/plans/2026-07-12-milestone-state-icons.md against the
approved design spec at
docs/superpowers/specs/2026-07-12-milestone-state-icons-design.md, and
against the current state of the repository. Do not implement anything —
this is a read-only review. Report back on each of these:

1. Grounding against the real repository: open the actual current
   src/newtab.js, src/newtab.css, src/icons.js, test/newtabSource.test.js,
   and test/icons.test.js. For every "find this exact block" snippet this
   plan quotes from those files, confirm the quoted text still appears
   verbatim in the current file. List anything that does not match
   verbatim (this is expected to still match today, since the plan's
   anchors were deliberately chosen from code the weather-widget plan does
   not touch — but confirm rather than assume, since that plan may have
   changed since this one was written).
2. Internal consistency: do the class names, function names, icon names,
   and exact pixel/timing values match every time they are referenced
   across tasks? Specifically: title-wrap--milestone, milestone-badge,
   milestone-title, icon--spin, milestone-spin, createMilestoneTitleNode,
   checkCheck, loaderCircle, the 52px/44px badge sizes, the 26px/22px
   font-size pairs, and the 0.9s spin duration.
3. Spec coverage: does every section of the design spec (the 3-state icon
   mapping, the circular badge layout, the spin animation +
   prefers-reduced-motion, the height-budget reasoning for why the fixed
   panel height doesn't need to change, the CHANGELOG note) map to a task
   in this plan? List any gap.
4. Test correctness: for every new `assert.match`/`assert.doesNotMatch`
   regex this plan adds, read it against the exact code/CSS the same task
   asks the implementer to write, and confirm the regex would actually
   match that exact text (correct escaping, correct order of properties
   inside `[^}]*` blocks, no accidental partial-match ambiguity — e.g.
   confirm `icon: "check",` cannot accidentally match `icon: "checkCheck",`
   or vice versa).
5. Height-budget arithmetic: confirm the desktop math (badge 52px + gap
   10px + one line of 26px/1.22 title text ≈ 94px, against a
   `calc(1.22em * 3)` ≈ 95px reservation) and the mobile math (badge 44px +
   gap 8px + one line of 22px/1.22 title text ≈ 78.8px, against a
   `calc(1.22em * 3)` ≈ 80.5px reservation at the mobile font-size) both
   actually hold given the exact CSS this plan specifies — flag it if
   either would overflow its own reservation.

Report one clear verdict: either "plan is sound, proceed to Task 1" or a
numbered list of specific required fixes, each one quoting the exact plan
text that is wrong and what needs to change.
```

- [ ] **Step 3: Apply any required fixes**

If the review reports required fixes, edit
`docs/superpowers/plans/2026-07-12-milestone-state-icons.md` to correct
them directly. A stale "find" block: re-open the affected source file, find
the current location of the equivalent code, and update the citation and
quoted snippet. A logic/consistency/arithmetic error: fix the plan's text
and code snippet, keeping the rest of the task intact.

- [ ] **Step 4: Re-review if the fix was non-trivial**

A pure anchor-text correction (the code itself is unchanged, just found at
a different location) does not need a second pass. Anything that changed a
code snippet's actual content (not just where it was found) gets one more
review round with the same agent prompt as Step 2, restricted to the
sections that changed.

- [ ] **Step 5: Reset the progress ledger, then proceed**

Check `.superpowers/sdd/progress.md`. If it references a different,
already-complete plan (very likely — the weather-widget plan almost
certainly left its own ledger there), overwrite it with a fresh ledger
scoped to this plan, e.g.:

```markdown
# Progress: milestone-state icons

Plan: docs/superpowers/plans/2026-07-12-milestone-state-icons.md
Branch: main (working directly on main, no worktree — user-authorized)
Base (plan start): <current `git rev-parse HEAD` output from Step 1>

Tasks:
- Task 0: pending (branch/state check + independent plan review, no code)
- Task 1: pending (checkCheck/loaderCircle icons + createIconNode className option)
- Task 2: pending (milestone header JS+CSS wiring, spin animation)
- Task 3: pending (final manual verification + CHANGELOG entry)

Minor findings roll-up: (none yet)
```

Then continue with Task 1 via `superpowers:subagent-driven-development` as
normal. No commit is needed for this task unless Step 3 made plan edits —
if it did, commit the corrected plan on its own:

```bash
git add docs/superpowers/plans/2026-07-12-milestone-state-icons.md
git commit -m "docs: correct plan drift found by independent pre-execution review"
```

---

## Task 1: `checkCheck` / `loaderCircle` icons + `createIconNode` className option

**Files:**
- Modify: `src/icons.js`
- Modify: `test/icons.test.js`

**Interfaces:**
- Produces: `ICON_PATHS.checkCheck`, `ICON_PATHS.loaderCircle`;
  `createIconNode(name, { size = 18, className = "" } = {})` — when
  `className` is a non-empty string, the wrapper's class list becomes
  `"icon " + className` instead of just `"icon"`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

In `test/icons.test.js`, find this exact block:

```js
const ICON_NAMES = [
  "settings",
  "chevronLeft",
  "chevronRight",
  "pencil",
  "plus",
  "check",
  "x",
  "trash2"
];
```

Replace it with:

```js
const ICON_NAMES = [
  "settings",
  "chevronLeft",
  "chevronRight",
  "pencil",
  "plus",
  "check",
  "checkCheck",
  "loaderCircle",
  "x",
  "trash2"
];
```

Then find this exact block (the last test in the file, right before the
closing `});`):

```js
  it("is vendored locally with no new runtime dependency", async () => {
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(packageJson, /lucide/i);
  });
});
```

Replace it with:

```js
  it("is vendored locally with no new runtime dependency", async () => {
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(packageJson, /lucide/i);
  });

  it("supports an optional extra className for one-off modifiers like a spinning icon", async () => {
    const code = await readFile(new URL("../src/icons.js", import.meta.url), "utf8");
    assert.match(
      code,
      /export function createIconNode\(name, \{ size = 18, className = "" \} = \{\}\)/
    );
    assert.match(code, /wrapper\.className = className \? `icon \$\{className\}` : "icon";/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/icons.test.js`
Expected: FAIL — `ICON_PATHS.checkCheck` / `ICON_PATHS.loaderCircle` don't
exist yet (first test fails), and the className support doesn't exist yet
(new last test fails).

- [ ] **Step 3: Add the two new icons and the className option**

In `src/icons.js`, find this exact block:

```js
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
```

Replace it with:

```js
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCheck: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  loaderCircle: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
```

Then find this exact block:

```js
export function createIconNode(name, { size = 18 } = {}) {
  const inner = ICON_PATHS[name];

  if (!inner) {
    throw new Error(`Unknown icon: ${name}`);
  }

  const wrapper = document.createElement("span");
  wrapper.className = "icon";
  wrapper.setAttribute("aria-hidden", "true");
```

Replace it with:

```js
export function createIconNode(name, { size = 18, className = "" } = {}) {
  const inner = ICON_PATHS[name];

  if (!inner) {
    throw new Error(`Unknown icon: ${name}`);
  }

  const wrapper = document.createElement("span");
  wrapper.className = className ? `icon ${className}` : "icon";
  wrapper.setAttribute("aria-hidden", "true");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/icons.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/icons.js test/icons.test.js
git commit -m "feat: add checkCheck/loaderCircle icons and a className option on createIconNode"
```

---

## Task 2: Milestone header — centered icon badge for loading/fork/archive-ended

**Files:**
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Consumes: `createIconNode(name, { size, className })` from Task 1
  (`src/icons.js`); `.title-wrap`'s existing `position: relative;` rule and
  `.title:hover + .title-popover, .title:focus-visible + .title-popover`
  rule in `src/newtab.css` (read but not modified — this task's new CSS
  rules are inserted after them, not instead of them).
- Produces: `createMilestoneTitleNode(title, iconName, { spin = false } =
  {})` in `src/newtab.js`, returning a single `<div class="title-wrap
  title-wrap--milestone">` element. `renderShell` gains two new options,
  `icon = null` and `iconSpin = false`. No other task depends on these —
  this is the last functional task; Task 3 is verification only.

- [ ] **Step 1: Write the failing tests**

In `test/newtabSource.test.js`, add this test right after the file's last
test (`"caps meta and status text at 2 lines..."`, immediately before the
closing `});` of the `describe` block):

```js

  it("gives the three milestone states (loading, fork, archive-ended) a centered icon badge instead of an empty 3-line title reservation", async () => {
    const code = await source();
    assert.match(
      code,
      /function createMilestoneTitleNode\(title, iconName, \{ spin = false \} = \{\}\)/
    );
    assert.match(code, /createNode\("div", "title-wrap title-wrap--milestone"\)/);
    assert.match(code, /createNode\("div", "milestone-badge"\)/);
    assert.match(code, /createNode\("h1", "milestone-title", title\)/);
    assert.match(
      code,
      /createIconNode\(iconName, \{ size: 24, className: spin \? "icon--spin" : "" \}\)/
    );
    assert.match(code, /icon = null,\s*iconSpin = false/);
    assert.match(
      code,
      /fragment\.appendChild\(createMilestoneTitleNode\(title, icon, \{ spin: iconSpin \}\)\);/
    );
    assert.match(code, /icon: "loaderCircle",\s*iconSpin: true/);
    assert.match(code, /icon: "checkCheck",/);
    assert.match(code, /icon: "check",/);

    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.title-wrap--milestone\s*\{[^}]*font-size: 26px;[^}]*min-height: calc\(1\.22em \* 3\);[^}]*text-align: center;[^}]*\}/s
    );
    assert.match(
      css,
      /\.milestone-badge\s*\{[^}]*border-radius: 50%;[^}]*background: var\(--bg\);[^}]*\}/s
    );
    assert.match(
      css,
      /\.milestone-title\s*\{[^}]*font-size: 26px;[^}]*font-weight: 700;[^}]*\}/s
    );

    const mobileBlock = css.slice(css.indexOf("@media (max-width: 600px)"));
    assert.match(mobileBlock, /\.title-wrap--milestone\s*\{[^}]*font-size: 22px;[^}]*\}/s);
    assert.match(
      mobileBlock,
      /\.milestone-badge\s*\{[^}]*width: 44px;[^}]*height: 44px;[^}]*\}/s
    );
  });

  it("spins only the loading icon, and freezes it under prefers-reduced-motion", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(
      css,
      /@keyframes milestone-spin\s*\{\s*to\s*\{\s*transform: rotate\(360deg\);/
    );
    assert.match(
      css,
      /\.icon--spin\s*\{[^}]*animation: milestone-spin 0\.9s linear infinite;[^}]*\}/s
    );
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.icon--spin\s*\{\s*animation: none;/
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL — none of `createMilestoneTitleNode`, the `icon`/`iconSpin`
options, or the new CSS rules exist yet.

- [ ] **Step 3: Add `createMilestoneTitleNode` to `src/newtab.js`**

Find this exact block:

```js
function createTitleNode(title) {
  const titleWrap = createNode("div", "title-wrap");
  const titleNode = createNode("h1", "title", title);
  titleNode.setAttribute("aria-label", title);
  titleWrap.appendChild(titleNode);
  return { titleWrap, titleNode };
}
```

Replace it with (the new function is added right after the existing one —
`createTitleNode` itself is untouched):

```js
function createTitleNode(title) {
  const titleWrap = createNode("div", "title-wrap");
  const titleNode = createNode("h1", "title", title);
  titleNode.setAttribute("aria-label", title);
  titleWrap.appendChild(titleNode);
  return { titleWrap, titleNode };
}

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

- [ ] **Step 4: Wire `icon`/`iconSpin` into `renderShell`**

Find this exact block:

```js
function renderShell({ title, meta = "", status = null, error = null, actions = [] }) {
  if (!app) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const { titleWrap, titleNode } = createTitleNode(title);

  fragment.appendChild(titleWrap);

  if (meta) {
```

Replace it with:

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

  if (meta) {
```

Then find this exact block (the end of the same function):

```js
  app.replaceChildren(fragment);
  app.setAttribute("aria-busy", String(busy));
  attachTruncatedTitlePopover(titleNode, title);
}
```

Replace it with:

```js
  app.replaceChildren(fragment);
  app.setAttribute("aria-busy", String(busy));

  if (titleNode) {
    attachTruncatedTitlePopover(titleNode, title);
  }
}
```

`titleNode` stays `null` for the milestone-header path, so the popover
machinery (built for real, possibly-truncated headlines) never runs for
these three static, always-one-line strings.

- [ ] **Step 5: Pass `icon`/`iconSpin` from the three milestone states**

Find this exact block:

```js
function renderLoading(message = "Подключаюсь к очереди.") {
  renderShell({
    title: "Загружаю новость...",
    status: message
  });
}
```

Replace it with:

```js
function renderLoading(message = "Подключаюсь к очереди.") {
  renderShell({
    title: "Загружаю новость...",
    status: message,
    icon: "loaderCircle",
    iconSpin: true
  });
}
```

Find this exact block:

```js
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
```

Replace it with:

```js
function renderArchiveEnded(error = null, busyMessage = "") {
  renderShell({
    title: "Вы прочитали всё, включая архив",
    meta: "Новых карточек нет. Можно проверить ещё раз позже.",
    status: busy ? busyMessage : null,
    error,
    icon: "checkCheck",
    actions: [
      createButton("Проверить новые", "retry", { primary: true }),
      createButton("Сбросить", "reset")
    ]
  });
}
```

Find this exact block:

```js
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
```

Replace it with:

```js
function renderFork(error = null, busyMessage = "") {
  renderShell({
    title: "Вы прочитали всё свежее",
    meta: "Проверьте новые сверху или загляните глубже в архив.",
    status: busy ? busyMessage : null,
    error,
    icon: "check",
    actions: [
      createButton("Проверить новые", "retry", { primary: true }),
      createButton("Глубже в архив", "archive"),
      createButton("Сбросить", "reset")
    ]
  });
}
```

`renderCard` (the real news card) is not touched by this step at all — it
has no `icon` option passed, so it keeps rendering through the original
`createTitleNode` / `attachTruncatedTitlePopover` path unchanged.

- [ ] **Step 6: Add the milestone-header CSS**

In `src/newtab.css`, find this exact block:

```css
.title:hover + .title-popover,
.title:focus-visible + .title-popover {
  display: block;
}

.meta,
.status {
```

Replace it with:

```css
.title:hover + .title-popover,
.title:focus-visible + .title-popover {
  display: block;
}

.title-wrap--milestone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 26px;
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

.meta,
.status {
```

`.title-wrap--milestone` declares its own `font-size: 26px` — matching
`.title`'s own font-size — rather than inheriting it, because `min-height:
calc(1.22em * 3)` needs the same `em` basis `.title` uses. Without this,
`1em` would resolve against whatever font-size happens to be inherited
from an ancestor instead, and the reserved height would silently drift
from the budget `.panel`'s fixed height (`282px`/`356px`, unchanged by this
plan) was measured against. `.milestone-title` also declares
`font-size: 26px` explicitly for the same reason `.title` is fully
self-contained rather than relying on inherited values — both rules stay
readable on their own.

- [ ] **Step 7: Add the mobile overrides**

In `src/newtab.css`, inside the existing `@media (max-width: 600px)`
block, find this exact block:

```css
  .title {
    font-size: 22px;
  }

  .actions,
  .favorite-form {
    flex-direction: column;
  }
```

Replace it with:

```css
  .title {
    font-size: 22px;
  }

  .title-wrap--milestone {
    gap: 8px;
    font-size: 22px;
  }

  .milestone-badge {
    width: 44px;
    height: 44px;
  }

  .milestone-title {
    font-size: 22px;
  }

  .actions,
  .favorite-form {
    flex-direction: column;
  }
```

The badge shrinks from 52px to 44px (and the gap from 10px to 8px) on
mobile because the reserved height itself shrinks at the smaller
`font-size: 22px` (`calc(1.22em * 3)` ≈ 80.5px, vs ≈95px on desktop): badge
(44) + gap (8) + one line of 22px/1.22 title text (≈26.8px) ≈ 78.8px, just
under the ≈80.5px reservation. Keeping the desktop 52px badge at the
mobile font-size would push the row past its own reservation.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 9: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 10: Manual check**

Load the unpacked extension (`chrome://extensions` → reload → open a new
tab). For each of these three states — the initial loading screen, "read
everything fresh" (fork, 3 buttons), and, if reachable, "read everything
including archive" (2 buttons) — confirm: the icon badge and title are
centered as a block (not left-aligned like a real card's title), the badge
reads as a subtle circular ring against the card background, and the
card's overall height is unchanged from before this plan (still the same
height as an active real-headline card). Confirm the loading state's icon
visibly rotates. In system accessibility settings, enable "reduce motion"
(macOS: System Settings → Accessibility → Display → Reduce Motion; or
toggle `prefers-reduced-motion` via Chrome DevTools → Rendering tab) and
reload — confirm the loading icon is now static, not spinning. Repeat the
three-state walkthrough at both the desktop width and resized to ~390px
wide, and in both light and dark system theme. Finally, click through
several real cards and confirm `renderCard`'s own title/popover behavior
(from the prior plan) is completely unaffected — no icon, still a
left-aligned, up-to-3-line title with the hover/focus popover on
truncation.

- [ ] **Step 11: Commit**

```bash
git add src/newtab.js src/newtab.css test/newtabSource.test.js
git commit -m "feat: give loading/fork/archive-ended states a centered icon badge"
```

---

## Task 3: Final manual verification pass + CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the fully working feature from Tasks 1–2.
- Produces: nothing further consumed by other tasks — this is the final task.

- [ ] **Step 1: Run the whole suite one more time**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 2: Load the unpacked extension fresh**

In Chrome, go to `chrome://extensions`, reload the unpacked
`dtf-newtab-queue` extension, and open a brand-new tab.

- [ ] **Step 3: Walk the full matrix**

- Loading, fork, and (if reachable) archive-ended states all show a
  centered icon badge + title, and the card is the exact same height as an
  active real-headline card — in both light and dark theme, at desktop
  width and resized to ~390px wide.
- The loading icon rotates; "reduce motion" (system setting or DevTools
  Rendering-tab emulation) freezes it.
- Click through at least 10–15 real cards via "Просмотрел"/"Перейти" — the
  real news-card title is untouched: left-aligned, up to 3 lines, hover/
  keyboard-focus popover still works for any title that clamps. No icon
  badge ever appears on a real card.

- [ ] **Step 4: Add the CHANGELOG entry**

In `CHANGELOG.md`, find this exact block:

```markdown
## [Unreleased]

### Added

```

Insert this new bullet immediately after it, as the new first item under
`### Added` (leave whatever bullets already follow untouched — do not
reorder or remove them):

```markdown
- The loading, "read everything fresh", and "read everything including
  archive" news-card states now show a centered icon badge above the
  message instead of a large empty gap — the news card's title always
  reserves 3 lines of height so real headlines never resize the card, but
  these three states only ever show a short, one-line static message, so
  the reservation used to sit empty. The loading icon spins, and freezes
  automatically if the system's "reduce motion" preference is on.
```

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for milestone-state icon badges"
```

- [ ] **Step 6: Report results**

If every item in Step 3 matches expectations, this plan is done. If
anything doesn't match, note which specific item and which task it traces
back to (Task 1 = the new icons, Task 2 = the milestone header wiring and
CSS) before making further changes.

# Stable News-Card Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the DTF news card (`.panel` in `src/newtab.js`/`src/newtab.css`) from visibly growing and shrinking on every render. The title always reserves exactly 3 lines of space (short titles don't shrink it, long titles get truncated with an ellipsis instead of growing it), and the whole card is locked to one constant height across every app state (loading, active card, "read everything fresh," "read everything including archive"). A themed popover shows the full headline on hover/keyboard-focus for the rare title that actually gets truncated.

**Architecture:** Pure CSS for the height fix (no `newtab.js` changes) — `.title` gets a `min-height` + `-webkit-line-clamp: 3`, `.panel` gets an explicit fixed `height` instead of auto-sizing, computed and empirically verified against real DTF headline data (see Measurement Methodology below) for both the desktop layout and the `≤600px` mobile breakpoint. A small JS addition wraps the title in a plain `<div>` and, only when that title actually got clamped, attaches a CSS-driven popover sibling — no popover, no extra markup, for the ~96% of real titles that fit in 3 lines untouched.

**Tech Stack:** Chrome Manifest V3 extension, vanilla ES modules (`<script type="module">`, no bundler), `node:test` (no test dependencies, no jsdom). No new dependencies.

Design spec: [`docs/superpowers/specs/2026-07-12-stable-news-card-height-design.md`](../specs/2026-07-12-stable-news-card-height-design.md).

## Global Constraints

- **Every task must leave `npm test` and `npm run check` green** before its commit.
- **No jsdom, no DOM in `node:test`.** This repo has no DOM available in its test runner (confirmed: no jsdom/happy-dom dependency, no `document.createElement` anywhere in `test/*.js`). All CSS/layout behavior is verified manually in a real browser — the extension's own new-tab page is sandboxed from browser automation, so "manual check" steps in this plan are for a human (or an agent with real Chrome access) to run, not something this plan's own test commands can assert. Everything that *can* be checked from source text is checked via source-regex assertions, matching `test/newtabSource.test.js`'s existing pattern.
- **`.panel`'s width does not change.** Stays `min(680px, 100%)`. The spec explored and rejected widening the panel — 3-line title reservation already truncates only ~4% of real titles at the current width (see Measurement Methodology).
- **One deliberate deviation from the spec's exact wording:** the spec's section 2 describes `.panel` getting `overflow: hidden` as a safety clamp. This plan does **not** add `overflow: hidden` to `.panel` at all. Reason: Task 2's popover needs to render outside `.title`'s own `overflow: hidden` (required for its line-clamp) — if `.panel` also clipped overflow, a long popover could get cut off. The fixed height itself (with the buffer described below) is the safety net instead. Task 0's review explicitly re-checks this reasoning.
- **No new runtime dependencies, no new user-facing copy strings.** The popover echoes the existing title text — nothing new to translate.
- **Commit after every task** with the task's own commit message; do not batch multiple tasks into one commit.

## Measurement Methodology (read before Task 1)

The spec deliberately left the exact fixed-height pixel values for empirical, in-browser measurement rather than hand-calculation. That measurement was done as part of writing this plan, against:

- **100 real DTF headlines**, fetched live from `https://api.dtf.ru/v2.10/news` (the same endpoint `src/dtfApi.js` calls), min 18 / avg 84.3 / max 141 characters.
- A browser fixture reproducing the *actual* `.panel`/`.title`/`.meta`/`.actions`/`.status` structure and CSS (copied from the real `src/newtab.css`, with the Task 1/Task 2 changes applied), rendering every combination of: 4 real title lengths (including the two longest, 122–163 chars, which are the ones expected to actually clamp) × 5 states — `loading`, `card` (2 buttons), `fork` (3 buttons), and both of those again with a simultaneous `status` line shown (the real "busy, mid-action" case: `renderCard` shows `status: busy ? busyMessage : null` **alongside** the title/meta/actions, not instead of them — this is the actual worst case, not just the 3 states `renderResult` names).
- For each width candidate, a script compared each `.panel`'s `scrollHeight` to its `clientHeight` to detect real clipping (not guessed) — binary-searched down to the exact minimum pixel height that clips nothing, at both the desktop width (680px) and the mobile breakpoint (`≤600px`, narrower content width + `flex-direction: column` action buttons).

Results:

| Breakpoint | Worst-case content needs | Chosen fixed height (with buffer) |
|---|---|---|
| Desktop (680px panel) | 271px minimum (title+meta+actions+status, all present) | **282px** |
| Mobile (≤600px, 3 stacked buttons + status) | 345px minimum | **356px** |

The ~9–11px buffer in each is intentional headroom against font-rendering differences across operating systems (this was measured on one browser/OS combination) — not padding to be "cleaned up."

Separately, truncation rate was verified at 3-line reservation against the same 100 real titles: **4% truncate at the current 680px width, 0% at 720px+** — confirming the spec's decision to leave the width unchanged.

---

## Task 0: Independent review of this plan before execution begins

**Files:** none modified, except this plan file itself if the review finds errors.

This plan was written in a different session than the one that will execute it, from a browser-based measurement pass rather than hand-calculation. Before any code changes happen, a fresh, independent agent (no memory of how this plan was produced) checks it for drift and internal errors.

- [ ] **Step 1: Dispatch an independent review agent**

Dispatch a fresh subagent with this exact task (it should only need Read/Grep — no code changes, no Bash execution beyond reading files):

```
Review the implementation plan at
docs/superpowers/plans/2026-07-12-stable-news-card-height.md against the
approved design spec at
docs/superpowers/specs/2026-07-12-stable-news-card-height-design.md, and
against the current state of the repository. Do not implement anything —
this is a read-only review. Report back on each of these:

1. Staleness: for every file path + line number the plan cites (e.g.
   "src/newtab.css:456-465"), open that file and confirm the cited lines
   still contain what the plan says they contain. List anything that has
   drifted (other work may have landed on this file since the plan was
   written).
2. Internal consistency: do the CSS class names, JS function names, and
   exact pixel values match every time they are referenced across tasks?
   Specifically: .title-wrap, .title-popover, createTitleNode,
   attachTruncatedTitlePopover, the 282px desktop height, and the 356px
   mobile height.
3. Spec coverage: does every section of the spec (3-line title reservation,
   one constant panel height across every app state, hover/focus popover
   for truncated titles) map to a task in this plan? List any gap.
4. The plan's one intentional deviation from the spec's literal wording:
   the spec says .panel gets `overflow: hidden` as a safety clamp; this
   plan drops that property entirely instead, relying only on the
   empirically-measured height buffer, because the popover (added after
   the spec was written) needs to render outside .title's own
   `overflow: hidden` line-clamp region, and an overflow:hidden on .panel
   would risk clipping it too. Confirm this reasoning holds, or name a
   real content scenario (beyond what the plan's Measurement Methodology
   section already tested) that could still visibly overflow the fixed
   height now that the clamp is gone.
5. Code correctness: read every CSS/JS snippet in the plan as if you were
   about to type it in verbatim — is it syntactically valid, and does it
   do what the surrounding prose claims?

Report one clear verdict: either "plan is sound, proceed to Task 1" or a
numbered list of specific required fixes, each one quoting the exact plan
text that is wrong and what needs to change.
```

- [ ] **Step 2: Apply any required fixes**

If the review reports required fixes, edit `docs/superpowers/plans/2026-07-12-stable-news-card-height.md` to correct them directly. Stale line numbers: re-open the affected source file, find the current location of the same code, and update every citation and quoted snippet in the affected task(s) to match. A logic/consistency error: fix the plan's text and code snippet, keeping the rest of the task intact.

- [ ] **Step 3: Re-review if the fix was non-trivial**

A pure line-number renumbering (the code itself is unchanged, just moved) does not need a second pass. Anything that changed a code snippet's actual content (not just its line number) gets one more review round with the same agent prompt as Step 1, restricted to the sections that changed.

- [ ] **Step 4: Proceed**

Once review is clean, continue with Task 1 via superpowers:subagent-driven-development as normal. No commit is needed for this task unless Step 2 made edits — if it did, commit the corrected plan on its own:

```bash
git add docs/superpowers/plans/2026-07-12-stable-news-card-height.md
git commit -m "docs: correct plan drift found by independent pre-execution review"
```

---

## Task 1: Fixed-height panel and 3-line title reservation (CSS only)

**Files:**
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Produces: `.panel` has an explicit `height` (`282px` desktop, `356px` inside the `@media (max-width: 600px)` block) instead of auto-sizing, plus `align-content: start`. `.title` reserves exactly 3 lines via `min-height: calc(1.22em * 3)` and `-webkit-line-clamp: 3`. Task 2 depends on this — it does not touch these declarations, only adds new rules alongside them.
- Consumes: nothing from other tasks.

No `newtab.js` changes in this task. Every render function (`renderLoading`/`renderCard`/`renderArchiveEnded`/`renderFork`) already conditionally appends whatever subset of `meta`/`actions`/`status` it needs (see `renderShell`, `src/newtab.js:101-134`) — fixing the *container's* height is enough regardless of which children exist on a given render.

- [ ] **Step 1: Write the failing test**

In `test/newtabSource.test.js`, add this test right before the file's closing `});` (currently line 192, immediately after the `"skips the empty favorites-grid box..."` test that currently ends at line 191):

```js

  it("locks the news card to one constant height, with the title always reserving exactly 3 lines", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");

    assert.match(
      css,
      /\.title\s*\{[^}]*min-height: calc\(1\.22em \* 3\);[^}]*-webkit-line-clamp: 3;[^}]*-webkit-box-orient: vertical;[^}]*overflow: hidden;[^}]*\}/s
    );
    assert.match(
      css,
      /\.panel\s*\{[^}]*height: 282px;[^}]*align-content: start;[^}]*\}/s
    );

    const mobileBlock = css.slice(css.indexOf("@media (max-width: 600px)"));
    assert.match(mobileBlock, /\.panel\s*\{[^}]*height: 356px;[^}]*\}/s);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL — none of `min-height`, `-webkit-line-clamp`, the fixed `height`, or `align-content` exist on these rules yet.

- [ ] **Step 3: Add the 3-line title reservation**

In `src/newtab.css`, change `.title` (currently lines 467-473):

```css
.title {
  margin: 0;
  font-size: 26px;
  line-height: 1.22;
  letter-spacing: 0;
  overflow-wrap: anywhere;
  min-height: calc(1.22em * 3);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

`min-height` reserves the space even for a 1-line title (line-clamp alone only *caps* height, it doesn't reserve it for shorter content); `-webkit-line-clamp: 3` truncates anything past 3 lines with an ellipsis instead of growing past that reservation.

- [ ] **Step 4: Fix the panel to a constant desktop height**

Change `.panel` (currently lines 456-465):

```css
.panel {
  width: min(680px, 100%);
  display: grid;
  gap: 12px;
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 18px 50px rgb(0 0 0 / 10%);
  height: 282px;
  align-content: start;
}
```

`height` (not `min-height`) replaces auto-sizing — see Measurement Methodology above for how `282px` was derived and verified. `align-content: start` keeps rows anchored to the top; any state shorter than the worst case (e.g. the loading screen, which has no meta/actions) leaves blank space at the bottom instead of the box shrinking.

- [ ] **Step 5: Fix the panel to a constant mobile height**

In the `@media (max-width: 600px)` block, change `.panel` (currently lines 564-566):

```css
  .panel {
    padding: 22px;
    height: 356px;
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 7: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 8: Manual check**

Load the unpacked extension (`chrome://extensions` → reload → open a new tab). Click through several real cards via "Просмотрел"/"Перейти" — confirm the card's outer box stays pixel-identical in height regardless of how short or long each headline is (some real DTF headlines are one line, some wrap to 2-3). Keep clicking "Проверить новые"/advancing until you reach the "read everything fresh" (fork, 3 buttons) and, if reachable, "read everything including archive" screens — confirm those are also the exact same height as an active card, not shorter or taller. Resize the browser to roughly 390px wide and repeat the same walk-through — confirm the card is still one constant height there too (a different constant than desktop, but constant).

- [ ] **Step 9: Commit**

```bash
git add src/newtab.css test/newtabSource.test.js
git commit -m "fix: lock the news card to one constant height across every state"
```

---

## Task 2: Hover/focus popover for truncated titles

**Files:**
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Consumes: `.title`'s line-clamp from Task 1 (this task reads `titleNode.scrollHeight`/`clientHeight` to detect when that clamp actually truncated something).
- Produces: `createTitleNode(title)` (returns `{ titleWrap, titleNode }`) and `attachTruncatedTitlePopover(titleNode, fullTitle)`, both in `src/newtab.js`. `.title-wrap` and `.title-popover` CSS classes in `src/newtab.css`. No other task depends on these.

- [ ] **Step 1: Write the failing test**

In `test/newtabSource.test.js`, add this test right after the one added in Task 1:

```js

  it("shows a themed popover with the full title only when the 3-line clamp actually truncated it", async () => {
    const code = await source();
    assert.match(code, /function createTitleNode\(title\)/);
    assert.match(code, /function attachTruncatedTitlePopover\(titleNode, fullTitle\)/);
    assert.match(code, /titleNode\.scrollHeight <= titleNode\.clientHeight \+ 1/);
    assert.match(code, /titleNode\.tabIndex = 0;/);
    assert.match(code, /titleNode\.setAttribute\("aria-label", title\)/);
    assert.match(code, /titleNode\.after\(popover\)/);

    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(css, /\.title-wrap\s*\{[^}]*position: relative;[^}]*\}/s);
    assert.match(
      css,
      /\.title:hover \+ \.title-popover,\s*\.title:focus-visible \+ \.title-popover\s*\{[^}]*display: block;[^}]*\}/s
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL — none of `createTitleNode`, `attachTruncatedTitlePopover`, `.title-wrap`, or `.title-popover` exist yet.

- [ ] **Step 3: Add the title-wrap/popover helpers to `newtab.js`**

In `src/newtab.js`, add these two functions right before `renderShell` (currently starting at line 101, right after `buildMeta` which currently ends at line 99):

```js
function createTitleNode(title) {
  const titleWrap = createNode("div", "title-wrap");
  const titleNode = createNode("h1", "title", title);
  titleNode.setAttribute("aria-label", title);
  titleWrap.appendChild(titleNode);
  return { titleWrap, titleNode };
}

function attachTruncatedTitlePopover(titleNode, fullTitle) {
  if (titleNode.scrollHeight <= titleNode.clientHeight + 1) {
    return;
  }

  titleNode.tabIndex = 0;

  const popover = createNode("div", "title-popover", fullTitle);
  popover.setAttribute("aria-hidden", "true");
  titleNode.after(popover);
}
```

`aria-label` is set unconditionally (whether or not the title ends up clamped) — a screen reader always gets the full headline; clamping is purely a sighted-user visual affordance. `attachTruncatedTitlePopover` only adds `tabindex`/the popover element when the title node's rendered content actually overflowed its clamped box — untruncated titles get neither.

- [ ] **Step 4: Wire the helpers into `renderShell`**

Change `renderShell` (currently lines 101-134):

```js
function renderShell({ title, meta = "", status = null, error = null, actions = [] }) {
  if (!app) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const { titleWrap, titleNode } = createTitleNode(title);

  fragment.appendChild(titleWrap);

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
  attachTruncatedTitlePopover(titleNode, title);
}
```

The truncation check must run *after* `app.replaceChildren(fragment)` — `scrollHeight`/`clientHeight` are only meaningful once the node is actually laid out in the document, not while it's sitting in a detached `DocumentFragment`.

- [ ] **Step 5: Add the popover CSS**

In `src/newtab.css`, add this immediately after the `.title` rule (the one Task 1 just edited to add the line-clamp) and before the `.meta,\n.status {` rule. Task 1's edit shifted `.title` a few lines down from its original 467-473 (both `.panel` and `.title` grew), so don't rely on a specific line number here — anchor on the rule content itself:

```css
.title-wrap {
  position: relative;
}

.title-popover {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  margin-top: 8px;
  padding: 10px 12px;
  width: max-content;
  max-width: min(480px, calc(100vw - 48px));
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 18px 50px rgb(0 0 0 / 10%);
  color: var(--text);
  font-size: 15px;
  font-weight: 400;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.title:hover + .title-popover,
.title:focus-visible + .title-popover {
  display: block;
}
```

`.title-wrap` (not `.panel`) is the popover's positioning context — it's a plain, unstyled-otherwise `<div>` that shrinks to fit exactly the clamped title's box, so `top: 100%` lands the popover right below the title, not below the whole card. The popover is a real DOM sibling of `.title` (via `titleNode.after(popover)`), not a child of it, specifically so `.title`'s own `overflow: hidden` (needed for the line-clamp) does not also clip the popover.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 7: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 8: Manual check**

Load the unpacked extension. Click through the queue until you land on a headline long enough to actually clamp (rare — about 4% of real DTF headlines at this width; a headline over roughly 150 characters is a safe bet, or temporarily lower `-webkit-line-clamp` to `1` in devtools to force it on any headline, then revert). Confirm: hovering the clamped title shows a popover below it with the complete headline, styled like the rest of the card (light/dark theme matches `--panel`/`--border`/`--text`), appearing instantly (no native browser tooltip delay). Tab to the title with the keyboard (it should be reachable now that it's truncated) and confirm the same popover appears on focus. Confirm an *untruncated* title (the common case) shows no popover on hover and is not reachable via Tab.

- [ ] **Step 9: Commit**

```bash
git add src/newtab.js src/newtab.css test/newtabSource.test.js
git commit -m "feat: show a themed popover for truncated news-card titles"
```

---

## Task 3: Final manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite one more time**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 2: Load the unpacked extension fresh**

In Chrome, go to `chrome://extensions`, reload the unpacked `dtf-newtab-queue` extension, and open a brand-new tab.

- [ ] **Step 3: Walk the full matrix**

- Click through at least 10-15 real cards via "Просмотрел"/"Перейти" — the card never visibly resizes, on any headline length.
- Reach the "read everything fresh" (fork) screen and, if reachable, the "read everything including archive" screen — same height as an active card.
- Find (or force via devtools) a clamped title — hovering and keyboard-focusing it shows the full-text popover, styled consistently with the card, in both light and dark system theme.
- Resize to ~390px wide and repeat: constant height still holds (mobile's own constant), and the 3-button fork screen doesn't get taller than the 2-button card screen even though buttons stack vertically there.

- [ ] **Step 4: Report results**

If every item in Step 3 matches expectations, this batch is done. If anything doesn't match, note which specific item and which task it traces back to (Task 1 = the height lock, Task 2 = the popover) before making further changes.

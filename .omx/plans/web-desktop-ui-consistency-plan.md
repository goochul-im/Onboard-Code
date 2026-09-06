# Web and Desktop UI Consistency Plan

## Requirements Summary

- Use the desktop app as the visual and interaction source of truth; the PWA
  should look like the same product with browser-specific capability limits.
- Preserve all desktop functionality. Shared styling or components must not
  remove Git change impact, multi-document Record, rich source interaction,
  Confluence export, updater, or native repository behavior.
- Keep the PWA local-only boundary, responsive layout, File System Access/file
  input fallback, OPFS persistence, offline service worker, and limitations help.
- Remove direct source paste analysis. This is already implemented and guarded
  by `apps/web/src/App.test.tsx`.
- Function selection must always produce one of three explicit results: related
  graph, no confirmed relations, or unresolved-call explanation. The immediate
  graph repair is already implemented in `apps/web/src/App.tsx:224` and
  `apps/web/src/core/persistence.ts`.
- Track `onboardcode.app` registration/DNS/HTTPS separately in `TODO.md`; UI
  convergence must not wait on domain purchase.

## Current Evidence

- Desktop reference capture:
  `.omx/audits/ui-consistency/02-desktop-explore.png`
- Deployed web before the immediate fix:
  `.omx/audits/ui-consistency/03-web-current.png`
- Web after direct-paste removal and graph repair:
  `.omx/audits/ui-consistency/04-web-after-graph-fix.png`
- Full audit: `.omx/audits/ui-consistency/audit.md`

The main structural mismatch is desktop's compact shell plus two-column Explore
(`apps/desktop/src/App.tsx:843`, `apps/desktop/src/App.tsx:876`) versus web's
hero-like header plus independent tabs/status cards and a three-column Explore
grid (`apps/web/src/App.tsx:156`, `apps/web/src/App.tsx:181`,
`apps/web/src/styles.css:38`, `apps/web/src/styles.css:197`).

## Acceptance Criteria

1. At a 1440x900 viewport, web and desktop use the same vertical order: compact
   topbar, underline workspace tabs, status strip, then workspace content.
2. Web Explore uses a 320px sidebar and one flexible graph pane at widths of
   980px or greater; repository actions, search, language filter, and symbol
   results all live in that sidebar.
3. Web symbol results are grouped by class/file, expose group counts, and support
   “전부 접기/전부 펼치기”; selecting a result is visible and keyboard operable.
4. Web graph header shows selected function, path/line, `컬렉션에 추가`, and a
   1–3 step select in the same hierarchy as desktop
   (`apps/desktop/src/App.tsx:951`).
5. Selecting a fixture function with a resolved call renders at least two graph
   nodes and one edge; a function without resolved neighbors shows explicit copy;
   ambiguous/unresolved calls are listed below the graph.
6. Explore no longer contains source preview. Selecting/opening a graph node can
   take the user to Record, where source and note editing are presented together.
7. Web uses the desktop palette and dimensions for background, sidebar, primary
   action, focus ring, selected symbol, graph node, border radius, and spacing;
   same-state screenshot comparison has no major hierarchy or palette mismatch.
8. Browser-only badges and `?` limitations help remain present and usable by
   hover, keyboard focus, and tap.
9. At 390px viewport width, there is no horizontal overflow; the sidebar stacks
   before the graph, the tooltip remains within the viewport, and all primary
   targets are at least 40px high.
10. Web `npm run check`, desktop `npm run check`, privacy audit, offline reload,
    and the deployment workflow all pass. No desktop source behavior changes are
    required for web parity.

## Implementation Steps

### 1. Establish an explicit parity contract

- Add a small web UI parity test fixture/state so the same repository, selected
  function, graph depth, unresolved call, note, and collection can be rendered
  deterministically.
- Record canonical measurements from desktop styles: shell colors and topbar
  (`apps/desktop/src/styles.css:1`), 320px Explore sidebar
  (`apps/desktop/src/styles.css:15`), controls and focus treatment
  (`apps/desktop/src/styles.css:23`), graph node styling
  (`apps/desktop/src/components/CallGraph.tsx:78`).
- Keep shared values as CSS custom properties in both apps first. Do not create a
  cross-package component dependency until repeated drift proves it necessary.

### 2. Converge the web application shell

- Refactor the web header/navigation/status markup in
  `apps/web/src/App.tsx:156` to mirror desktop's `topbar`, `workspace-nav`, and
  `notice` structure from `apps/desktop/src/App.tsx:843`.
- Keep `브라우저 안에서만 처리`, connection state, and the limitations `?` in
  the right side of the compact topbar.
- Replace web's centered max-width card shell and gradient background in
  `apps/web/src/styles.css:12` with a full-height application surface matching
  desktop. Retain responsive rules below 980px.
- Change web tab styling from filled pills to the desktop underline state.

### 3. Match the Explore information architecture

- Replace the web three-column layout at `apps/web/src/App.tsx:181` with the
  desktop two-column pattern: one 320px exploration sidebar and one graph pane.
- Move search and language filtering from the separate symbol panel into the
  sidebar below folder actions.
- Port the grouping behavior of
  `apps/desktop/src/components/GroupedSymbolList.tsx:23` into a web-owned
  `GroupedSymbolList` component. Reuse grouping logic through a small shared
  pure utility only if the current desktop utility has no Tauri dependencies.
- Remove the Explore source panel at `apps/web/src/App.tsx:257`; Record becomes
  the single source/note destination, matching desktop semantics.

### 4. Reach graph interaction parity without overstating web analysis

- Align web `CallGraph` node dimensions, labels, colors, layout padding, and
  selected state with `apps/desktop/src/components/CallGraph.tsx:54` while
  keeping the web analyzer and worker separate.
- Add a graph-node action that opens Record for the selected web symbol, following
  the desktop action pattern at `apps/desktop/src/components/CallGraph.tsx:163`.
- Keep the web graph header and uncertain-call list introduced at
  `apps/web/src/App.tsx:224`; add accessible count text for confirmed and
  uncertain relations.
- Replace the remaining `safeGraph` silent catch at `apps/web/src/App.tsx` with a
  visible graph error state so persistence or selection failures cannot look like
  “no relationships.”

### 5. Align Record and Collections within the supported web scope

- Rebuild web Record as the same source-left/note-right workspace used by desktop
  (`apps/desktop/src/App.tsx:1000`), while keeping web's documented single-note
  limitation and read-source-again message after reload.
- Restyle web Collections to match the desktop three-region hierarchy and card
  vocabulary without adding unsupported features. Unsupported overview,
  relinking, review, and Confluence actions remain omitted and documented in the
  topbar `?` help.
- Preserve OPFS storage and repository scoping; this phase is presentation and
  navigation work, not a storage-model rewrite.

### 6. Visual, interaction, privacy, and desktop regression verification

- Capture desktop and web at identical 1440x900 Explore, Record, and Collections
  states. Reject major differences in shell height, column hierarchy, palette,
  control sizing, selected states, and graph scale.
- Add web component tests for grouped navigation, selected function, graph empty,
  unresolved, Record navigation, tooltip focus/tap, and paste-form absence.
- Run browser tests at 1440x900 and 390x844 for keyboard order, overflow, tooltip
  bounds, graph canvas bounds, and state announcements.
- Intercept browser network requests during folder analysis, note saving, graph
  selection, and offline reload; allow only same-origin static assets.
- Run `VITE_BASE_PATH=/Onboard-Code/ npm run check` in `apps/web` and
  `npm run check` plus the existing native verification workflow for desktop.
- Deploy through `.github/workflows/deploy-pages.yml`, then repeat the core graph
  smoke test against the public Pages URL.

## Risks and Mitigations

- **Risk: visual sharing accidentally couples web and Tauri behavior.** Keep
  runtime components separate; share only dependency-free utilities or tokens.
- **Risk: desktop layout copied literally breaks mobile web.** Treat desktop as
  hierarchy guidance above 980px and define an explicit stacked PWA layout below
  that breakpoint.
- **Risk: parity hides unsupported features.** Do not render fake enabled
  controls. Keep the persistent web badge and limitations help, and use clear
  empty-state copy where desktop capabilities are unavailable.
- **Risk: graph looks empty because of analyzer uncertainty.** Maintain separate
  resolved, no-relation, unresolved, migration-required, and error states with
  tests for each.
- **Risk: CSS restyle regresses canvas sizing.** Verify container bounds and
  non-zero Cytoscape canvas dimensions after every layout phase.
- **Risk: screenshots appear similar while keyboard behavior diverges.** Pair
  visual comparison with DOM focus-order and accessible-name checks.

## Verification Steps

1. Unit: graph resolution, legacy v2 migration, grouping, and workspace selection.
2. Component: no paste form; selected symbol header; grouped results; uncertain
   calls; graph node action; limitations help hover/focus/tap.
3. Browser: analyze a fixture folder, select a function with caller/callee,
   inspect graph, open Record, save a note, reload, and repeat offline.
4. Visual: inspect and accept same-state screenshots for all three workspaces at
   desktop and mobile widths.
5. Privacy: run `npm run privacy:audit` and assert no unexpected remote request in
   the browser trace.
6. Desktop: run the untouched desktop check and both native CI bundle jobs.
7. Deployment: verify HTML, manifest, service worker, worker bundle, and every
   grammar WASM return HTTP 200 from the public Pages URL.

## Completion Boundary

This plan is complete when web and desktop share the same task hierarchy and
visual language, all browser limitations remain honest and visible, the graph
flow is explicit in every state, and both web and desktop verification gates
pass. DNS completion is tracked separately in `TODO.md` and does not redefine UI
parity completion.

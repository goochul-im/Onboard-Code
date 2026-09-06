# Design QA — Web/Desktop UI Consistency

- Source visual truth: `.omx/audits/ui-consistency/02-desktop-explore.png`
- Normalized source: `.omx/audits/ui-consistency/11-desktop-reference-normalized.png`
- Implementation Explore: `.omx/audits/ui-consistency/10-web-parity-reference-state.png`
- Side-by-side comparison: `.omx/audits/ui-consistency/12-explore-side-by-side.png`
- Additional implementation states:
  - `.omx/audits/ui-consistency/05-web-parity-explore.png`
  - `.omx/audits/ui-consistency/06-web-parity-record.png`
  - `.omx/audits/ui-consistency/07-web-parity-collections.png`
  - `.omx/audits/ui-consistency/08-web-parity-mobile.png`
  - `.omx/audits/ui-consistency/13-production-final.png`
  - `.omx/audits/ui-consistency/14-deployed-final.png`
- Source pixels: 2784 × 1824, macOS 2x window capture
- Source normalized content: 1280 × 769
- Implementation comparison: 1280 × 769 CSS px, deviceScaleFactor 1
- Main functional capture: 1392 × 912 CSS px, deviceScaleFactor 1
- Mobile capture: 390 × 844 CSS px, deviceScaleFactor 1
- State: dark-theme Explore with one repository, a filtered selected function,
  one class/file group, depth control, and no confirmed neighbor for the
  normalized comparison; populated graph, Record, Collections, and mobile states
  were checked separately.

## Findings

No actionable P0, P1, or P2 differences remain.

- **Typography — passed.** Both builds use the same Inter/system fallback,
  compact 1.12rem app title, 700–750 control hierarchy, muted 0.6–0.78rem
  secondary copy, ellipsis for long names, and monospace graph/source text.
- **Spacing and layout — passed.** Web now follows the desktop order of compact
  topbar, underline navigation, status strip, 320px Explore sidebar, and one
  flexible graph workspace. The measured web sidebar is exactly 320px at 1392px.
  Record uses source-left/note-right, and Collections measures
  300px / 737px / 340px at the same viewport.
- **Colors and tokens — passed.** The web shell now maps to desktop slate surfaces
  (`#11151d`, `#171d28`, `#0d121b`), blue primary action (`#9bc0ff`), slate
  borders, gold selected graph node, and matching language colors. The previous
  teal hero/card treatment is gone.
- **Image and asset fidelity — passed.** The target contains no app-owned raster
  imagery, illustration, logo asset, or non-standard icon. macOS window chrome
  was excluded from the normalized comparison. No placeholder or CSS-drawn
  image was introduced.
- **Copy and content — passed.** Shared workspace labels and action terms now
  match desktop: `Explore`, `Record`, `Collections`, `저장소 열기`, `코드 분석`,
  `함수 찾기`, `컬렉션에 추가`, `펼칠 깊이`, and `소스·노트 열기`.
- **States and interactions — passed.** Folder/file analysis, grouped symbol
  expand/collapse, search, language filter, selected node, graph-node action,
  Record note save, Collections creation/add/order controls, limitation tooltip,
  empty graph explanation, and uncertain-call list were exercised.
- **Accessibility — passed for the tested scope.** Navigation and actions are
  semantic buttons, current navigation uses `aria-current`, selected symbol rows
  use `aria-pressed`, labels are associated with inputs, status is live, dialog
  semantics are present, focus styles remain visible, primary mobile actions are
  42.47px high, and the tooltip stays within x=10–380 at 390px width.
- **Responsiveness — passed.** At 390px, body width equals viewport width, the
  sidebar and graph each measure 390px, Record stacks source before editor, and
  Collections stacks sidebar, flow, then detail without horizontal overflow.

## Intentional differences

- Web keeps `Web`, privacy, connectivity, and limitations controls in the topbar.
  These disclose the browser runtime and do not change the desktop hierarchy.
- Web shows a single-repository summary rather than desktop's multi-repository
  select because the browser does not retain arbitrary folder handles.
- Git change impact remains desktop-only and is explained in the web limitations
  tooltip. No fake disabled native feature was added.
- Web keeps a file-input fallback for browsers without the directory picker.

## Focused region comparison evidence

The combined comparison in `12-explore-side-by-side.png` was opened after both
images were normalized to 1280 × 769. The topbar/navigation/status heights,
320px sidebar boundary, graph heading/control alignment, panel backgrounds,
button treatment, grouped-result density, and graph workspace fill were visibly
compared. Separate full-view captures were sufficient for Record and Collections
because their source of truth is the existing desktop layout code and both
regions are large, readable, and free of dense icon or image details.

## Comparison history

1. Initial web capture used a large marketing-style header, pill tabs, detached
   status card, three-column Explore, flat FQN results, teal palette, and an
   Explore source panel. These were P1 structural mismatches.
2. The first parity implementation replaced the shell and layout, introduced
   grouped results, moved source to Record, and aligned Collections. Browser
   capture verified the structure but exposed a P2 single-node graph that was
   auto-fitted to nearly the entire canvas.
3. The graph was constrained to 0.25–1.25 zoom. A clean reload measured the
   selected single node at 251.25 × 111.25px instead of 841 × 372.38px. The final
   combined comparison shows desktop-like graph scale and no remaining P0–P2.

## Primary interaction evidence

- Explore: 2 class/file groups; 4 graph nodes; 3 rendered edges; selected-node
  detail action present; no Explore source panel.
- Record: source loaded; title/tags/body edited; note persisted; scroll position
  reset to top on workspace change.
- Collections: collection selected; one function item rendered; 3-column layout
  measured; order and graph view controls available.
- Mobile: no horizontal overflow; topbar and analysis actions 42.47px high;
  tooltip within viewport.
- Scroll isolation: at 1392 × 700 the document measured 700px client and
  scroll height with `scrollY=0`; the Explore sidebar scrolled independently,
  Record source scrolled from 0 to 180px, and graph wheel zoom changed from
  0.5809 to 0.6083 without moving the document. At 390px the document retained
  normal vertical scrolling for the stacked mobile layout.
- Browser console exceptions: none.
- Unexpected remote requests during local interaction run: none.
- Subpath production build: service worker active at `/Onboard-Code/`; 3 graph
  nodes and 2 edges rendered; Record opened with source; offline reload remained
  controlled and rendered; no unexpected remote request or console error.
- Public Pages deployment: 68.06px compact header, 320px Explore sidebar, one
  grouped class/file result, 3 graph nodes, 2 edges, graph-node Record action,
  and active service worker verified with zero unexpected requests or console
  errors.

## Follow-up polish

- P3: add visual regression snapshots to CI when a browser screenshot runner is
  adopted; current CDP checks are repeatable but not committed as an automated
  test harness.
- P3: add reduced-motion handling if future graph transitions are introduced.

## Implementation checklist

- [x] Align application shell and navigation.
- [x] Merge repository analysis, filters, and grouped symbols into one sidebar.
- [x] Make graph the dominant Explore workspace.
- [x] Add graph-node Record action and explicit graph states.
- [x] Move source into the Record split layout.
- [x] Align Collections to the desktop three-region hierarchy.
- [x] Preserve browser-only privacy/limitations UI.
- [x] Verify desktop and mobile layouts in a real browser.
- [x] Check console and network behavior.
- [x] Verify the published GitHub Pages build.

final result: passed

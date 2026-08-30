# Design QA

- Source visual truth: `/private/tmp/onboard-code-graph-before.png` plus the user's requirement that the next action float beside the selected method node
- Selected-node implementation: `/private/tmp/onboard-code-graph-after.png`
- Changed-selection implementation: `/private/tmp/onboard-code-graph-moved.png`
- Zoom implementation: `/private/tmp/onboard-code-graph-zoom.png`
- Browser viewport: 1280 × 720 CSS px
- Source and implementation pixels: 1280 × 720
- Browser device pixel ratio: 2; browser screenshots were returned at CSS-pixel dimensions
- State: dark theme, three-node TypeScript call graph, selected node, actionable source available

## Full-view comparison evidence

The before and after captures were opened together. The former header action was visually detached from the selected method. In the implementation, the header retains only graph depth while the selected node owns the `소스·노트 열기` action beside its right edge. Graph proportions, node typography, edge treatment, dark palette, and selected-node highlight remain unchanged.

## Focused interaction evidence

The first selected node displayed a 126 × 34 px action at its right edge. Selecting the lower-left method moved both the selected highlight and action to that node. Zooming the graph kept the action aligned. The button was activated by its accessible name and produced the fixture's successful open state. The final browser state had no console errors.

## Findings

- No remaining P0, P1, or P2 findings.
- Typography: the action uses the existing compact UI scale and does not compete with node labels.
- Spacing: a 12 px node gap preserves a visible relationship without touching the node border; right, left, and below placements stay inside the graph viewport.
- Colors: the existing primary blue communicates the next action while the yellow selected-node border remains the selection signal.
- Images and assets: this interaction contains no raster or custom icon assets.
- Copy: the action remains `소스·노트 열기`; helper copy now explains that the button appears beside a selected node.
- Accessibility: the overlay is a native button with an explicit accessible label and keyboard focus ring.

## Comparison history

1. The source capture confirmed the header button was separated from the selection target.
2. The first implementation comparison showed the button beside the selected node with no actionable visual mismatch.
3. Selection-change and zoom captures confirmed the action follows the node rather than behaving as a fixed overlay.

## Interaction checks

- Selected-node button visibility: passed.
- Selecting another node moves the action: passed.
- Zoom keeps the action aligned: passed.
- Clicking the action invokes the open-detail callback: passed.
- Offscreen node placement returns no floating action: covered by unit test.
- Browser console errors: none.

## Implementation checklist

- [x] Remove the detached header action.
- [x] Float the action beside the selected graph node.
- [x] Reposition on selection, pan, zoom, render, and resize.
- [x] Avoid graph-edge overflow and hide the action for offscreen nodes.
- [x] Preserve native button focus and disabled/loading states.

final result: passed

# Design QA

- Source visual truth: `/var/folders/5h/8t8n0xtx23s3_9vr9crbw07w0000gn/T/codex-clipboard-08953d00-03b3-40a7-928d-a090bfa5d798.png`
- Explore implementation: `/private/tmp/onboard-code-explore-qa-final.png`
- Markdown implementation: `/private/tmp/onboard-code-markdown-final.png`
- Browser viewport: 1280 × 720 CSS px
- Source pixels: 578 × 608
- Implementation pixels: 1280 × 720
- Browser device pixel ratio: 2; browser screenshots were returned at CSS-pixel dimensions
- State: dark theme, populated Explore results, selected first result; populated Markdown document in edit mode

## Full-view comparison evidence

The source and implementation were opened together. The existing dark palette, cyan language marker, compact sidebar, and quiet border treatment remain consistent. The requested hierarchy is now visible: the method name is the strongest first line, the containing class is the second line, and the source path is the smallest third line. This intentionally increases each row height compared with the former two-line result.

The Markdown document was checked separately because it is not shown in the source crop. The old `라이브 편집` tab is absent; `편집` exposes one continuous textarea and `미리보기` renders the entered heading and list before returning to the editable state.

## Focused region comparison evidence

The Explore result list was inspected at its rendered sidebar width. Method, class, and path values were separately present in the visible DOM for every fixture result. Long paths truncate without widening the row, and the list reported no horizontal overflow before the final scrollbar polish. No additional image assets or icons were introduced.

## Findings

- No remaining P0, P1, or P2 findings.
- Typography: method names have the clearest weight and size; class and path step down consistently and truncate independently.
- Spacing: three-line rows retain compact rhythm without overlap; the language marker aligns with the title line.
- Colors: the existing dark tokens and language colors are preserved.
- Images and assets: the target contains no raster assets requiring recreation.
- Copy: `라이브 편집` was replaced by `편집`; `전체 미리보기` was shortened to `미리보기`.

## Comparison history

1. First implementation capture exposed a light browser scrollbar and horizontal overflow in the result list.
2. The row was constrained to its container and the list received dark, thin scrollbar styling.
3. Post-fix evidence shows a dark scrollbar, independently truncated text, and no clipped method title.

## Interaction checks

- Explore result methods were readable as `createAchievement`, `deleteAchievement`, and `findAchievement` before their class names.
- `라이브 편집` tab count: 0.
- `편집` and `미리보기` tab count: 1 each.
- Entered Markdown rendered as a heading and list in preview and remained editable after returning.
- Browser console errors in the final fixture state: none.

## Implementation checklist

- [x] Remove block-based live Markdown editing.
- [x] Preserve toolbar formatting and line-reference insertion against the continuous textarea.
- [x] Put method, class, and file path on separate visual levels.
- [x] Prevent horizontal overflow for long paths.
- [x] Verify edit/preview switching and visible result hierarchy.

final result: passed

# Confluence Cloud export

Record documents can be copied into a Confluence Cloud page without configuring an Atlassian account or API token in the app.

## Export behavior

Select **Confluence용 복사** in the Record document header. The clipboard receives rich HTML and a plain-text fallback containing:

- the analysis document title;
- the selected function and signature;
- the source file path;
- the Markdown body converted to headings, lists, quotes, inline code, and code blocks;
- tags;
- actual source code in place of every valid `[line:n]` or `[line:n-m]` reference.

For example, `[line:30-35]` becomes a source label and a code block containing lines 30 through 35. References outside the current source file remain visible with a warning instead of silently copying incorrect code.

## Paste into Confluence

1. Open a Confluence Cloud page or live doc in edit mode.
2. Put the cursor where the analysis should start.
3. Paste with `Command+V` on macOS or `Ctrl+V` on Windows.
4. Review the pasted code snippet elements before publishing.

Confluence editor behavior can change independently of this app. The clipboard also contains a Markdown-style plain-text fallback so the content remains usable if a particular editor version rejects rich HTML.

## Data boundary

Copying is local. The app does not call Confluence and stores no Atlassian URL, account, token, space, or page identifier. Source code leaves the machine only when the user pastes the clipboard into Confluence.

# PWA deployment

OnboardCode Web is deployed as a static PWA. The production build must run
entirely in the browser: repository files are read through the browser file
picker, parsed with local WebAssembly grammars, and stored only in the user's
browser storage.

## GitHub Pages

The `Deploy web PWA` workflow builds `apps/web`, runs the privacy audit, uploads
`apps/web/dist`, and deploys that artifact to GitHub Pages.

Required repository setting:

- Settings > Pages > Build and deployment > Source: GitHub Actions

The default Pages URL is:

```text
https://<owner>.github.io/<repository>/
```

When the custom domain is active, the target URL is:

```text
https://onboardcode.app/
```

## Custom domain checklist

Register and verify the domain before adding `apps/web/public/CNAME`. Once the
domain is owned and its DNS is ready, that file must contain only:

```text
onboardcode.app
```

The repository's Pages settings must then set `onboardcode.app` as the custom
domain. DNS is configured outside this repository.

For the apex domain, configure either an `ALIAS`/`ANAME` to the default Pages
domain, or all GitHub Pages `A` records:

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

IPv6 can be added with GitHub Pages `AAAA` records:

```text
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

Do not use wildcard DNS records. After the domain is saved and DNS passes,
GitHub Pages can issue the HTTPS certificate automatically.

## Privacy boundary

The hosted PWA must not upload repository contents, notes, graph state, paths,
or analysis results. `npm run privacy:audit` checks the built `dist` output for:

- unexpected remote `http://` or `https://` URLs outside explicit inert
  documentation or XML namespace strings
- known analytics and telemetry domains
- `sendBeacon` usage and absolute remote `fetch(...)`, XHR, WebSocket,
  EventSource, or `importScripts(...)` endpoints
- required local PWA and WebAssembly assets
- when a verified custom domain is enabled, `CNAME` containing only `onboardcode.app`

The audit intentionally scans published assets rather than source maps,
lockfiles, or dependencies that are not served to users. `web-tree-sitter`
may use browser fetch/XHR internally to load same-origin local `.wasm` assets;
that local asset loading is allowed.

## Browser limitations shown in the UI

The web build must surface browser-only limits in hover help instead of reducing
desktop behavior. The main limitations are:

- Chrome and Edge can use the native folder picker; other browsers can use the
  file-input fallback when directory selection is available
- the PWA cannot open arbitrary absolute paths on its own
- Git branch, commit, dirty-state, and change-impact features are unavailable in
  the browser build
- OPFS and IndexedDB state belong to the current browser profile and may be
  cleared by browser storage settings
- analysis is capped at 5,000 supported source files and 2 MB per file to
  protect browser memory

The desktop app remains the full local app and must not inherit these web-only
limitations.

## References

- GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- GitHub Pages custom domains: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- GitHub Pages HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https

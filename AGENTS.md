# Save Research

Unpacked Manifest V3 Chrome extension. No bundler, no `dist/`. Load the directory that contains `manifest.json`.

## Commands

```
npm test
npm test -- tests/markdown.test.js
python3 -m py_compile yt-dlp-server.py scripts/generate-icons.py
python3 yt-dlp-server.py
curl -sS http://127.0.0.1:11435/health
```

No lint, format, or build script exists. Do not add one for a JS/HTML/CSS change.

### Done

- `npm test` exits 0 with every suite `PASS` (no `FAIL` line).
- A `lib/` change also passes `npm test -- tests/<file>.test.js`. Jest covers `lib/` only (`tests/`); it does not load `background.js`.
- Companion change: `python3 -m py_compile yt-dlp-server.py`, then health JSON contains `"ok": true`.
- Extension change: `chrome://extensions` → Reload this unpacked item. `background.js` and `manifest.json` need that Reload (Chrome caches the service worker). `chat-fab.js` also needs a tab refresh.

## Run

1. `chrome://extensions` → Developer mode → Load unpacked → this repo root.
2. Open the service worker from the extension card for `background.js` logs.
3. YouTube file download / tweet PDF: `python3 yt-dlp-server.py` (binds `127.0.0.1:11435`). Ollama is `11434`. Human install, CORS, LaunchAgent: `README.md`.

## Guardrails

- Need a `src/` or `dist/` tree → keep classic files at repo root and load that folder.
- Want `import` in `background.js` → keep the classic service worker. Share via the `module.exports` block in `lib/markdown.js` and `<script src>` tags in `sidepanel.html`.
- Keep save/settings state in service-worker globals → persist with `chrome.storage` through `getSettings` in `background.js`.
- Fetch remote JS → vendor into `lib/` and declare it. Page-world injects go through `chrome.scripting.executeScript` (`lib/defuddle.js`, `chat-content.js` in `background.js`). Files the page itself may load also go in `manifest.json` `web_accessible_resources`.
- Trim `permissions` / `host_permissions` as cleanup → leave `scripting` and `<all_urls>`; injections need both.
- Send video/PDF work to Ollama → use `yt-dlp-server.py` on port 11435.

`lib/defuddle.js` is vendored. Replace it from the `defuddle` npm package; do not hand-edit.

New `lib/*.js` used by chat: add `<script src>` in `sidepanel.html` before `sidepanel.js`, the CommonJS export block, and `tests/<name>.test.js`.

## Pointers

- `manifest.json` — MV3; `background.service_worker` is `background.js`
- `chat-fab.js` — always-on content script
- `chat-content.js`, `progress.js` — injected on demand from `background.js`
- `scripts/generate-icons.py` writes `icons/icon{16,48,128}.png`

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

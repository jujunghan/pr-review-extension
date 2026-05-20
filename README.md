# pr-review-extension

Chrome extension for reviewing GitHub PRs with Claude Code. Select a code hunk in any PR diff, ask a question in the side panel, get a streaming answer back. PR-scoped conversation context.

## Architecture

```
Chrome Extension (Manifest V3, sidePanel)
    │ chrome.runtime.connectNative
    ▼
Native messaging host (bridge/host.js)
    │ child_process.spawn
    ▼
claude CLI (`claude -p --output-format stream-json --session-id <uuid>`)
```

Each GitHub PR URL is mapped to a UUID session id. Within the same PR the session is resumed (`--resume`) so context accumulates. Switching to a different PR auto-clears the previous mapping.

The host process is spawned and managed by Chrome itself via the Native Messaging API — no separate server to start.

## Requirements

- Node.js 20+
- Claude Code CLI on PATH (`which claude` returns a path)
- Chrome / Chromium-based browser (Manifest V3 + sidePanel API)

## Install

```bash
git clone git@github.com:jujunghan/pr-review-extension.git
cd pr-review-extension
npm install
```

1. In Chrome, open `chrome://extensions` and toggle **Developer mode**.
2. Click **Load unpacked** → select the `extension/` directory.
3. Copy the extension ID shown on the card (e.g. `nfgaabkjpomeocgfedaobhckmkbpojom`).
4. Install the native messaging host manifest:
   ```bash
   npm run install-host -- --ext-id <EXTENSION_ID>
   ```
   Supports `--browser chrome` (default), `chrome-canary`, `brave`, `edge`, `chromium`.

   The install-host script also generates `bridge/host-launcher.sh` that pins node's absolute path and your shell `$PATH`. Re-run it any time your `claude` location, node version, or shell PATH changes.
5. Reload the extension card in `chrome://extensions` once.
6. Pin the toolbar icon and click it on any GitHub PR — the side panel opens.

If the side panel ever shows `Native host has exited`, check `${TMPDIR:-/tmp}/pr-review-host.log` — the launcher appends host stderr there.

## Use

1. Open a GitHub PR diff page (`/<owner>/<repo>/pull/<n>/files`).
2. Open the side panel.
3. **Selection floating action**: select code in the diff → small ✨ button appears next to the selection → click → side panel attaches the selection as context and focuses the input.
4. **Per-line shortcut**: click `+` on a diff line to open GitHub's review comment textarea → `✨ Ask in panel` floats next to it → click to send that line to the side panel as context.
5. **Side panel chat**: ask any question in the side panel input. Within the same PR, follow-ups retain context.
6. Switching to a different PR auto-clears the previous mapping.

## Tests

```bash
npm test
```

Covers the session store and stream-json parser. The host messaging loop is exercised manually.

## Limitations (MVP)

- No PR comment posting (read-only — the user submits the drafted comment via GitHub's own UI)
- Single active PR (concurrent reviews not supported)
- Local single-user only (no auth)
- macOS + Linux native-host install automated; Windows: copy the manifest manually (see below)

### Windows manual install

Save the file at:
```
%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\com.pr_review.bridge.json
```
With contents (substitute paths):
```json
{
  "name": "com.pr_review.bridge",
  "description": "PR Review extension bridge to Claude CLI",
  "path": "C:\\path\\to\\pr-review-extension\\bridge\\host.js",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
}
```
And associate `.js` with `node.exe` (or use a `.bat` wrapper).

# pr-review-extension

Chrome extension for reviewing GitHub PRs with Claude Code. Select a code hunk in any PR diff, ask a question in the side panel, get a streaming answer back. PR-scoped conversation context.

## Architecture

```
Chrome Extension (Manifest V3, sidePanel)
    │ HTTP + SSE
    ▼
Local Bridge Server (Node.js, Express, :8765)
    │ child_process.spawn
    ▼
claude CLI (`claude -p --output-format stream-json --session-id <uuid>`)
```

Each GitHub PR URL is mapped to a UUID session id. Within the same PR the session is resumed (`--resume`) so context accumulates. Switching to a different PR auto-clears the previous mapping.

## Requirements

- Node.js 20+
- Claude Code CLI on PATH (`which claude` returns a path)
- Chrome / Chromium-based browser with Manifest V3 support

## Setup

```bash
cd pr-review-extension
npm install
```

## Run

```bash
npm run bridge:start   # boots Express on http://localhost:8765
```

In Chrome:

1. `chrome://extensions` → toggle **Developer mode**
2. **Load unpacked** → select `extension/` directory
3. Pin the action icon → click it on a GitHub PR to open the side panel

## Use

1. Open a GitHub PR page (`/<owner>/<repo>/pull/<n>`)
2. Open the side panel
3. Select code in the diff — preview appears in the input area
4. Type your question, press Enter
5. Streaming answer renders in the panel; follow-up questions retain the same PR session
6. Click **Clear** to reset conversation (also auto-fires on PR navigation)

## Tests

```bash
npm run bridge:test
```

## Limitations (MVP)

- No PR comment posting (read-only)
- Single active PR (concurrent reviews not supported)
- Local single-user only (no auth)
- No CI/reviewer context auto-injection

# PR Review with Claude

> Unofficial third-party tool. Not affiliated with or endorsed by Anthropic, Inc.
> "Claude" and "Claude Code" are trademarks of Anthropic, Inc.

A Chrome extension that lets you review GitHub pull requests by chatting with
your locally-installed Claude Code CLI. Select a hunk in a PR diff, ask in the
side panel, get a streaming answer. Conversations are scoped per PR — follow-ups
inside the same PR retain context.

## Prerequisites

1. **Claude Code CLI installed and logged in** (Pro / Team / Max subscription
   required). Get it at <https://claude.com/code>.
2. **Node.js 20+** on your `$PATH`.
3. **Chrome / Brave / Edge / Chromium-based browser** with `sidePanel` support.

## Install

### Option 1 — Chrome Web Store (recommended)

1. Install from the Chrome Web Store: **\<link added once approved\>**
2. Open any GitHub pull request and click the toolbar icon — the side panel opens.
3. The side panel shows a one-time setup prompt. Paste it into a `claude` session
   in your terminal, or copy the shell commands if you prefer.

### Option 2 — From source

```bash
git clone https://github.com/jujunghan/pr-review-extension ~/pr-review-extension
cd ~/pr-review-extension
npm install
```

1. In Chrome, open `chrome://extensions` and toggle **Developer mode**.
2. Click **Load unpacked** → select the `extension/` directory.
3. Copy the extension ID Chrome assigns to the card.
4. Install the native messaging host manifest:

```bash
npm run install-host -- --ext-id <YOUR_EXTENSION_ID>
```

Supports `--browser chrome` (default), `chrome-canary`, `brave`, `edge`,
`chromium`. Re-run any time your `claude` binary location or `$PATH` changes.

5. Reload the extension card once.

## Usage

- Open a GitHub PR diff page (`/<owner>/<repo>/pull/<n>/files`) and open the
  side panel.
- **Selection floating action**: select code in the diff → a small ✨ button
  appears → click it → the side panel attaches your selection as context.
- **Per-line shortcut**: click `+` on a diff line → GitHub's review comment
  textarea opens → click "✨ Ask in panel" to send that line to the side panel.
- **Chat**: ask any question in the side panel input. Within the same PR,
  follow-ups retain context. Switching to a different PR clears the previous
  session automatically.

## What this extension doesn't do

This is an AI assistant for pull request review, not a replacement for human
code review. The assistant may hallucinate, miss security issues, misread
context, or be confidently wrong. Always verify suggestions against the
actual code before applying them. Treat AI output as a hint, not a verdict.

The extension never modifies files or executes code on its own. Any code
Claude suggests must be reviewed and applied manually by you.

## Limitations

- **Prompt injection through diff content** is possible. Code you review is
  passed verbatim to Claude as part of the prompt. A malicious PR author
  could attempt to subvert the assistant via crafted diff content. Use your
  judgment; treat AI output for untrusted PRs with extra skepticism.
- **Single active PR** — concurrent reviews are not supported.
- **No comment posting** — read-only; you submit any drafted comment via
  GitHub's own UI.

## Privacy

This extension does not collect, transmit, sell, or share any user data.
Settings are stored only in your browser's local storage. Your selected
code is passed only to your locally-running Claude Code CLI; Anthropic's
own privacy policy governs that exchange.

Full policy: <https://jujunghan.github.io/pr-review-extension/privacy.html>.

## Disclaimer

Provided as-is, without warranty of any kind. The authors are not liable
for any code merged, bugs missed, secrets leaked, downtime caused, or any
other consequence arising from your use of this tool. By using this
extension you accept full responsibility for reviewing AI output before
acting on it.

## Security

To report a vulnerability privately, use GitHub's "Report a vulnerability"
button in the Security tab. See [`SECURITY.md`](SECURITY.md).

## Tests

```bash
npm test
```

Covers the session store, stream-json parser, ext-id resolution, and the
manifest-version sync script. The host messaging loop and the side panel
UI are exercised manually.

## License

MIT. See [`LICENSE`](LICENSE).

## Windows manual install

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

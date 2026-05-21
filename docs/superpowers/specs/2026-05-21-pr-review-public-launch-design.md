# pr-review-extension — Public Launch Design (v1.0.0)

**Date:** 2026-05-21
**Author:** Jeonghan Ju (`jujunghan`)
**Status:** Design — ready for implementation planning

---

## 1. Context & Goal

`pr-review-extension` is a Chrome extension (Manifest V3, side panel) that lets a user select a hunk in a GitHub PR diff and chat with the locally-installed Claude Code CLI about it. Today it is a private repo, v0.1.0, unpacked-install only, distributed only to its author.

**Goal of this launch:** ship v1.0.0 to a broad audience of GitHub-using developers, via **two channels in the same announcement window**:

- **Track A — Chrome Web Store (CWS)** public listing
- **Track B — GitHub public release** with tagged source

"Same window" means both channels are usable inside the same campaign post; we accept that CWS review delay (3–10 days, non-deterministic) means Track B will publish first and Track A follows when approved.

---

## 2. Audience & Scope

### Audience

Developers comfortable running a one-liner in their terminal. Not non-technical users. The extension's hard prerequisite is a locally-installed Claude Code CLI, which already gates the audience.

### In scope (this launch)

- CWS listing for v1.0.0 — full submission package (single purpose, permission justifications, privacy disclosure, store assets, reviewer notes)
- GitHub public release v1.0.0 — tag, CHANGELOG, draft-then-publish via GitHub Actions
- Both channels point to the **same commit** and ship the **same extension zip**
- `LICENSE` (MIT), `SECURITY.md`, `docs/privacy.md` (hosted on GitHub Pages)
- README rewritten for the broader audience: prerequisites, one-paste install path via Claude Code, AI defensive language
- Extension onboarding UX: when native host isn't connected, the side panel shows a copyable Claude Code prompt that performs the entire install
- Side panel disclaimers: first-run banner and per-response footer noting "AI output — verify"
- GitHub Actions release workflow that, on `v*` tag push, builds the extension zip and creates a draft release
- Repo flipped to public on launch day

### Out of scope — won't do (architecturally inappropriate)

- **OS-specific native host installers (.pkg / .msi / .deb).** Adds significant build, signing, notarization, and maintenance surface for an audience that can run a single command. Onboarding UX replaces this.
- **Code signing / notarization for any installer.** No installer to sign.
- **Anthropic API direct-call mode (bypass native host).** Pro/Team plan credits are not accessible to third parties via API; this would silently push users to a separate API billing surface. Conflicts with our audience.
- **Extension-owned OAuth login to Anthropic.** No public third-party endpoint exists for Pro/Team plan credit consumption. `claude` CLI already holds the user's session; reusing it is the right answer, and avoids new token storage / revocation / sandboxing surface.

### Out of scope — defer (revisit after launch)

- Telemetry / usage analytics
- In-extension auto-update checker (CWS auto-updates the CWS install; GitHub install is for advanced users who can `git pull`)
- Multilingual store listing (Korean copy)
- Beta tester / closed-alpha group
- Linux .deb / .rpm packaging beyond a shell script in the install instructions
- Bug bounty, external audit, compliance attestations

---

## 3. Distribution Architecture

Single tag drives both channels. One byte-equal extension zip is the source artifact for CWS and GitHub release.

```
                            v1.0.0 tag
                                │
                ┌───────────────┴────────────────┐
                ▼                                ▼
        Chrome Web Store                  GitHub Release
        (extension zip only)              (extension zip + source)
                │                                │
                ▼                                ▼
        ┌──────────────────┐             ┌──────────────────┐
        │ User installs    │             │ User downloads   │
        │ from CWS         │             │ zip / clones     │
        └────────┬─────────┘             └────────┬─────────┘
                 │                                │
                 └──────────────┬─────────────────┘
                                ▼
            Side panel onboarding detects no native host →
            shows a copy-paste prompt for the user's Claude Code
            session, which installs the host end-to-end.
                                │
                                ▼
                          Chat UI active
```

### Key invariants

- **Single build artifact.** The zip uploaded to CWS and the zip attached to the GitHub release are byte-identical. No conditional builds, no per-channel branches.
- **Native host is never bundled into the extension.** CWS policy forbids shipping arbitrary executables inside an extension package; the host script is open source in the repo and the user installs it locally via the onboarding flow.
- **Extension ID becomes a constant after CWS submission.** When CWS assigns the production extension ID at first submission, that ID is hard-coded as the default in `bridge/install-host.js` (replacing the current dev-only flow), and a follow-up commit captures this change before the GitHub release is tagged.
- **Version source-of-truth = repo root `package.json#version`.** A `scripts/sync-manifest-version.js` step in the release workflow propagates it into `extension/manifest.json#version` during build. Tag format is `v<version>`.

---

## 4. Native Host: Onboarding (Not Installers)

The native host install is a one-time terminal step. Rather than building OS installers, we make that step trivial by leveraging the fact that **every user of this extension already has Claude Code installed**.

### 4.1 Detection

`background.js` attempts `chrome.runtime.connectNative('com.pr_review.bridge')` on startup. Two failure modes:

- Host manifest missing → onboarding screen
- Host manifest present but host script errors → diagnostic screen with link to `${TMPDIR}/pr-review-host.log`

### 4.2 Onboarding screen — content

When host is missing, side panel renders an onboarding view with two side-by-side options. The extension ID is auto-filled from `chrome.runtime.id`; the user does not type it.

**Option A — Paste into Claude Code (recommended).** A read-only text box containing:

> Install the pr-review-extension native host for me.
>
> Steps:
> 1. `git clone https://github.com/jujunghan/pr-review-extension ~/pr-review-extension` (skip if already cloned)
> 2. `cd ~/pr-review-extension && npm install`
> 3. `npm run install-host -- --ext-id <auto-filled chrome.runtime.id>`
> 4. Tell me to reload the PR Review extension in chrome://extensions when you're done.

A single "Copy" button. The user pastes this into any active `claude` session in their terminal.

**Option B — Shell commands.** Three plain shell commands, same content as above, copyable in one block. For users who would rather not delegate to Claude.

### 4.3 Recovery

After the user finishes, they reload the extension. The side panel re-runs `connectNative`; on success the onboarding view is replaced by the chat UI.

A "Test connection" button on the onboarding screen retries `connectNative` immediately, in case the user prefers not to reload.

### 4.4 Not covered here

The exact UI design (layout, copy, "Copy" interaction) is left to the implementation plan. The contract is: **two copyable options, extension ID auto-filled, retry button**.

---

## 5. Chrome Web Store Submission Package

### 5.1 Listing metadata

- **Item name:** `PR Review with Claude`
- **Category:** Developer Tools
- **Visibility:** Public
- **Regions:** All
- **Languages:** English (only)
- **Publisher:** `jujunghan` (personal CWS account, $5 fee already paid)

### 5.2 Single-purpose declaration

> Reviewing GitHub pull requests by sending selected diff/hunk context to a locally-installed Claude Code CLI session and streaming the assistant's response into a side panel.

### 5.3 Permission justifications (1:1 to manifest)

| Permission | Justification (CWS form, English) |
|---|---|
| `sidePanel` | Required UI surface — chat & answer streaming happens in Chrome's side panel, not as a popup or new tab. |
| `nativeMessaging` | Connects to a user-installed local Claude Code CLI via a native messaging host. No external network calls from the extension itself. |
| `activeTab` | Reads the current GitHub PR URL and the user-selected code text from the active diff page only when the user clicks the extension action or the "Ask in panel" button. |
| `storage` | Persists the per-PR session UUID mapping and per-repo local path setting in `chrome.storage.local`. No cloud sync, no remote storage. |
| `host_permissions: https://github.com/*, https://patch-diff.githubusercontent.com/*` | Content script reads the PR diff DOM and fetches the raw `.diff` patch directly from GitHub (avoiding CORS) when the user requests review context. |

### 5.4 Privacy disclosure (CWS data-usage form)

All data-category checkboxes: **No**.
All three certifications: **Yes** (does not sell/transfer user data; does not use data for unrelated purposes; does not use data for credit-related purposes).

Privacy policy URL: `https://jujunghan.github.io/pr-review-extension/privacy.html`
Hosted from `docs/privacy.md` via GitHub Pages (Source: `main` branch, `/docs` folder, default Jekyll theme).

### 5.5 Reviewer notes

> This extension is a thin client for Claude Code, a CLI tool that users install separately. The native messaging host is open source at https://github.com/jujunghan/pr-review-extension/blob/main/bridge/host.js and spawns the user's own `claude` binary as a child process. No remote servers, no telemetry, no analytics. The extension reads PR DOM content from github.com only when the user explicitly initiates an action.
>
> To verify locally: install Claude Code from https://claude.com/code, install this extension, then follow the onboarding panel's setup prompt (which clones the host, installs deps, and registers the native messaging host manifest).

### 5.6 Store assets

- **Icon (128×128 PNG):** existing `extension/icons/128.png`.
- **Screenshots (1280×800 PNG, 3 required):**
  1. Side panel streaming a PR review response next to an open PR diff.
  2. The floating "Ask in panel" button beside selected code in a diff.
  3. The chat UI with the per-line `+` shortcut visible.
- **Small promo tile (440×280):** one tile; improves CWS search ranking. The marquee tile (1400×560) is deferred.

### 5.7 Listing copy

- **Short description (≤132 chars):** `Review GitHub PRs by chatting with Claude Code — select a diff hunk, ask in the side panel, stream answers.`
- **Detailed description:** four paragraphs — what it does / how to install / privacy / open-source link. Ends with the trademark disclaimer and the AI-output disclaimer (see Section 8). Exact final text is in Appendix A.

---

## 6. Repo Hygiene & Release Pipeline

### 6.1 New / changed files

| Path | Action | Notes |
|---|---|---|
| `LICENSE` | New | MIT, copyright `Jeonghan Ju` |
| `CHANGELOG.md` | New | Keep a Changelog format, `## [1.0.0] - 2026-XX-XX` |
| `docs/privacy.md` | New | Per Section 8.2, rendered by GitHub Pages |
| `SECURITY.md` | New | Points to GitHub private vulnerability reporting |
| `README.md` | Rewrite | Per Appendix B |
| `.github/workflows/release.yml` | New | Tag-push triggered build + draft release |
| `scripts/sync-manifest-version.js` | New | Copies `package.json#version` into `extension/manifest.json` |
| `extension/manifest.json` | Edit | `version` → `1.0.0` |
| `package.json` | Edit | `version` → `1.0.0` |
| `extension/sidepanel.html` / `sidepanel.js` / `sidepanel.css` | Edit | Add onboarding view + first-run banner + per-response footer |
| `extension/background.js` | Edit | Treat first `connectNative` failure as "host missing → show onboarding", retain existing recovery behavior |
| `bridge/install-host.js` | Edit | Embed CWS production extension ID as the default; keep `--ext-id` override for dev installs |

### 6.2 Release workflow (skeleton)

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test
      - name: Sync manifest version
        run: node scripts/sync-manifest-version.js
      - name: Pack extension zip
        run: |
          mkdir -p dist
          (cd extension && zip -r ../dist/pr-review-extension-${{ github.ref_name }}.zip .)
      - name: Create draft release
        uses: softprops/action-gh-release@v2
        with:
          draft: true
          files: dist/pr-review-extension-*.zip
          generate_release_notes: true
```

A human edits the draft to copy CHANGELOG entries before publishing. The same zip is uploaded manually to CWS — no automation between the workflow and CWS.

### 6.3 GitHub Pages

- Settings → Pages → Source: `main` branch, `/docs` folder. Default Jekyll theme is acceptable; do not invest in a custom theme.
- Verify `https://jujunghan.github.io/pr-review-extension/privacy.html` returns 200 before the CWS submission references it.

### 6.4 Public-flip preconditions (verified 2026-05-21)

- `.gitignore` covers `.env`, `*.log`, `bridge/host-launcher.sh`, `.DS_Store`, `node_modules/`.
- `git log --all -p | grep -iE '(api[_-]?key|secret|password|token|bearer|authorization:)'` returned no real credentials in 38 commits; only false positives (`token-by-token` streaming language, `DIFF_BYTE_LIMIT` constant).
- No `.env*`, `*.key`, `*.pem`, `secrets*`, `credentials*` files under the tree.

Re-run the same scan immediately before flipping public on launch day.

---

## 7. Launch Sequencing & Rollback

Same-window launch with the explicit acceptance that CWS review delay is outside our control.

### 7.1 Phases

```
[P0] Code & docs prep (private repo)
  └─ LICENSE, CHANGELOG, docs/privacy.md, SECURITY.md, README rewrite,
     onboarding UI, manifest/package version bumps,
     release.yml, sync-manifest-version.js

[P1] Self-verification
  ├─ Unpacked load end-to-end manual run
  ├─ Host removed → onboarding screen renders as designed
  ├─ npm test green
  └─ Dry-run release workflow on a throwaway tag (e.g. v0.99.0-rc1),
     verify zip artifact, then delete the draft release and the tag

[P2] Public flip (~5 min)
  ├─ Re-run sensitive-file & credential scan
  ├─ gh repo edit jujunghan/pr-review-extension --visibility public
  ├─ Settings → Pages enable; confirm privacy.html returns 200
  └─ Note privacy URL for CWS form

[P3] CWS submission (1–2 h)
  ├─ Upload the zip from P1
  ├─ Fill listing metadata, permissions, privacy form, reviewer notes
  ├─ Upload screenshots and small promo tile
  ├─ Submit for review
  └─ Capture the production extension ID, hard-code it as the default
     in bridge/install-host.js, commit on main

[P4] GitHub release v1.0.0 (~10 min)
  ├─ git tag v1.0.0 && git push origin v1.0.0
  ├─ release.yml builds and creates a draft release
  ├─ Edit notes from CHANGELOG
  └─ Publish release as Latest

[P5] CWS review wait (3–10 days, non-deterministic)
  ├─ If rejected: address feedback, resubmit; GitHub release v1.0.0 is unaffected
  └─ If approved: extension auto-publishes

[P6] Announcement & visibility
  ├─ Patch commit + v1.0.1 to add the CWS link to README
  ├─ Update GitHub release notes with the CWS link
  └─ Announce on chosen channels
```

### 7.2 Ordering constraints

- **P2 must precede P3.** The reviewer notes link to repo files; a 404 from a still-private repo causes an automatic reject.
- **P3 must precede P4.** The production extension ID is only known after CWS first-submit; `install-host.js` defaults need to capture it before the source-distribution tag is cut.
- **P5 is external and stochastic.** Plan the public announcement (P6) to fire when P5 is done, not on a fixed date.

### 7.3 Rollback / contingency

| Trigger | Response |
|---|---|
| CWS rejects on reviewer-note or privacy grounds | Fix copy / privacy doc, resubmit same zip. GitHub release v1.0.0 stays valid. |
| CWS rejects on code grounds | Code change → bump to v1.0.1 → tag → workflow builds new zip → CWS resubmit. If v1.0.0 GitHub release is already public, mark it deprecated in the release notes and promote v1.0.1 to Latest. |
| Critical bug discovered post-launch | Hotfix → v1.0.1 → both channels. In-extension banner with `chrome.storage`-driven dismissal for known-issue communication if severe. |
| Production extension ID drift between P3 and P4 | Patch `install-host.js` default ext-id → users re-run `npm run install-host`. Communicate via release notes and onboarding banner. |
| Sensitive content discovered post-public-flip | Use `git filter-repo`, force-push, revoke any exposed credentials immediately. (Pre-flip scan in P2 minimizes likelihood.) |
| Anthropic sends a cease-and-desist over the name | Rename to `PR Reviewer for Claude Code`, file a new CWS listing under the new name, leave the original install path as a graceful redirect for ~60 days. Not pre-built; contingency only. |

### 7.4 Definition of Done

- ☐ Extension is discoverable on CWS and "Add to Chrome" works
- ☐ On a fresh machine without claude CLI, CWS install → side panel onboarding renders the prerequisite warning correctly
- ☐ On a machine with claude CLI, CWS install → paste the onboarding prompt into Claude Code → full install completes → chat works end-to-end
- ☐ GitHub release v1.0.0 is Latest, `.zip` asset is downloadable
- ☐ `https://jujunghan.github.io/pr-review-extension/privacy.html` is reachable and content matches the CWS privacy form
- ☐ AI-output disclaimer present on its four surfaces (8.1): README "What it doesn't do" section, CWS detailed description, side panel first-run banner, side panel response footer
- ☐ Trademark disclaimer present on its four surfaces (8.3): README header, CWS short description tail, CWS detailed description first paragraph, side panel onboarding footer

---

## 8. AI / Legal / Trust Defenses

This section is load-bearing. Each item below maps to a concrete change.

### 8.1 AI-output disclaimer (four placements)

Verbatim text, used identically in all four surfaces:

> AI-generated. Verify before merging. Not a substitute for human review.

Long-form variant for README and CWS detailed description:

> This is an AI assistant for pull request review, not a replacement for human code review. The assistant may hallucinate, miss security issues, misread context, or be confidently wrong. Always verify suggestions against the actual code before applying them. Treat AI output as a hint, not a verdict.

Surfaces:
1. README — dedicated "What it doesn't do" section.
2. CWS detailed description — final paragraph.
3. Side panel — first-run banner, dismissible, dismissal persisted via `chrome.storage.local`.
4. Side panel — footer line below the first assistant response in any new session.

### 8.2 Honest data-flow disclosure (two paragraphs, both required)

In `docs/privacy.md`, side by side:

> **What this extension does with your data**
> Nothing. We do not run servers, do not collect telemetry, do not log usage, and have no analytics. All settings (per-PR session UUIDs, per-repo local paths) are stored in your browser's local storage and never leave your machine through this extension.
>
> **What happens to the code you send to Claude**
> When you initiate an action (selection, "Ask in panel", or chat), the selected diff/code and your prompt are passed to your locally-installed Claude Code CLI via Chrome's native messaging. Claude Code then communicates with Anthropic's servers under your own Anthropic account. Anthropic's privacy policy and data usage terms apply to that exchange — not ours. We have no visibility into, and no control over, what Anthropic does with that data. See Anthropic's [usage policy](https://www.anthropic.com/legal/usage-policy) and [privacy policy](https://www.anthropic.com/legal/privacy).

### 8.3 Trademark safety (Anthropic / Claude)

- Keep the name `PR Review with Claude` (nominative fair use — describing compatibility).
- Display this disclaimer on README header, CWS short description tail, CWS detailed description first paragraph, side panel onboarding footer:

> Unofficial third-party tool. Not affiliated with or endorsed by Anthropic, Inc. "Claude" and "Claude Code" are trademarks of Anthropic, Inc.

- Do not use Anthropic's logo, brand colors, or fonts. Current star/gradient icon is fine.
- Do not write "official Claude extension" or any phrasing that implies endorsement. "Powered by Claude" is acceptable.
- CWS publisher name does not include "Claude".
- Rename contingency (see 7.3) documented only; no pre-work.

### 8.4 Prompt-injection acknowledgment

README "Limitations" section adds:

> Code you review is passed verbatim to Claude as part of the prompt. A malicious PR author could attempt prompt injection through diff content. Use your judgment; treat AI output for untrusted PRs with extra skepticism.

### 8.5 No-execution promise

README clarifies the safety boundary:

> The extension never modifies files or executes code on its own. Any code Claude suggests must be reviewed and applied manually by you.

### 8.6 Liability disclaimer

README "Disclaimer" section (in addition to the MIT `AS IS` clause):

> Provided as-is, without warranty of any kind. The authors are not liable for any code merged, bugs missed, secrets leaked, downtime caused, or any other consequence arising from your use of this tool. By using this extension you accept full responsibility for reviewing AI output before acting on it.

### 8.7 CWS "AI extension" policy checklist

- ✅ AI usage stated in detailed description's first sentence (`uses Anthropic's Claude AI`).
- ✅ Model selection deferred to user's CLI config (we don't choose).
- ✅ Limitations stated (8.1 covers this).
- ✅ Input/output not stored by us (8.2 covers this).
- ✅ User responsibility for input/output asserted (8.5, 8.6).

### 8.8 Contact channel

CWS support contact and privacy-policy contact both use:

> `https://github.com/jujunghan/pr-review-extension/issues`

No personal email is exposed publicly. CWS accepts URL contacts.

### 8.9 Security reporting

`SECURITY.md`:

```markdown
# Security Policy

## Reporting a Vulnerability

If you discover a security issue, please use GitHub's private vulnerability
reporting feature in the Security tab of this repository, rather than opening
a public issue.

Out of scope:
- Issues in `claude` CLI itself — report those to Anthropic.
- Prompt injection through diff content — see README "Limitations".
```

---

## 9. Open / Deferred Items (post-launch)

Tracked here so they are not forgotten but not in scope:

- Telemetry (opt-in, anonymous usage counters) — revisit if user feedback says onboarding success rate is low.
- In-extension update checker — revisit only if a critical advisory needs out-of-band reach.
- Multilingual (Korean) listing copy and README.
- Anthropic API direct-call mode — revisit only if Anthropic publishes a third-party endpoint that consumes Pro/Team plan credits.
- OS installers — revisit only if a non-trivial cohort of "I want this but won't run npm install" feedback emerges.

---

## Appendix A — CWS Detailed Description (final copy)

> **PR Review with Claude** uses Anthropic's Claude AI to help you review GitHub pull requests, right inside Chrome's side panel.
>
> Select a diff hunk, click the floating ✨ button, and ask a question. The extension forwards your selection and prompt to a Claude Code CLI session running locally on your machine and streams the response back into the side panel. Conversations are scoped per PR — follow-ups inside the same PR retain context.
>
> **Requirements:** You must have Claude Code installed and logged in (Pro, Team, or Max subscription) — see https://claude.com/code. After installing the extension from Chrome Web Store, the side panel will guide you through a one-time native host setup (a single command that can be pasted into your existing Claude Code session).
>
> **Privacy:** This extension does not collect, transmit, or store any user data. It has no servers, no telemetry, no analytics. Your PR content is passed only to your locally-installed Claude Code CLI; Anthropic's own privacy policy then governs that exchange. Full policy: https://jujunghan.github.io/pr-review-extension/privacy.html.
>
> **Open source:** https://github.com/jujunghan/pr-review-extension (MIT). The native messaging host script is auditable in `bridge/host.js`.
>
> **AI-output disclaimer:** This is an AI assistant for pull request review, not a replacement for human code review. The assistant may hallucinate, miss security issues, misread context, or be confidently wrong. Always verify suggestions against the actual code before applying them. Treat AI output as a hint, not a verdict.
>
> **Trademarks:** Unofficial third-party tool. Not affiliated with or endorsed by Anthropic, Inc. "Claude" and "Claude Code" are trademarks of Anthropic, Inc.

---

## Appendix B — README Skeleton

```
# PR Review with Claude

> Unofficial third-party tool. Not affiliated with or endorsed by Anthropic, Inc.
> "Claude" and "Claude Code" are trademarks of Anthropic, Inc.

[3–4 sentence what-it-does paragraph]

## Prerequisites
1. Claude Code CLI installed and logged in (Pro/Team/Max subscription required)
   — https://claude.com/code
2. Node.js 20+
3. Chrome / Brave / Edge / Chromium-based browser

## Install

### Option 1 — Chrome Web Store (recommended)
1. Install from CWS: <link added after P5>
2. Open any GitHub PR; click the toolbar icon → side panel opens
3. The side panel shows a one-time setup prompt. Paste it into your terminal
   `claude` session, or copy the shell commands if you prefer.

### Option 2 — From source
[git clone / npm install / npm run install-host -- --ext-id <ID>]

## Usage
[brief — selection, Ask-in-panel, side panel chat, per-PR context]

## What this extension doesn't do (read this)
[8.1 long-form disclaimer]

## Limitations
- AI may hallucinate. Verify before merging.
- [8.4 prompt-injection language]
- [8.5 no-execution language]
- Single active PR; concurrent reviews not supported.

## Privacy
We collect nothing. See `docs/privacy.md`. Your selected code is passed only
to your local Claude Code CLI; Anthropic's privacy policy governs that
exchange.

## Disclaimer
[8.6]

## Security
See `SECURITY.md`.

## License
MIT. See `LICENSE`.
```

---

## Appendix C — Implementation reminders

- `bridge/install-host.js`'s embedded CWS extension ID is set in **P3** of Section 7, not earlier.
- `extension/manifest.json#version` is set by the workflow at build time, not committed to repo.
- The privacy URL in CWS form must exactly match the GitHub Pages URL; case-sensitive.
- Re-run the credential-scan and `.env`-scan immediately before flipping the repo public.

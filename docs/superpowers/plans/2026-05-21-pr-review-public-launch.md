# Public Launch v1.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship pr-review-extension v1.0.0 to Chrome Web Store and a public GitHub release in the same announcement window, with onboarding UX that walks new users through native host setup via a Claude Code prompt instead of OS installers.

**Architecture:** Single byte-equal extension zip drives both channels. CWS-listing copy, AI disclaimers, and trademark notices live verbatim on the surfaces required by the spec. Native host install remains a one-time terminal command, rendered as a copy-pasteable Claude Code prompt in the side panel when `connectNative` fails. GitHub Actions on tag push produces the release zip; CWS submission uses the same artifact.

**Tech Stack:** Chrome MV3 (sidePanel, nativeMessaging), Node 20+, vanilla JS, `node --test`, GitHub Actions, GitHub Pages (Jekyll default).

**Spec:** `docs/superpowers/specs/2026-05-21-pr-review-public-launch-design.md` (commit 589e23a).

---

## Conventions

- **Working directory:** `/Users/jujeonghan/Projects/pr-review-extension`.
- **Branch:** all work happens on `main` (this repo's existing pattern — recent commits include `feat:`, `fix(extension):` style messages merged via PR).
- **Commit style:** match existing convention. Each task ends with a `git commit` step using the format shown in that task.
- **Co-author trailer:** include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` on every commit (matches the spec commit `589e23a`).
- **TDD scope:** the project's existing test convention (per README: "The host messaging loop is exercised manually") is unit tests for bridge/* only; extension UI is verified manually. This plan follows that — TDD where a unit-testable artifact exists (Task 5), manual verification elsewhere (Task 13).
- **Production CWS extension ID is unknown until P3** (Task 14 in the operational checklist). All P0 code keeps the existing dev `--ext-id` flow intact and only adds a clearly-marked placeholder constant.

---

## File Structure

Files this plan creates or modifies, grouped by responsibility:

| Path | Status | Responsibility |
|---|---|---|
| `LICENSE` | create | MIT license text, copyright "Jeonghan Ju" |
| `CHANGELOG.md` | create | Keep-a-Changelog format, v1.0.0 entry |
| `SECURITY.md` | create | Points to GitHub private vulnerability reporting |
| `docs/privacy.md` | create | Privacy policy rendered by GitHub Pages |
| `README.md` | rewrite | Broad-audience onboarding, prerequisites, disclaimers |
| `package.json` | edit | Version → `1.0.0` |
| `extension/manifest.json` | edit | Version → `1.0.0` (committed once at end; CI also rewrites it at build time) |
| `scripts/sync-manifest-version.js` | create | Reads `package.json#version`, writes `extension/manifest.json#version`. Used by the release workflow and runnable locally. |
| `scripts/test/sync-manifest-version.test.js` | create | Unit test for the sync script |
| `package.json` | edit | Add `"test:scripts"` script and wire `npm test` to run bridge + scripts tests |
| `.github/workflows/release.yml` | create | Tag-push triggered build + draft release |
| `extension/background.js` | edit | Add `getHostStatus` message handler that probes `connectNative` and reports status |
| `extension/sidepanel.html` | edit | Add onboarding view container + first-run banner placeholder + footer disclaimer |
| `extension/sidepanel.js` | edit | On init, ask background for host status; render onboarding view if missing; persist first-run banner dismissal |
| `extension/sidepanel.css` | edit | Styles for onboarding view, banner, footer |
| `bridge/install-host.js` | edit | Add a clearly-marked `DEFAULT_PROD_EXT_ID` constant (placeholder until P3) and a `PR_REVIEW_EXT_ID` env-var fallback so the GitHub-installer path can run without `--ext-id` once the constant is set |
| `bridge/test/install-host-args.test.js` | create | Unit test for ext-id resolution priority (flag > env > default) |

Out of scope for this plan (deferred to spec §9):
- `chrome.scripting`, telemetry, multilingual strings, API/OAuth mode, OS installers, code signing.

---

## Task 1: License + repo legal boilerplate

**Files:**
- Create: `LICENSE`
- Create: `SECURITY.md`

- [ ] **Step 1: Write `LICENSE` — standard MIT text, copyright "Jeonghan Ju"**

```
MIT License

Copyright (c) 2026 Jeonghan Ju

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write `SECURITY.md`**

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

- [ ] **Step 3: Commit**

```bash
git add LICENSE SECURITY.md
git commit -m "$(cat <<'EOF'
docs: add MIT license and security policy

Prereq for public release: LICENSE establishes the AS-IS warranty
disclaimer the spec §8.6 leans on, and SECURITY.md routes vuln reports
to GitHub's private channel instead of public issues.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CHANGELOG

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — TBD-publish-date

First public release.

### Added
- Chrome Web Store listing.
- GitHub release pipeline (tag-push triggers `release.yml`, produces `pr-review-extension-v*.zip`).
- MIT `LICENSE`, `SECURITY.md`, `docs/privacy.md` (hosted on GitHub Pages).
- Side panel onboarding view: when the native messaging host is missing, surfaces a copy-paste Claude Code prompt that performs the install end-to-end.
- First-run AI-output disclaimer banner (dismissible) and per-response footer.
- Trademark disclaimer on README header, side panel onboarding footer, and CWS listing surfaces.

### Changed
- Version bumped to `1.0.0`.
- Manifest version is now synced from root `package.json` at build time (`scripts/sync-manifest-version.js`); the committed value in `extension/manifest.json` is the canonical source only for local unpacked loads.
- `bridge/install-host.js` now accepts an `ext-id` via flag, `PR_REVIEW_EXT_ID` env var, or a built-in production default (set at first CWS submission).

### Notes
- This release is the first public version; the prior `0.1.x` versions were private development.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: add CHANGELOG with v1.0.0 entry

Keep-a-Changelog format; entry will be referenced by GitHub release
notes via the workflow's generate_release_notes plus a manual edit.
Date is left as TBD-publish-date until the v1.0.0 tag is cut (P4 of
the launch sequencing).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Privacy policy (GitHub Pages source)

**Files:**
- Create: `docs/privacy.md`

- [ ] **Step 1: Write `docs/privacy.md` with the verbatim disclosure from spec §8.2**

```markdown
---
title: Privacy Policy — PR Review with Claude
---

# Privacy Policy

_Last updated: 2026-05-21_

## What this extension does with your data

Nothing. We do not run servers, do not collect telemetry, do not log usage,
and have no analytics. All settings (per-PR session UUIDs, per-repo local
paths) are stored in your browser's local storage and never leave your
machine through this extension.

## What happens to the code you send to Claude

When you initiate an action (selection, "Ask in panel", or chat), the
selected diff/code and your prompt are passed to your locally-installed
Claude Code CLI via Chrome's native messaging. Claude Code then communicates
with Anthropic's servers under your own Anthropic account. Anthropic's
privacy policy and data usage terms apply to that exchange — not ours. We
have no visibility into, and no control over, what Anthropic does with that
data. See Anthropic's
[usage policy](https://www.anthropic.com/legal/usage-policy) and
[privacy policy](https://www.anthropic.com/legal/privacy).

## Contact

If you have privacy questions or want to report an issue, open a ticket at
[github.com/jujunghan/pr-review-extension/issues](https://github.com/jujunghan/pr-review-extension/issues).

## Trademarks

Unofficial third-party tool. Not affiliated with or endorsed by Anthropic,
Inc. "Claude" and "Claude Code" are trademarks of Anthropic, Inc.
```

- [ ] **Step 2: Commit**

```bash
git add docs/privacy.md
git commit -m "$(cat <<'EOF'
docs: add privacy policy for GitHub Pages

CWS submission needs a public privacy URL. docs/ is the GitHub Pages
source root; rendered URL will be
https://jujunghan.github.io/pr-review-extension/privacy.html once
Pages is enabled in P2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Version sync script (TDD)

The release workflow needs to overwrite `extension/manifest.json#version` from `package.json#version` at build time so the single source-of-truth is root `package.json`. Locally, the committed manifest value tracks `package.json` (we just commit them together), but the script makes CI deterministic.

**Files:**
- Create: `scripts/sync-manifest-version.js`
- Create: `scripts/test/sync-manifest-version.test.js`
- Modify: `package.json` (root) — add `test:scripts` and rewire `npm test`

- [ ] **Step 1: Write the failing test**

`scripts/test/sync-manifest-version.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncManifestVersion } from '../sync-manifest-version.js';

function mkdirSyncIfMissing(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function makeTree({ pkgVersion, manifestVersion }) {
  const root = mkdtempSync(join(tmpdir(), 'sync-manifest-'));
  writeFileSync(join(root, 'package.json'),
    JSON.stringify({ name: 'fake', version: pkgVersion }, null, 2));
  const extDir = join(root, 'extension');
  mkdirSyncIfMissing(extDir);
  writeFileSync(join(extDir, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, name: 'Fake', version: manifestVersion }, null, 2));
  return root;
}

test('syncs version from package.json into extension/manifest.json', () => {
  const root = makeTree({ pkgVersion: '1.0.0', manifestVersion: '0.0.0' });
  try {
    syncManifestVersion({ root });
    const m = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
    assert.equal(m.version, '1.0.0');
    assert.equal(m.manifest_version, 3, 'other fields are preserved');
    assert.equal(m.name, 'Fake');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('is a no-op when versions already match', () => {
  const root = makeTree({ pkgVersion: '1.0.0', manifestVersion: '1.0.0' });
  try {
    const before = readFileSync(join(root, 'extension', 'manifest.json'), 'utf8');
    syncManifestVersion({ root });
    const after = readFileSync(join(root, 'extension', 'manifest.json'), 'utf8');
    assert.equal(before, after, 'file is byte-identical on a no-op');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('throws when package.json has no version field', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-manifest-novers-'));
  try {
    writeFileSync(join(root, 'package.json'),
      JSON.stringify({ name: 'fake' }, null, 2));
    mkdirSyncIfMissing(join(root, 'extension'));
    writeFileSync(join(root, 'extension', 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'Fake', version: '0.0.0' }, null, 2));
    assert.throws(() => syncManifestVersion({ root }),
      /version field/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails (script does not exist)**

```
node --test 'scripts/test/**/*.test.js'
```

Expected: FAIL with `Cannot find module '../sync-manifest-version.js'` (or similar import error).

- [ ] **Step 3: Implement `scripts/sync-manifest-version.js`**

```javascript
#!/usr/bin/env node
// Reads version from <root>/package.json and writes it into
// <root>/extension/manifest.json. The release workflow runs this on a fresh
// checkout so the zipped manifest carries the tagged version without
// requiring the engineer to remember to bump two files.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function syncManifestVersion({ root }) {
  const pkgPath = join(root, 'package.json');
  const manifestPath = join(root, 'extension', 'manifest.json');

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`${pkgPath} has no "version" field`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version === pkg.version) return;

  manifest.version = pkg.version;
  // Preserve 2-space indentation + trailing newline to match existing file.
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
})();

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '..');
  syncManifestVersion({ root });
  console.log(`extension/manifest.json synced to package.json version`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```
node --test 'scripts/test/**/*.test.js'
```

Expected: PASS (3 tests).

- [ ] **Step 5: Wire `npm test` in root `package.json` to include scripts tests**

The current root `package.json`:

```json
{
  "name": "pr-review-extension",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["bridge"],
  "scripts": {
    "install-host": "node bridge/install-host.js",
    "test": "node --test 'bridge/test/**/*.test.js'"
  }
}
```

Change the `scripts` block to:

```json
  "scripts": {
    "install-host": "node bridge/install-host.js",
    "sync-manifest-version": "node scripts/sync-manifest-version.js",
    "test:bridge": "node --test 'bridge/test/**/*.test.js'",
    "test:scripts": "node --test 'scripts/test/**/*.test.js'",
    "test": "npm run test:bridge && npm run test:scripts"
  }
```

- [ ] **Step 6: Verify `npm test` passes end-to-end**

```
npm test
```

Expected: bridge tests pass, then scripts tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/sync-manifest-version.js scripts/test/sync-manifest-version.test.js package.json
git commit -m "$(cat <<'EOF'
build: add sync-manifest-version script with tests

Establishes root package.json#version as the single source of truth.
The release workflow runs this on a fresh checkout so the zipped
manifest always carries the tagged version. Locally we still commit
both files together; this script just makes CI deterministic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Release workflow (GitHub Actions)

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: release
on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install root deps
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Sync manifest version from tag
        run: npm run sync-manifest-version
      - name: Pack extension zip
        run: |
          mkdir -p dist
          cd extension && zip -r "../dist/pr-review-extension-${GITHUB_REF_NAME}.zip" .
      - name: Create draft release
        uses: softprops/action-gh-release@v2
        with:
          draft: true
          files: dist/pr-review-extension-*.zip
          generate_release_notes: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
build: add tag-push release workflow

On any v* tag push, runs tests, syncs the manifest version to the tag,
zips extension/ and uploads it to a draft GitHub release. The draft is
then hand-edited (CHANGELOG → release notes) before being published.
The same zip is uploaded manually to CWS so both channels ship a
byte-equal artifact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: install-host.js — add placeholder constant + env-var fallback (TDD)

The production CWS extension ID is unknown until P3 (the first CWS submission returns it). Until then, the script must keep working with `--ext-id` for dev installs. After P3, a follow-up commit replaces the placeholder so end users can run `npm run install-host` without arguments.

**Files:**
- Modify: `bridge/install-host.js`
- Create: `bridge/test/install-host-args.test.js`

The current ext-id resolution (lines 26–31 of `bridge/install-host.js`):

```javascript
const extId = arg('ext-id');
if (!extId || !/^[a-p]{32}$/.test(extId)) {
  console.error('Error: pass --ext-id <32-char extension id>');
  console.error('Find it in chrome://extensions (Developer mode).');
  process.exit(1);
}
```

We will refactor this into a pure helper `resolveExtId({ argv, env, defaultId })` that returns the id or null, and test the priority. The script's own `process.exit` flow stays the same.

- [ ] **Step 1: Write the failing test**

`bridge/test/install-host-args.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExtId, DEFAULT_PROD_EXT_ID } from '../install-host.js';

const VALID_A = 'a'.repeat(32);
const VALID_B = 'b'.repeat(32);
const INVALID = 'not-an-ext-id';

test('flag --ext-id wins over env and default', () => {
  const id = resolveExtId({
    argv: ['--ext-id', VALID_A],
    env: { PR_REVIEW_EXT_ID: VALID_B },
    defaultId: 'c'.repeat(32),
  });
  assert.equal(id, VALID_A);
});

test('env PR_REVIEW_EXT_ID is used when flag missing', () => {
  const id = resolveExtId({
    argv: [],
    env: { PR_REVIEW_EXT_ID: VALID_B },
    defaultId: 'c'.repeat(32),
  });
  assert.equal(id, VALID_B);
});

test('default is used when flag and env both missing', () => {
  const id = resolveExtId({
    argv: [],
    env: {},
    defaultId: VALID_A,
  });
  assert.equal(id, VALID_A);
});

test('returns null when nothing resolves to a valid id', () => {
  const id = resolveExtId({
    argv: [],
    env: {},
    defaultId: 'PLACEHOLDER_UNTIL_CWS_SUBMISSION',
  });
  assert.equal(id, null);
});

test('returns null when --ext-id has invalid format', () => {
  const id = resolveExtId({
    argv: ['--ext-id', INVALID],
    env: { PR_REVIEW_EXT_ID: VALID_A },
    defaultId: VALID_B,
  });
  // Invalid flag is a user error — do not silently fall back.
  assert.equal(id, null);
});

test('DEFAULT_PROD_EXT_ID is the documented placeholder until P3', () => {
  assert.equal(DEFAULT_PROD_EXT_ID, 'PLACEHOLDER_UNTIL_CWS_SUBMISSION');
});
```

- [ ] **Step 2: Run test to verify it fails**

```
node --test 'bridge/test/install-host-args.test.js'
```

Expected: FAIL — `resolveExtId` and `DEFAULT_PROD_EXT_ID` not exported.

- [ ] **Step 3: Refactor `bridge/install-host.js` to expose the helper**

Replace the top of `bridge/install-host.js` (lines 1–31) with:

```javascript
#!/usr/bin/env node
// Installs the Chrome native messaging host manifest so the extension
// (identified by --ext-id, $PR_REVIEW_EXT_ID, or the built-in production
// default) can spawn bridge/host.js.
//
// Usage:
//   npm run install-host                          # uses DEFAULT_PROD_EXT_ID
//   npm run install-host -- --ext-id <ID>         # dev override
//   PR_REVIEW_EXT_ID=<ID> npm run install-host    # CI / scripted override
//
// Manifest destination depends on the OS and browser:
//   macOS Chrome   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts
//   Linux Chrome   ~/.config/google-chrome/NativeMessagingHosts
//   (Brave/Edge/Chromium-derivatives can use --browser to override the dir.)

import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';

const HOST_NAME = 'com.pr_review.bridge';

// IMPORTANT: this placeholder is replaced with the real CWS-assigned
// production extension ID in a follow-up commit after the first CWS
// submission (P3 of docs/superpowers/specs/2026-05-21-pr-review-public-launch-design.md).
// Until then, end users must pass --ext-id or set PR_REVIEW_EXT_ID. Do not
// hard-code a real ID here as part of P0.
export const DEFAULT_PROD_EXT_ID = 'PLACEHOLDER_UNTIL_CWS_SUBMISSION';

const EXT_ID_RE = /^[a-p]{32}$/;

function readFlag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function resolveExtId({ argv, env, defaultId }) {
  const flag = readFlag(argv, 'ext-id');
  if (flag !== undefined) {
    return EXT_ID_RE.test(flag) ? flag : null;
  }
  const envId = env.PR_REVIEW_EXT_ID;
  if (envId && EXT_ID_RE.test(envId)) return envId;
  if (defaultId && EXT_ID_RE.test(defaultId)) return defaultId;
  return null;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (!isMainModule()) {
  // When imported (e.g. tests), stop here — do not run the installer.
} else {

const args = process.argv.slice(2);

function arg(name) { return readFlag(args, name); }

const extId = resolveExtId({
  argv: args,
  env: process.env,
  defaultId: DEFAULT_PROD_EXT_ID,
});

if (!extId) {
  console.error('Error: could not resolve a valid extension ID.');
  console.error('Pass --ext-id <32-char id>, set PR_REVIEW_EXT_ID, or wait');
  console.error('for the published version where DEFAULT_PROD_EXT_ID is set.');
  console.error('Find your ID in chrome://extensions (Developer mode).');
  process.exit(1);
}

const browser = arg('browser') || 'chrome';
```

Then **keep everything from the current line 35 (`const here = dirname(fileURLToPath(import.meta.url));`) through the end of the file**, but wrap the final block inside the existing `} else {` from above. The simplest way is to add a closing `}` at the very end of the file.

The resulting structure is:

```
imports
constants + EXPORTS
helper functions + EXPORTS
isMainModule()
if (!isMainModule()) {
  // tests stop here
} else {
  // existing installer body (lines 35-end of original file)
}
```

Concretely: at the very end of `bridge/install-host.js`, append a single `}` to close the `else` block.

- [ ] **Step 4: Run tests to verify they pass**

```
node --test 'bridge/test/install-host-args.test.js'
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run the script smoke-test (does it still abort cleanly without args?)**

```
node bridge/install-host.js
```

Expected: prints "Error: could not resolve a valid extension ID..." and exits non-zero.

```
node bridge/install-host.js --ext-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Expected: attempts to write manifest (this is your local Chrome dir; OK to actually write, the path is `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.pr_review.bridge.json`, which is what the dev workflow already uses). If you don't want to touch your local Chrome state, run with `--browser chromium` to point at the chromium dir (likely empty on macOS) or skip this sub-step.

- [ ] **Step 6: Run full test suite**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add bridge/install-host.js bridge/test/install-host-args.test.js
git commit -m "$(cat <<'EOF'
feat(bridge): resolve ext-id from flag, env, or production default

Refactors arg parsing into a pure resolveExtId() helper so we can unit
test the priority (flag > env > default). DEFAULT_PROD_EXT_ID is a
loud placeholder until P3 of the launch sequence, when the real
CWS-assigned production ID replaces it in a follow-up commit. Dev
unpacked installs continue to work via --ext-id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Background — host status detection

The side panel needs to know whether `com.pr_review.bridge` is reachable so it can either render the chat UI or the onboarding view. Existing code already attempts `connectNative` lazily inside `nativeSend`, but there is no message channel for "host probe only".

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: Extract the port message handler so a probe path can reuse it**

In `extension/background.js`, the current `ensurePort` body (lines 21–63) inlines two listeners. Extract the `onMessage` body into a named `routeIncoming(msg)` and the `onDisconnect` body into a named `handleDisconnect()`. Add a `lastHostError` module-level variable so the disconnect signal can be surfaced later. Replace lines 21–63 with:

```javascript
let lastHostError = '';

function routeIncoming(msg) {
  console.log('[PR Review BG] port recv', msg.type, 'id=', msg.id,
    msg.type === 'delta' ? `text.len=${msg.text?.length}` : '');
  const handler = pending.get(msg.id);
  if (!handler) {
    console.warn('[PR Review BG] no handler for id', msg.id);
    return;
  }
  if (msg.type === 'delta') handler.onDelta?.(msg.text);
  else if (msg.type === 'done') { handler.onDone?.(msg.sessionId); pending.delete(msg.id); }
  else if (msg.type === 'error') { handler.onError?.(msg.message); pending.delete(msg.id); }
  else if (msg.type === 'ok') { handler.onDone?.(); pending.delete(msg.id); }
}

function handleDisconnect() {
  const err = chrome.runtime.lastError?.message || 'Native host disconnected';
  lastHostError = err;
  console.warn('[PR Review BG] port disconnect:', err, 'pending=', pending.size);
  const toRetry = [];
  for (const [, handler] of pending) {
    if (!handler._retried && !handler._sawDelta && handler._req) {
      handler._retried = true;
      toRetry.push(handler);
    } else {
      handler.onError?.(err);
    }
  }
  pending.clear();
  port = null;
  broadcast({ type: 'hostStatus', status: 'missing', error: err });
  for (const h of toRetry) {
    nativeSend(h._req, h);
  }
}

function ensurePort() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    port = null;
    lastHostError = err?.message || 'connectNative threw';
    return null;
  }
  port.onMessage.addListener(routeIncoming);
  port.onDisconnect.addListener(handleDisconnect);
  return port;
}
```

The behavior is unchanged for existing callers; we just made the listeners reusable and added a place to record the disconnect reason.

- [ ] **Step 2: Add the `probeHostStatus` helper near the end of the file**

Append after the existing `ingestDiff` function:

```javascript
// Returns 'ready' if we already hold a live port, 'probing' if we just
// opened one (the side panel should re-poll on the upcoming hostStatus
// broadcast), or 'missing' if connectNative threw. connectNative throws
// synchronously only when the native host manifest is entirely absent;
// connection failures surface later via the existing handleDisconnect.
function probeHostStatus() {
  if (port) return 'ready';
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener(routeIncoming);
    port.onDisconnect.addListener(handleDisconnect);
    return 'probing';
  } catch {
    return 'missing';
  }
}
```

- [ ] **Step 3: Add the `getHostStatus` message handler**

In the existing `chrome.runtime.onMessage.addListener` block, add a new branch after the `getRepoPath` handler (after line 178 of the original file):

```javascript
    if (msg.type === 'getHostStatus') {
      sendResponse({ status: probeHostStatus() });
      return;
    }
```

- [ ] **Step 4: Manual smoke test — host present**

Reload the extension at `chrome://extensions` (your dev unpacked load with the local native host already installed). Open the side panel on a GitHub PR.

Open the service worker DevTools (from `chrome://extensions` → "service worker" link) and run:

```javascript
chrome.runtime.sendMessage({ type: 'getHostStatus' }, console.log);
```

Expected: `{status: "ready"}` (if a port already exists) or `{status: "probing"}` followed by no `hostStatus: missing` broadcast within a few seconds.

- [ ] **Step 5: Manual smoke test — host missing**

Move your native host manifest aside:

```bash
mv ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.pr_review.bridge.json \
   /tmp/com.pr_review.bridge.json.bak
```

Reload the extension. In the service worker DevTools:

```javascript
chrome.runtime.sendMessage({ type: 'getHostStatus' }, console.log);
```

Expected: returns `{status: "probing"}`, then within ~1s the console shows the `hostStatus: missing` broadcast (you can also add a listener: `chrome.runtime.onMessage.addListener((m) => console.log('GOT', m));`).

Restore the manifest:

```bash
mv /tmp/com.pr_review.bridge.json.bak \
   ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.pr_review.bridge.json
```

Reload the extension and confirm `getHostStatus` now returns `ready` again.

- [ ] **Step 6: Commit**

```bash
git add extension/background.js
git commit -m "$(cat <<'EOF'
feat(extension): expose host status to side panel via probe message

Adds a 'getHostStatus' message and a 'hostStatus' broadcast so the
side panel can render either chat UI or onboarding view based on
whether the native messaging host is reachable. Refactors the
existing port listeners into named helpers so the probe path can
reuse them without duplicating the streaming/retry logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Side panel — onboarding view (HTML + CSS)

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.css`

- [ ] **Step 1: Add the onboarding container in `sidepanel.html`**

In `extension/sidepanel.html`, insert the onboarding view immediately after `<main id="history" aria-live="polite">` opens (after the existing `<div id="empty-state">` block, at line 36). The whole `<main>` section after edit should read:

```html
  <main id="history" aria-live="polite">
    <div id="empty-state" class="empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="36" height="36">
          <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
            d="M4 6h16M4 12h10M4 18h7M16 14l3 3-3 3M16 14v6" />
        </svg>
      </div>
      <p class="empty-title">Ask Claude about this PR</p>
      <ol class="empty-steps">
        <li>Open a GitHub PR diff page</li>
        <li>Select a hunk in the diff</li>
        <li>Ask your question below</li>
      </ol>
    </div>

    <section id="onboarding" class="onboarding" hidden aria-label="Set up native host">
      <h2 class="onboarding-title">One-time setup</h2>
      <p class="onboarding-intro">
        PR Review needs a small local helper (the "native messaging host") so it
        can talk to your Claude Code CLI. You only do this once per machine.
      </p>
      <p class="onboarding-prereq">
        <strong>Requires:</strong> Claude Code CLI installed and logged in
        (Pro / Team / Max). Get it at
        <a href="https://claude.com/code" target="_blank" rel="noopener">claude.com/code</a>.
      </p>
      <div class="onboarding-tabs" role="tablist">
        <button id="tab-claude" class="onboarding-tab is-active" role="tab" aria-selected="true">Paste into Claude Code</button>
        <button id="tab-shell" class="onboarding-tab" role="tab" aria-selected="false">Shell commands</button>
      </div>
      <div id="panel-claude" class="onboarding-panel" role="tabpanel">
        <p class="onboarding-hint">Open a <code>claude</code> session in your terminal and paste this:</p>
        <pre id="claude-prompt" class="onboarding-snippet" tabindex="0"></pre>
        <button id="copy-claude" class="onboarding-copy" type="button">Copy prompt</button>
      </div>
      <div id="panel-shell" class="onboarding-panel" role="tabpanel" hidden>
        <p class="onboarding-hint">Run these in your terminal:</p>
        <pre id="shell-snippet" class="onboarding-snippet" tabindex="0"></pre>
        <button id="copy-shell" class="onboarding-copy" type="button">Copy commands</button>
      </div>
      <div class="onboarding-actions">
        <button id="retry-host" class="onboarding-retry" type="button">Test connection</button>
        <span id="retry-status" class="onboarding-retry-status" role="status" aria-live="polite"></span>
      </div>
      <p class="onboarding-footer">
        Unofficial third-party tool. Not affiliated with or endorsed by
        Anthropic, Inc. "Claude" and "Claude Code" are trademarks of
        Anthropic, Inc.
      </p>
    </section>

    <div id="first-run-banner" class="first-run-banner" hidden role="status">
      <span>AI-generated. Verify before merging. Not a substitute for human review.</span>
      <button id="banner-dismiss" class="banner-dismiss" type="button" aria-label="Dismiss">×</button>
    </div>
  </main>
```

- [ ] **Step 2: Append styles to `sidepanel.css`**

Append to the end of `extension/sidepanel.css`:

```css
/* Onboarding view — shown when native host is missing */
.onboarding {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--text);
}
.onboarding[hidden] { display: none; }
.onboarding-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.onboarding-intro,
.onboarding-prereq,
.onboarding-hint,
.onboarding-footer {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted);
}
.onboarding-prereq strong { color: var(--text); }
.onboarding-footer {
  font-size: 11px;
  color: var(--text-faint);
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.onboarding-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.onboarding-tab {
  background: none;
  border: 0;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.onboarding-tab.is-active {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.onboarding-panel[hidden] { display: none; }
.onboarding-snippet {
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: var(--radius-sm);
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
  margin: 0;
}
.onboarding-copy,
.onboarding-retry {
  align-self: flex-start;
  background: var(--accent);
  color: white;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.onboarding-copy:hover,
.onboarding-retry:hover { background: var(--accent-strong); }
.onboarding-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.onboarding-retry-status {
  font-size: 12px;
  color: var(--text-muted);
}

/* First-run AI disclaimer banner — dismissible, persisted */
.first-run-banner {
  margin: 10px 12px;
  padding: 8px 12px;
  background: var(--accent-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.first-run-banner[hidden] { display: none; }
.banner-dismiss {
  background: none;
  border: 0;
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
}
.banner-dismiss:hover { color: var(--text); }

/* Per-response footer line */
.assistant-footer {
  font-size: 10px;
  color: var(--text-faint);
  margin-top: 4px;
  text-align: right;
}
```

- [ ] **Step 3: Manual smoke — load extension, verify hidden by default**

Reload the unpacked extension and open the side panel. The new onboarding section and first-run banner should NOT be visible yet (both are `hidden`). The existing UI must be unchanged. If you see anything from the new section rendered, fix the HTML before moving on.

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.css
git commit -m "$(cat <<'EOF'
feat(extension): scaffold onboarding view and first-run banner

Markup + styles only; both elements stay hidden until sidepanel.js
toggles them (next task). The onboarding section offers two install
paths (paste into Claude Code, or run shell commands) plus a 'Test
connection' button and the trademark footer that the spec requires
on this surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Side panel — wire onboarding logic

**Files:**
- Modify: `extension/sidepanel.js`

- [ ] **Step 1: Helper — show / hide onboarding**

At the top of `extension/sidepanel.js`, right after the existing constants block (after the `pasteRegistry` declaration around line 20), add:

```javascript
const FIRST_RUN_KEY = 'firstRunBannerDismissed';

function showOnboarding(extId) {
  const onboarding = document.getElementById('onboarding');
  const emptyState = document.getElementById('empty-state');
  if (!onboarding) return;
  onboarding.hidden = false;
  if (emptyState) emptyState.hidden = true;
  renderOnboardingSnippets(extId);
}

function hideOnboarding() {
  const onboarding = document.getElementById('onboarding');
  const emptyState = document.getElementById('empty-state');
  if (onboarding) onboarding.hidden = true;
  if (emptyState) emptyState.hidden = false;
}

function renderOnboardingSnippets(extId) {
  const displayId = extId || '<your extension id from chrome://extensions>';
  const claudePrompt = [
    'Install the pr-review-extension native host for me.',
    '',
    'Steps:',
    '1. git clone https://github.com/jujunghan/pr-review-extension ~/pr-review-extension  (skip if already cloned)',
    '2. cd ~/pr-review-extension && npm install',
    `3. npm run install-host -- --ext-id ${displayId}`,
    '4. Tell me to reload the PR Review extension in chrome://extensions when you\'re done.',
  ].join('\n');

  const shellSnippet = [
    'git clone https://github.com/jujunghan/pr-review-extension ~/pr-review-extension',
    'cd ~/pr-review-extension && npm install',
    `npm run install-host -- --ext-id ${displayId}`,
  ].join('\n');

  document.getElementById('claude-prompt').textContent = claudePrompt;
  document.getElementById('shell-snippet').textContent = shellSnippet;
}

function wireOnboardingControls() {
  const tabClaude = document.getElementById('tab-claude');
  const tabShell = document.getElementById('tab-shell');
  const panelClaude = document.getElementById('panel-claude');
  const panelShell = document.getElementById('panel-shell');

  function selectTab(which) {
    const claudeActive = which === 'claude';
    tabClaude.classList.toggle('is-active', claudeActive);
    tabShell.classList.toggle('is-active', !claudeActive);
    tabClaude.setAttribute('aria-selected', claudeActive ? 'true' : 'false');
    tabShell.setAttribute('aria-selected', !claudeActive ? 'true' : 'false');
    panelClaude.hidden = !claudeActive;
    panelShell.hidden = claudeActive;
  }
  tabClaude.addEventListener('click', () => selectTab('claude'));
  tabShell.addEventListener('click', () => selectTab('shell'));

  document.getElementById('copy-claude').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('claude-prompt').textContent);
    flashRetryStatus('Copied prompt');
  });
  document.getElementById('copy-shell').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('shell-snippet').textContent);
    flashRetryStatus('Copied commands');
  });

  document.getElementById('retry-host').addEventListener('click', async () => {
    flashRetryStatus('Testing…');
    const res = await chrome.runtime.sendMessage({ type: 'getHostStatus' });
    if (res?.status === 'ready') {
      hideOnboarding();
      flashRetryStatus('Connected');
    } else if (res?.status === 'probing') {
      flashRetryStatus('Probing — give it a second, then click again');
    } else {
      flashRetryStatus('Still missing. Did you reload the extension?');
    }
  });
}

function flashRetryStatus(text) {
  const el = document.getElementById('retry-status');
  if (!el) return;
  el.textContent = text;
  clearTimeout(flashRetryStatus._t);
  flashRetryStatus._t = setTimeout(() => { el.textContent = ''; }, 4000);
}

async function maybeShowFirstRunBanner() {
  const store = await chrome.storage.local.get(FIRST_RUN_KEY);
  if (store[FIRST_RUN_KEY]) return;
  const banner = document.getElementById('first-run-banner');
  if (!banner) return;
  banner.hidden = false;
  document.getElementById('banner-dismiss').addEventListener('click', async () => {
    banner.hidden = true;
    await chrome.storage.local.set({ [FIRST_RUN_KEY]: true });
  });
}
```

- [ ] **Step 2: Hook the helpers into `init`**

Modify the `init()` function in `extension/sidepanel.js`. The current head of `init` (around lines 24–32):

```javascript
async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  setPrUrl(state?.prUrl || null);
  if (state?.prUrl) {
    const ds = await chrome.runtime.sendMessage({ type: 'getDiffStatus', prUrl: state.prUrl });
    renderDiffStatus(ds?.status);
    refreshRepoPathBanner(state.prUrl);
  }
```

Replace it with:

```javascript
async function init() {
  wireOnboardingControls();

  const hostRes = await chrome.runtime.sendMessage({ type: 'getHostStatus' });
  if (hostRes?.status !== 'ready') {
    showOnboarding(chrome.runtime.id);
  } else {
    await maybeShowFirstRunBanner();
  }

  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  setPrUrl(state?.prUrl || null);
  if (state?.prUrl) {
    const ds = await chrome.runtime.sendMessage({ type: 'getDiffStatus', prUrl: state.prUrl });
    renderDiffStatus(ds?.status);
    refreshRepoPathBanner(state.prUrl);
  }
```

- [ ] **Step 3: Listen for runtime `hostStatus` broadcasts**

Inside the existing `chrome.runtime.onMessage.addListener` block in `extension/sidepanel.js` (around lines 33–65), add a branch. After the existing `if (msg.type === 'streamChunk') { ... }` branch, add:

```javascript
    if (msg.type === 'hostStatus') {
      if (msg.status === 'missing') {
        showOnboarding(chrome.runtime.id);
      } else if (msg.status === 'ready') {
        hideOnboarding();
        maybeShowFirstRunBanner();
      }
    }
```

- [ ] **Step 4: Manual smoke — host missing**

Move the host manifest aside (same trick as Task 7 step 5), reload the extension, open the side panel on a GitHub PR. Expected:
- Onboarding view renders.
- The claude prompt textarea shows your real extension ID auto-filled into step 3.
- "Copy prompt" copies to clipboard; "Copied prompt" status appears for ~4s.
- "Test connection" returns "Still missing…".
- Switching tabs to "Shell commands" works.
- Trademark footer is visible.

Restore the manifest, click "Test connection" — expected: onboarding hides, normal UI appears, first-run banner appears at the top of `<main>`, dismissing it persists across reloads.

- [ ] **Step 5: Manual smoke — first-run banner**

While the host is working and you have NOT yet dismissed the banner: reload the extension. Expected: banner appears. Click ×. Reload. Expected: banner stays hidden (persisted via `chrome.storage.local`).

To reset for testing: in side panel DevTools, run `await chrome.storage.local.remove('firstRunBannerDismissed')` and reload.

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel.js
git commit -m "$(cat <<'EOF'
feat(extension): wire onboarding and first-run banner in side panel

On init, the side panel asks the background for host status. Missing
host -> onboarding view with the user's extension ID auto-filled into
the claude-paste prompt and the shell commands. 'Test connection'
re-probes without requiring a reload. First-run AI disclaimer banner
appears once for ready hosts and persists its dismissal in
chrome.storage.local.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Per-response AI footer

The spec §8.1 requires a footer line below the first assistant response. We render it once per assistant bubble that finalizes.

**Files:**
- Modify: `extension/sidepanel.js`

- [ ] **Step 1: Find the `finalizeBubble` function**

Open `extension/sidepanel.js` and locate the existing `finalizeBubble` function (search for `function finalizeBubble`). Read it to confirm its current shape.

- [ ] **Step 2: Append the footer line at finalize time**

Modify `finalizeBubble` so that, after its existing finalization logic, it appends an `.assistant-footer` line (only once per bubble — guarded by a data attribute):

```javascript
function finalizeBubble(bubble) {
  // ... existing finalization logic stays as-is ...

  if (bubble && !bubble.dataset.footerAdded) {
    const footer = document.createElement('div');
    footer.className = 'assistant-footer';
    footer.textContent = 'AI output — verify independently.';
    bubble.appendChild(footer);
    bubble.dataset.footerAdded = '1';
  }
}
```

If `finalizeBubble` does not exist with that exact name or signature, find the place where an assistant bubble is "finished" (typically when the `done` stream chunk arrives) and apply the same guarded append there. The contract: every assistant bubble gets one and only one footer line on completion.

- [ ] **Step 3: Manual smoke**

With the host working, send a PR question and wait for the response to finish. Expected: a small "AI output — verify independently." line appears at the bottom of the bubble. Send a follow-up; same line appears on the new bubble.

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.js
git commit -m "$(cat <<'EOF'
feat(extension): add 'AI output — verify' footer to every response

One small footer line per finalized assistant bubble, satisfying the
spec §8.1 requirement that the per-response surface carry the
verify-before-merging reminder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: README rewrite

**Files:**
- Rewrite: `README.md`

- [ ] **Step 1: Replace the contents of `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: rewrite README for public launch

Adds prerequisites with the explicit Claude Code subscription
requirement, the two-path install story (CWS recommended, from-source
fallback), and the trademark + AI + prompt-injection + no-execute +
warranty disclaimers required by spec §8 on the README surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Version bump to 1.0.0

This is the last code-change task. After this, no commits should touch source files until the tag is cut.

**Files:**
- Modify: `package.json` (root)
- Modify: `extension/manifest.json`

- [ ] **Step 1: Bump root `package.json`**

Change the `"version"` field of the root `package.json` from `"0.1.0"` to `"1.0.0"`.

- [ ] **Step 2: Sync manifest via the script we just wrote**

```bash
npm run sync-manifest-version
```

Expected: prints `extension/manifest.json synced to package.json version`. Confirm `extension/manifest.json` now has `"version": "1.0.0"`.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all bridge + scripts tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json extension/manifest.json
git commit -m "$(cat <<'EOF'
chore: bump version to 1.0.0

First public release. Both files updated together; the release workflow
re-runs sync-manifest-version on a fresh checkout so the published zip
always carries the tagged version.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12a: Onboarding — auto-poll "Test connection"

Current retry handler in `extension/sidepanel.js` calls `getHostStatus` once per click. If Chrome's native messaging manifest registration lags by 1–2 seconds (typical right after `npm run install-host` finishes), the user sees a "give it a second, then click again" message and has to click repeatedly. Replace the one-shot check with a bounded auto-poll.

**Files:**
- Modify: `extension/sidepanel.js`
- Modify: `CHANGELOG.md` (add bullet)

- [ ] **Step 1: Replace the existing `retry-host` click handler logic in `wireOnboardingControls`**

The current click handler (inside `wireOnboardingControls`):

```javascript
  document.getElementById('retry-host').addEventListener('click', async () => {
    flashRetryStatus('Testing…');
    const res = await chrome.runtime.sendMessage({ type: 'getHostStatus' });
    if (res?.status === 'ready') {
      hideOnboarding();
      flashRetryStatus('Connected');
    } else if (res?.status === 'probing') {
      flashRetryStatus('Probing — give it a second, then click again');
    } else {
      flashRetryStatus('Still missing. Did you reload the extension?');
    }
  });
```

Replace it with a delegation to a new `startRetryPoll()` helper:

```javascript
  document.getElementById('retry-host').addEventListener('click', () => {
    startRetryPoll();
  });
```

- [ ] **Step 2: Add the poll state + helpers near the other onboarding helpers**

Insert these declarations immediately after `flashRetryStatus` (still at the top level of the file, alongside the other onboarding helpers):

```javascript
const RETRY_POLL_MAX = 6;
const RETRY_POLL_INTERVAL_MS = 3000;
let retryPollTimer = null;
let retryPollCount = 0;

function stopRetryPoll() {
  if (retryPollTimer) {
    clearTimeout(retryPollTimer);
    retryPollTimer = null;
  }
}

function startRetryPoll() {
  stopRetryPoll();
  retryPollCount = 0;
  pollHostOnce();
}

async function pollHostOnce() {
  retryPollCount += 1;
  flashRetryStatus(`Checking… (${retryPollCount}/${RETRY_POLL_MAX})`);
  const res = await chrome.runtime.sendMessage({ type: 'getHostStatus' });
  if (res?.status === 'ready') {
    stopRetryPoll();
    hideOnboarding();
    flashRetryStatus('Connected');
    return;
  }
  if (retryPollCount >= RETRY_POLL_MAX) {
    stopRetryPoll();
    flashRetryStatus('Still missing. Did you run all install steps and reload the extension in chrome://extensions?');
    return;
  }
  retryPollTimer = setTimeout(pollHostOnce, RETRY_POLL_INTERVAL_MS);
}
```

- [ ] **Step 3: Stop the poll if the side panel sees a `hostStatus: ready` broadcast independently**

In the existing `chrome.runtime.onMessage.addListener` block, the `hostStatus` branch (added in Task 9) currently calls `hideOnboarding()` on `'ready'`. Add `stopRetryPoll()` so the poll loop doesn't keep running after the host comes alive via a different path:

```javascript
    if (msg.type === 'hostStatus') {
      if (msg.status === 'missing') {
        showOnboarding(chrome.runtime.id);
      } else if (msg.status === 'ready') {
        stopRetryPoll();
        hideOnboarding();
        maybeShowFirstRunBanner();
      }
    }
```

- [ ] **Step 4: Update CHANGELOG.md**

In the `### Added` section of `## [1.0.0]`, insert this bullet right after the line about "Side panel onboarding view:":

```markdown
- Onboarding "Test connection" auto-polls (3s × 6 attempts) instead of requiring repeated manual clicks.
```

- [ ] **Step 5: Verify**

```bash
node --check extension/sidepanel.js
```

Expected: OK.

(Manual smoke deferred to Task 13.)

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel.js CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat(extension): auto-poll Test connection during onboarding

Click 'Test connection' now starts a bounded poll loop (3s × 6
attempts) instead of one-shot. Removes the 'give it a second and
click again' confusion when Chrome's native messaging manifest
registration lags right after npm run install-host finishes. Counter
text shows N/6 progress so the user knows it's actively waiting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12b: Stop generation button

Add a Stop control that cancels in-flight assistant responses. Required new protocol:
- `sidepanel → background`: `{type: 'cancelStream', streamId}` (cancel one) or `{type: 'cancelAllStreams'}` (cancel all). For UX simplicity, the button cancels ALL active streams.
- `background → host`: `{id: <new>, type: 'cancel', targetId: <backend id>}` per backend id.
- `host`: looks up `inflight.get(targetId).proc`, sends `proc.kill('SIGTERM')`, replies `{id, type: 'ok'}` for the cancel request itself. The cancelled `send`'s `exit` handler will fire naturally and write its `error` message; the side panel handles that as a normal stream termination.

**Files:**
- Modify: `bridge/host.js`
- Modify: `extension/background.js`
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.css`
- Modify: `extension/sidepanel.js`
- Modify: `CHANGELOG.md` (add bullet)

- [ ] **Step 1: `bridge/host.js` — handle the cancel message**

In `handle()`, add a new branch before the `unknown type` fallback:

```javascript
  if (type === 'cancel') {
    const entry = inflight.get(msg.targetId);
    if (entry && entry.proc) {
      try { entry.proc.kill('SIGTERM'); } catch {}
    }
    writeMessage({ id, type: 'ok' });
    return;
  }
```

The existing `proc.on('exit', ...)` handler already writes a `type: 'error'` to the original `id` (the one that was cancelled) and deletes from `inflight`, so we don't need to clean up `inflight` here.

- [ ] **Step 2: `extension/background.js` — track streamId → backend id and route the cancel**

Inside the `chrome.runtime.onMessage.addListener` block, the `send` branch starts at line ~189 in the post-Task-7 file. Modify it to record the `streamId → id` mapping. First, add a module-level map near the other declarations (alongside `pending = new Map();`):

```javascript
// streamId -> backend id (the one we use with native messaging). Lets us
// translate a side-panel-facing cancel back to the host's protocol.
const streamIdToBackendId = new Map();
```

Then in the existing `send` handler, capture the id returned from `nativeSend` (which already returns `id`):

```javascript
    if (msg.type === 'send') {
      const { streamId, target, prUrl, file, lines, code, question, images } = msg;
      const cwd = await lookupRepoPath(prUrl);
      const replyTo = (payload) => {
        const kind = payload.delta != null ? 'delta' : (payload.done ? 'done' : (payload.error ? 'error' : '?'));
        console.log('[PR Review BG] replyTo', target || 'broadcast', 'streamId=', streamId, kind, payload.delta?.length || '');
        if (target === 'tab' && sender.tab?.id != null) {
          chrome.tabs.sendMessage(sender.tab.id, { type: 'streamChunk', streamId, ...payload }).catch(() => {});
        } else {
          broadcast({ type: 'streamChunk', streamId, ...payload });
        }
      };

      let finalQuestion = question;
      const cacheKey = prUrl?.split('#')[0];
      if (cacheKey && !diffAttached.has(prUrl) && diffCache.has(cacheKey)) {
        const diff = diffCache.get(cacheKey);
        finalQuestion = `PR diff (review context):\n\`\`\`diff\n${diff}\n\`\`\`\n\n${question}`;
        diffAttached.add(prUrl);
      }

      const backendId = nativeSend({ type: 'send', prUrl, file, lines, code, question: finalQuestion, cwd, images }, {
        onDelta: (text) => replyTo({ delta: text }),
        onDone: (sessionId) => { streamIdToBackendId.delete(streamId); replyTo({ done: true, sessionId }); },
        onError: (message) => { streamIdToBackendId.delete(streamId); replyTo({ error: message }); },
      });
      if (backendId != null) streamIdToBackendId.set(streamId, backendId);
      sendResponse({ ok: true });
      return;
    }
```

Add new handlers after the `send` block:

```javascript
    if (msg.type === 'cancelStream') {
      const backendId = streamIdToBackendId.get(msg.streamId);
      if (backendId != null) {
        nativeSend({ type: 'cancel', targetId: backendId }, {});
        streamIdToBackendId.delete(msg.streamId);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'cancelAllStreams') {
      for (const [streamId, backendId] of streamIdToBackendId) {
        nativeSend({ type: 'cancel', targetId: backendId }, {});
      }
      streamIdToBackendId.clear();
      sendResponse({ ok: true });
      return;
    }
```

- [ ] **Step 3: `extension/sidepanel.html` — add the Stop button**

Inside the existing `<footer>` block, immediately above `<div class="input-wrap">`, add:

```html
    <button id="stop-btn" class="stop-btn" type="button" hidden aria-label="Stop generation">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>
      </svg>
      Stop
    </button>
```

- [ ] **Step 4: `extension/sidepanel.css` — style the Stop button**

Append at the end of the file:

```css
/* Stop generation button — shown while any stream is in flight */
.stop-btn {
  align-self: flex-end;
  margin: 0 12px 6px;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.stop-btn:hover { background: var(--border); }
.stop-btn[hidden] { display: none; }
```

- [ ] **Step 5: `extension/sidepanel.js` — wire show/hide and the cancel click**

Add a helper near the other top-level helpers (right after `maybeShowFirstRunBanner`):

```javascript
function refreshStopButton() {
  const btn = document.getElementById('stop-btn');
  if (!btn) return;
  btn.hidden = activeStreams.size === 0;
}
```

Inside `init()`, wire the click after `wireOnboardingControls();` (anywhere in `init` before the existing `getHostStatus` call is fine, but placing it next to the other static button wires keeps it grouped):

```javascript
  document.getElementById('stop-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'cancelAllStreams' });
    // Don't force-finalize the bubbles here — the host will send an
    // 'error' for each cancelled stream, and the existing streamChunk
    // error path will finalize them and reset the status line.
  });
```

Now refresh the button in three places (any time `activeStreams` grows or shrinks):

1. Inside the `streamChunk` listener, right after `activeStreams.delete(msg.streamId);` in the `done` branch:

```javascript
        finalizeBubble(bubble);
        activeStreams.delete(msg.streamId);
        refreshStopButton();
        if (activeStreams.size === 0) setStatus('');
```

2. Inside the `streamChunk` listener, right after `activeStreams.delete(msg.streamId);` in the `error` branch:

```javascript
      } else if (msg.error) {
        setStatus(`Claude error: ${msg.error}`, { error: true });
        finalizeBubble(bubble);
        activeStreams.delete(msg.streamId);
        refreshStopButton();
      }
```

3. Inside the `send()` function (find it with `function send(`). Locate the line where the bubble is registered via `activeStreams.set(streamId, ...)` and add `refreshStopButton();` immediately after it.

If you cannot find `function send(` cleanly, search for `activeStreams.set` — there will be exactly one site where a new stream is registered. Add `refreshStopButton();` on the next line.

- [ ] **Step 6: Update CHANGELOG.md**

In the `### Added` section of `## [1.0.0]`, after the auto-poll bullet from Task 12a, insert:

```markdown
- Stop button cancels in-flight streams (`SIGTERM` to the `claude` child process).
```

- [ ] **Step 7: Verify**

```bash
node --check bridge/host.js
node --check extension/background.js
node --check extension/sidepanel.js
npm test
```

All four should pass. The bridge tests don't exercise the new `cancel` branch, so no new unit test is required — the integration is exercised manually in Task 13.

- [ ] **Step 8: Commit**

```bash
git add bridge/host.js extension/background.js extension/sidepanel.html extension/sidepanel.css extension/sidepanel.js CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat(extension): add Stop button to cancel in-flight streams

New cancel protocol: sidepanel.cancelAllStreams → background sends
type:'cancel' with targetId per active stream → host SIGTERMs the
matching claude child. The cancelled child's existing exit handler
surfaces the error to the side panel, which finalizes the bubble via
the standard error path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12c: Markdown rendering for assistant responses + typography pass

Today `appendAssistantDelta` does `bubble.textContent += text`, which renders the assistant's markdown as raw characters: `**bold**`, `## headers`, and triple-backtick code fences are visible as syntax instead of formatting. The existing CSS at `.msg pre` / `.msg code` already styles code blocks correctly — they just never get created in the DOM. Vendor `marked` and re-render the bubble on each delta so the rendered HTML lands in the DOM, then add a small CSS pass for headings/lists/blockquotes/paragraph spacing.

**Files:**
- Create: `extension/lib/marked.esm.js` (vendored, MIT, pinned version)
- Modify: `extension/sidepanel.js`
- Modify: `extension/sidepanel.css`
- Modify: `extension/manifest.json` (none required — `import` of local extension files works under MV3's default CSP)
- Modify: `CHANGELOG.md` (add bullet)
- Note: CWS reviewer notes should mention the vendored file (P3 step 6).

The bubble structure must be reworked so the markdown re-render target is a child element, otherwise `finalizeBubble`'s `.assistant-footer` gets clobbered on each delta.

Target structure for assistant bubbles after this task:

```html
<div class="msg assistant">
  <div class="msg-content"><!-- innerHTML target --></div>
  <!-- .assistant-footer appended once on finalize -->
</div>
```

For "thinking" state, the existing `.thinking-dots` span lives directly inside the bubble (no wrapper). On first delta arrival, the dots are stripped, the `<div class="msg-content">` is created, and from then on it owns the rendering.

- [ ] **Step 1: Vendor `marked` into `extension/lib/marked.esm.js`**

Fetch a pinned, recent stable release. From the project root:

```bash
mkdir -p extension/lib
curl -L --fail \
  -o extension/lib/marked.esm.js \
  https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.esm.js
```

If `marked@15.0.7` is not available on jsdelivr (or jsdelivr is slow), fall back to:

```bash
curl -L --fail \
  -o extension/lib/marked.esm.js \
  https://unpkg.com/marked@15.0.7/lib/marked.esm.js
```

If `15.0.7` is unavailable, try the most recent v15.x stable patch you can resolve (`@15`, `@^15.0.0`). Whichever version actually lands, record it in the first comment line of the file (preserve marked's existing license header, add a `// vendored by curl <date>, source <url>` line at the top).

Confirm the file is a valid ESM module:

```bash
node --input-type=module -e "import('./extension/lib/marked.esm.js').then(m => console.log(typeof m.marked, typeof m.parse))"
```

Expected: `function function` (both `marked` instance and `parse` function are exported).

If the version you ended up with does not export `parse` as a named export, prefer the form `import { marked } from './lib/marked.esm.js'` then call `marked.parse(...)` in step 3. Either form is fine — pick one and stay consistent.

- [ ] **Step 2: Rework the bubble structure in `extension/sidepanel.js`**

Replace the existing `startAssistantMessage`, `appendAssistantDelta`, and `finalizeBubble` functions. Read them first to confirm the current implementation, then replace with:

```javascript
import { marked } from './lib/marked.esm.js';

marked.use({
  gfm: true,
  breaks: true,
  // marked v15+ escapes HTML by default; no extra sanitizer needed
  // for this use case (output is rendered, not stored, and the
  // source is the user's own claude session running locally).
});

function startAssistantMessage() {
  hideEmptyState();
  const div = document.createElement('div');
  div.className = 'msg assistant thinking';
  const dots = document.createElement('span');
  dots.className = 'thinking-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';
  div.appendChild(dots);
  $('#history').appendChild(div);
  scrollHistory();
  return div;
}

function ensureContentDiv(bubble) {
  let content = bubble.querySelector('.msg-content');
  if (content) return content;
  // First delta: remove the thinking dots and create the content div.
  bubble.classList.remove('thinking');
  while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
  content = document.createElement('div');
  content.className = 'msg-content';
  bubble.appendChild(content);
  return content;
}

function appendAssistantDelta(bubble, text) {
  const content = ensureContentDiv(bubble);
  const prev = bubble.dataset.rawMd || '';
  const next = prev + text;
  bubble.dataset.rawMd = next;
  content.innerHTML = marked.parse(next);
  scrollHistory();
}

function finalizeBubble(bubble) {
  // If we never got a delta, leave a friendly placeholder instead of an
  // empty bubble with dots stuck forever.
  if (bubble.classList.contains('thinking')) {
    bubble.classList.remove('thinking');
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.textContent = '(no response)';
    bubble.appendChild(content);
  }

  if (bubble && !bubble.dataset.footerAdded) {
    const footer = document.createElement('div');
    footer.className = 'assistant-footer';
    footer.textContent = 'AI output — verify independently.';
    bubble.appendChild(footer);
    bubble.dataset.footerAdded = '1';
  }
}
```

Note: `sidepanel.js` is currently loaded as `<script type="module" src="sidepanel.js">` in `sidepanel.html` (line 56). The new `import` statement at the top relies on this. Verify the script tag's `type="module"` is already in place (it is) — if not, add it. **No change to the HTML is required for the import to work.**

- [ ] **Step 3: Add markdown-rendered CSS rules to `extension/sidepanel.css`**

Append at the end of `sidepanel.css`:

```css
/* Markdown rendering inside assistant bubbles */
.msg-content { line-height: 1.6; }
.msg-content > :first-child { margin-top: 0; }
.msg-content > :last-child { margin-bottom: 0; }
.msg-content p { margin: 0 0 8px; }
.msg-content h1,
.msg-content h2,
.msg-content h3,
.msg-content h4 {
  margin: 14px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}
.msg-content h1 { font-size: 17px; }
.msg-content h2 { font-size: 15px; }
.msg-content h3 { font-size: 14px; }
.msg-content h4 { font-size: 13px; color: var(--text-muted); }
.msg-content ul,
.msg-content ol {
  margin: 4px 0 8px;
  padding-left: 22px;
}
.msg-content li { margin: 2px 0; }
.msg-content li > p { margin: 0 0 4px; }
.msg-content blockquote {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid var(--border-strong);
  color: var(--text-muted);
}
.msg-content a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.msg-content a:hover { color: var(--accent-strong); }
.msg-content hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
.msg-content table {
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 12px;
}
.msg-content th,
.msg-content td {
  border: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
}
/* Slight bump on code fence font size for the rendered output */
.msg-content pre code { font-size: 12.5px; }
```

- [ ] **Step 4: Update CHANGELOG.md**

In the `### Added` section of `## [1.0.0]`, append after the Stop button bullet (from Task 12b):

```markdown
- Assistant responses now render as markdown (code fences, inline code, lists, headings, blockquotes) via vendored `marked@<version>` (MIT). Includes typography pass on the rendered output.
```

Replace `<version>` with the actual pinned marked version you installed (e.g. `15.0.7`).

- [ ] **Step 5: Verify**

```bash
node --check extension/sidepanel.js
npm test
```

Then a quick markdown rendering sanity check:

```bash
node --input-type=module -e "
  import('./extension/lib/marked.esm.js').then(({ marked }) => {
    const html = marked.parse('# Hello\\n\\n\`\`\`js\\nconst x = 1;\\n\`\`\`\\n- a\\n- b\\n');
    console.log(html.includes('<h1') && html.includes('<pre') && html.includes('<ul') ? 'ok' : 'fail');
  })
"
```

Expected: prints `ok`.

(Manual smoke of the rendered side panel deferred to Task 13.)

- [ ] **Step 6: Commit**

```bash
git add extension/lib/marked.esm.js extension/sidepanel.js extension/sidepanel.css CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat(extension): render assistant responses as markdown

Assistant bubbles now contain a .msg-content child whose innerHTML is
re-rendered from the raw markdown buffer on every delta via the
vendored marked library (single ESM file, MIT). Code fences, inline
code, headings, lists, blockquotes, bold/italic now render properly
instead of leaking through as raw syntax. Adds typography rules
(line-height, list/heading/blockquote spacing) so PR-review-length
responses are actually scannable.

The trailing AI-output footer is preserved across re-renders by living
outside .msg-content as a sibling on the bubble.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: P1 — Self-verification before the public flip

This is a manual checklist, not a code task. Walk through it once on a fresh-feeling environment.

- [ ] **Step 1: Clean unpacked load**

In `chrome://extensions`, remove any old unpacked copy. Load the working tree via "Load unpacked" → `extension/`. Note the extension ID Chrome assigns (it changes per machine for unpacked loads).

- [ ] **Step 2: Re-run install-host with this ID**

```bash
npm run install-host -- --ext-id <ID>
```

Confirm it reports the manifest path under `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`.

- [ ] **Step 3: Open the side panel on a real GitHub PR diff**

Pick any small public PR (e.g., one of your own from this repo's history). Expected:
- Side panel opens.
- Onboarding view is NOT visible.
- First-run banner appears once.
- "No PR detected" → real PR label transition works.

- [ ] **Step 4: Send one prompt, read the streamed answer**

Select some code, click ✨, type a question, press Enter. Expected:
- Streaming bubble appears.
- "AI output — verify independently." footer appears once the bubble finalizes.

- [ ] **Step 5: Onboarding screen test**

Move the host manifest aside:

```bash
mv ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.pr_review.bridge.json \
   /tmp/com.pr_review.bridge.json.bak
```

Reload the extension. Open the side panel on a PR. Expected:
- Onboarding view renders with the correct extension ID auto-filled.
- "Copy prompt" works; clipboard contains the prompt.
- Switching tabs to "Shell commands" works.
- Trademark footer is present.

Restore:

```bash
mv /tmp/com.pr_review.bridge.json.bak \
   ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.pr_review.bridge.json
```

Reload, click "Test connection". Expected: onboarding hides, chat UI returns.

- [ ] **Step 6: First-run banner reset test**

In the side panel DevTools:

```javascript
await chrome.storage.local.remove('firstRunBannerDismissed');
```

Reload. Banner appears. Click ×. Reload. Banner stays hidden.

- [ ] **Step 7: Run unit tests one more time**

```bash
npm test
```

Expected: green.

- [ ] **Step 8: Dry-run the release workflow**

Tag a throwaway pre-release tag and push, only if you want to confirm the GitHub Action wiring works. Skip if you do not want a draft release artifact lingering — the workflow is small and self-evident.

```bash
git tag v0.99.0-rc1
git push origin v0.99.0-rc1
```

Watch the Actions tab. When the draft release is created, download the zip, confirm `manifest.json` inside it shows `"version": "0.99.0-rc1"`. Then **delete the draft release in the GitHub UI and delete the tag**:

```bash
git tag -d v0.99.0-rc1
git push origin :refs/tags/v0.99.0-rc1
```

(Only run this dry-run on a tag the workflow has never seen — `softprops/action-gh-release@v2` will refuse to overwrite a published release.)

- [ ] **Step 9: Check the launch-day sensitive-file scan one more time**

```bash
find . -maxdepth 3 \( -name '.env*' -o -name '*.key' -o -name '*.pem' -o -name 'secrets*' -o -name 'credentials*' \) -not -path './node_modules/*'
git log --all -p | grep -iE '(api[_-]?key|secret|password|token|bearer|authorization:)' | head -20
```

Expected: zero new hits since the 2026-05-21 baseline. If anything new appears, do NOT flip the repo public until you have triaged it.

---

## Task 14: P2 — Public flip operational checklist

Manual operational steps. ~5 minutes total.

- [ ] **Step 1: Push everything to the private remote first**

```bash
git push origin main
```

Confirm GitHub shows the new commits.

- [ ] **Step 2: Flip visibility**

```bash
gh repo edit jujunghan/pr-review-extension --visibility public --accept-visibility-change-consequences
```

Confirm in the GitHub web UI that the repo is now public.

- [ ] **Step 3: Enable GitHub Pages**

In the GitHub web UI: Settings → Pages → Source: deploy from `main` branch, `/docs` folder. Save.

Wait for the first Pages build (under "Actions" tab there will be a `pages-build-deployment` workflow). When it completes:

```bash
curl -I https://jujunghan.github.io/pr-review-extension/privacy.html
```

Expected: `HTTP/2 200`.

- [ ] **Step 4: Verify the privacy page content**

Open <https://jujunghan.github.io/pr-review-extension/privacy.html> in a browser. Confirm the two-paragraph data flow disclosure (§8.2) is present and intact, with working links to Anthropic's usage/privacy policy.

---

## Task 15: P3 — CWS submission operational checklist

Manual; ~1–2 hours. Performed at <https://chrome.google.com/webstore/devconsole>.

- [ ] **Step 1: Upload the extension zip**

If you ran the dry-run release in Task 13 Step 8, you already have a zip artifact format. Otherwise, build one locally:

```bash
npm run sync-manifest-version
mkdir -p dist
(cd extension && zip -r ../dist/pr-review-extension-v1.0.0.zip .)
```

Confirm `unzip -p dist/pr-review-extension-v1.0.0.zip manifest.json | jq '.version'` returns `"1.0.0"`.

In the CWS developer console, create a new item and upload this zip.

- [ ] **Step 2: Fill listing metadata (from spec §5.1)**

- Item name: `PR Review with Claude`
- Category: Developer Tools
- Visibility: Public
- Regions: All
- Languages: English only

- [ ] **Step 3: Fill the single-purpose declaration (spec §5.2)**

Paste verbatim:

> Reviewing GitHub pull requests by sending selected diff/hunk context to a locally-installed Claude Code CLI session and streaming the assistant's response into a side panel.

- [ ] **Step 4: Fill permission justifications (spec §5.3 table)**

For each permission listed in the extension manifest, paste the corresponding row from spec §5.3 verbatim into the matching justification box.

- [ ] **Step 5: Fill the privacy disclosure form (spec §5.4)**

- All data-category checkboxes: No.
- All three certifications: Yes.
- Privacy policy URL: `https://jujunghan.github.io/pr-review-extension/privacy.html`.

- [ ] **Step 6: Paste reviewer notes (spec §5.5) verbatim**

- [ ] **Step 7: Upload store assets (spec §5.6)**

- Icon (128×128): already in `extension/icons/128.png`.
- Three 1280×800 PNG screenshots — capture from your own PR review sessions.
- One 440×280 small promo tile (optional but recommended).

- [ ] **Step 8: Paste the listing copy (Appendix A of the spec)**

- Short description: from spec §5.7.
- Detailed description: from spec Appendix A.

- [ ] **Step 9: Submit for review**

Click "Submit for review". After submission, the CWS developer console will show your assigned production extension ID (32 lowercase letters a–p).

- [ ] **Step 10: Capture the production extension ID and patch install-host.js**

Replace the placeholder in `bridge/install-host.js`:

```javascript
export const DEFAULT_PROD_EXT_ID = '<paste the 32-char ID here>';
```

Update the unit tests that pin this constant — `bridge/test/install-host-args.test.js` has a test asserting `DEFAULT_PROD_EXT_ID === 'PLACEHOLDER_UNTIL_CWS_SUBMISSION'`. Change that test's expected value, or delete that specific test (it has served its purpose).

Run `npm test`, then commit:

```bash
git add bridge/install-host.js bridge/test/install-host-args.test.js
git commit -m "$(cat <<'EOF'
feat(bridge): set CWS-assigned production extension ID as default

After the first CWS submission, replaces the loud PLACEHOLDER constant
with the real production ID. End users running `npm run install-host`
without --ext-id will now point at the CWS install.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 16: P4 — GitHub release v1.0.0

- [ ] **Step 1: Finalize CHANGELOG date**

Edit `CHANGELOG.md` and replace `## [1.0.0] — TBD-publish-date` with today's actual date in ISO format (`YYYY-MM-DD`). Commit:

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: stamp v1.0.0 release date in CHANGELOG

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 2: Tag and push**

```bash
git tag v1.0.0
git push origin v1.0.0
```

- [ ] **Step 3: Watch the release workflow**

In the GitHub Actions tab, the `release` workflow should run, tests should pass, and a draft release named `v1.0.0` should appear with `pr-review-extension-v1.0.0.zip` attached.

- [ ] **Step 4: Edit the draft release notes**

In the GitHub Releases UI, open the draft. Replace the auto-generated body with the v1.0.0 section from `CHANGELOG.md`. Mark as Latest. Publish.

- [ ] **Step 5: Sanity-check the published artifact**

```bash
curl -L -o /tmp/pr-review-extension-v1.0.0.zip \
  https://github.com/jujunghan/pr-review-extension/releases/download/v1.0.0/pr-review-extension-v1.0.0.zip
unzip -p /tmp/pr-review-extension-v1.0.0.zip manifest.json | jq '.version'
```

Expected: `"1.0.0"`.

---

## Task 17: P5–P6 — Wait for CWS approval, then announce

- [ ] **Step 1: Wait for CWS review (3–10 days, non-deterministic)**

Monitor the CWS developer console. If rejected, address feedback and resubmit using the same zip when possible (re-uploading is only required if code changes).

- [ ] **Step 2: Once approved, add the CWS link to README and v1.0.1 patch tag**

```bash
# Edit README.md — replace "<link added once approved>" with the actual CWS URL.
# Bump root package.json#version to 1.0.1.
# Add a CHANGELOG entry under ## [1.0.1] — <today>:
#   ### Changed
#   - README now points at the published Chrome Web Store listing.

npm run sync-manifest-version
git add README.md package.json extension/manifest.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: add Chrome Web Store install link to README

Bumps to v1.0.1 so the workflow rebuilds and publishes a fresh zip
alongside the new README. No functional changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
git tag v1.0.1
git push origin v1.0.1
```

- [ ] **Step 3: Update the v1.0.0 GitHub release notes**

Open the v1.0.0 release in the GitHub UI and add a top-of-notes line:

> Chrome Web Store listing now available: <link>

- [ ] **Step 4: Post the announcement**

Wherever you plan to announce (Twitter, blog, HN, Slack, etc.), share:
- One sentence on what it does.
- CWS link.
- GitHub repo link.
- The trademark disclaimer once.

---

## Definition of Done (matches spec §7.4)

- [ ] Extension is discoverable on CWS and "Add to Chrome" works.
- [ ] On a fresh machine without `claude` CLI, CWS install → side panel onboarding renders the prerequisite warning correctly.
- [ ] On a machine with `claude` CLI, CWS install → paste the onboarding prompt into Claude Code → full install completes → chat works end-to-end.
- [ ] GitHub release v1.0.0 is Latest, `.zip` asset is downloadable.
- [ ] `https://jujunghan.github.io/pr-review-extension/privacy.html` is reachable and content matches the CWS privacy form.
- [ ] AI-output disclaimer present on all four surfaces (README "What it doesn't do", CWS detailed description, side panel first-run banner, side panel response footer).
- [ ] Trademark disclaimer present on all four surfaces (README header, CWS short description tail, CWS detailed description first paragraph, side panel onboarding footer).

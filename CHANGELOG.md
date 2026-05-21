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
- Onboarding "Test connection" auto-polls (3s × 6 attempts) instead of requiring repeated manual clicks.
- First-run AI-output disclaimer banner (dismissible) and per-response footer.
- Trademark disclaimer on README header, side panel onboarding footer, and CWS listing surfaces.

### Changed
- Version bumped to `1.0.0`.
- Manifest version is now synced from root `package.json` at build time (`scripts/sync-manifest-version.js`); the committed value in `extension/manifest.json` is the canonical source only for local unpacked loads.
- `bridge/install-host.js` now accepts an `ext-id` via flag, `PR_REVIEW_EXT_ID` env var, or a built-in production default (set at first CWS submission).

### Notes
- This release is the first public version; the prior `0.1.x` versions were private development.

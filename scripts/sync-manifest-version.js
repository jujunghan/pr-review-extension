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
    throw new Error(`${pkgPath} has no version field`);
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

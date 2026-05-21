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

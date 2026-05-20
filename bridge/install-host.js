#!/usr/bin/env node
// Installs the Chrome native messaging host manifest so the extension
// (identified by --ext-id) can spawn bridge/host.js.
//
// Usage: npm run install-host -- --ext-id <EXTENSION_ID>
//
// Manifest destination depends on the OS and browser:
//   macOS Chrome   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts
//   Linux Chrome   ~/.config/google-chrome/NativeMessagingHosts
//   (Brave/Edge/Chromium-derivatives can use --browser to override the dir.)

import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const HOST_NAME = 'com.pr_review.bridge';

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const extId = arg('ext-id');
if (!extId || !/^[a-p]{32}$/.test(extId)) {
  console.error('Error: pass --ext-id <32-char extension id>');
  console.error('Find it in chrome://extensions (Developer mode).');
  process.exit(1);
}

const browser = arg('browser') || 'chrome';

const here = dirname(fileURLToPath(import.meta.url));
const hostPath = resolve(here, 'host.js');
if (!existsSync(hostPath)) {
  console.error(`Error: host script not found at ${hostPath}`);
  process.exit(1);
}
chmodSync(hostPath, 0o755);

function targetDir() {
  const home = homedir();
  if (platform() === 'darwin') {
    const map = {
      chrome: 'Google/Chrome',
      'chrome-canary': 'Google/Chrome Canary',
      brave: 'BraveSoftware/Brave-Browser',
      edge: 'Microsoft Edge',
      chromium: 'Chromium',
    };
    const sub = map[browser];
    if (!sub) {
      console.error(`Unsupported browser: ${browser}`);
      process.exit(1);
    }
    return join(home, 'Library', 'Application Support', sub, 'NativeMessagingHosts');
  }
  if (platform() === 'linux') {
    const map = {
      chrome: '.config/google-chrome',
      brave: '.config/BraveSoftware/Brave-Browser',
      chromium: '.config/chromium',
    };
    const sub = map[browser];
    if (!sub) {
      console.error(`Unsupported browser on Linux: ${browser}`);
      process.exit(1);
    }
    return join(home, sub, 'NativeMessagingHosts');
  }
  console.error(`Unsupported platform: ${platform()}. See README for Windows install.`);
  process.exit(1);
}

const dir = targetDir();
mkdirSync(dir, { recursive: true });

const manifest = {
  name: HOST_NAME,
  description: 'PR Review extension bridge to Claude CLI',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extId}/`],
};

const manifestPath = join(dir, `${HOST_NAME}.json`);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`Installed native host manifest:`);
console.log(`  ${manifestPath}`);
console.log(`  → ${hostPath}`);
console.log(`Reload the extension in chrome://extensions to pick up the new host.`);

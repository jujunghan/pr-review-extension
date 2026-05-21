#!/usr/bin/env node
// Chrome native messaging host. Reads 4-byte LE length + UTF-8 JSON from
// stdin, writes the same framing to stdout. Routes:
//   { id, type: 'send',  prUrl, file, lines, code, question }
//   { id, type: 'clear', prUrl }
//   { id, type: 'health' }
// Responses (per id, may stream):
//   { id, type: 'delta', text }
//   { id, type: 'done',  sessionId }
//   { id, type: 'error', message }
//   { id, type: 'ok' }                  // health / clear ack

import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseStream, runClaude } from './src/claude.js';
import { createSessionStore } from './src/sessions.js';

const sessions = createSessionStore();
const inflight = new Map(); // id -> { proc }
const TMP_DIR = join(tmpdir(), 'pr-review-images');
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

function writeMessage(obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

function logErr(...args) {
  process.stderr.write(`[host] ${args.join(' ')}\n`);
}

async function readMessages() {
  let buf = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const payload = buf.slice(4, 4 + len).toString('utf8');
      buf = buf.slice(4 + len);
      let msg;
      try { msg = JSON.parse(payload); } catch (err) {
        logErr('bad json:', err.message);
        continue;
      }
      handle(msg);
    }
  }
}

function handle(msg) {
  const { id, type } = msg;
  if (type === 'health') {
    writeMessage({ id, type: 'ok' });
    return;
  }
  if (type === 'clear') {
    if (msg.prUrl) sessions.clear(msg.prUrl);
    writeMessage({ id, type: 'ok' });
    return;
  }
  if (type === 'send') {
    handleSend(msg).catch((err) => {
      writeMessage({ id, type: 'error', message: err.message });
    });
    return;
  }
  if (type === 'cancel') {
    const entry = inflight.get(msg.targetId);
    if (entry) {
      entry.cancelled = true;
      if (entry.proc) {
        try { entry.proc.kill('SIGTERM'); } catch {}
      }
    }
    writeMessage({ id, type: 'ok' });
    return;
  }
  if (type === 'listCommands') {
    try {
      const commands = listSlashCommands();
      writeMessage({ id, type: 'commands', commands });
    } catch (err) {
      writeMessage({ id, type: 'error', message: err.message });
    }
    return;
  }
  writeMessage({ id, type: 'error', message: `unknown type: ${type}` });
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
function parseFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const eq = line.indexOf(':');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[a-zA-Z_][\w-]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function readMarkdownMeta(filePath, fallbackName) {
  try {
    const fd = readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 4096);
    const meta = parseFrontmatter(fd);
    return {
      name: meta.name || fallbackName,
      description: meta.description || '',
    };
  } catch {
    return { name: fallbackName, description: '' };
  }
}

function scanCommandsDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  try {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      const filePath = join(dir, ent.name);
      const fallback = ent.name.replace(/\.md$/, '');
      out.push(readMarkdownMeta(filePath, fallback));
    }
  } catch {}
  return out;
}

function scanSkillsDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  try {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const filePath = join(dir, ent.name, 'SKILL.md');
      if (!existsSync(filePath)) continue;
      out.push(readMarkdownMeta(filePath, ent.name));
    }
  } catch {}
  return out;
}

function listSlashCommands() {
  const seen = new Set();
  const out = [];
  function push(meta, source) {
    if (!meta || !meta.name) return;
    if (seen.has(meta.name)) return;
    seen.add(meta.name);
    out.push({ name: meta.name, description: meta.description || '', source });
  }

  // 1) User's own (non-plugin) skills.
  const home = process.env.HOME;
  if (home) {
    for (const meta of scanSkillsDir(join(home, '.claude', 'skills'))) {
      push(meta, 'user');
    }
  }

  // 2) Plugins, via `claude plugin list --json`. Honor enabled status.
  let plugins = [];
  try {
    const stdout = execSync('claude plugin list --json', {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    plugins = JSON.parse(stdout);
  } catch (err) {
    logErr('plugin list failed:', err.message?.slice(0, 200) || String(err));
  }
  if (Array.isArray(plugins)) {
    for (const p of plugins) {
      if (!p?.enabled) continue;
      const root = p.installPath;
      if (!root) continue;
      for (const meta of scanCommandsDir(join(root, 'commands'))) push(meta, 'plugin');
      for (const meta of scanSkillsDir(join(root, 'skills'))) push(meta, 'plugin');
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function formatMessage({ file, lines, code, question }) {
  const fence = pickFence(code);
  const header = file ? `${file}${lines ? `:${lines}` : ''}` : '';
  const codeBlock = code ? `${fence}${header}\n${code}\n${fence}\n\n` : '';
  return `${codeBlock}${question}`;
}

function pickFence(code) {
  if (!code) return '```';
  const longest = (code.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function saveAttachedImages(images) {
  if (!Array.isArray(images) || images.length === 0) return { paths: [] };
  const paths = [];
  for (const img of images) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(img.dataUrl || '');
    if (!m) continue;
    const mime = m[1];
    const ext = mime.split('/')[1] || 'bin';
    const filename = `${randomUUID()}.${ext}`;
    const fullPath = join(TMP_DIR, filename);
    try {
      writeFileSync(fullPath, Buffer.from(m[2], 'base64'));
      paths.push(fullPath);
    } catch (err) {
      logErr('failed to write image:', err.message);
    }
  }
  return { paths };
}

function cleanupImagePaths(paths) {
  for (const p of paths) {
    try { unlinkSync(p); } catch {}
  }
}

async function handleSend(msg) {
  const { id, prUrl, file, lines, code, question, cwd, images, resumeSessionId } = msg;
  if (!prUrl || !question) {
    writeMessage({ id, type: 'error', message: 'prUrl and question required' });
    return;
  }

  // If background passed a resumeSessionId, that's the persisted mapping
  // from chrome.storage.local — pre-seed it so getOrCreate returns it and
  // isNew is false (→ claude --resume instead of --session-id).
  if (resumeSessionId && typeof resumeSessionId === 'string') {
    sessions.set(prUrl, resumeSessionId);
  }
  const isNew = !sessions.has(prUrl);
  const sessionId = sessions.getOrCreate(prUrl);
  let formatted = formatMessage({ file, lines, code, question });

  // Save any pasted images to a tmp dir; prepend their paths to the
  // user message so claude's Read tool can open them. Cleaned up on
  // proc exit and the OS sweeps $TMPDIR on its own schedule too.
  const { paths: imagePaths } = saveAttachedImages(images);
  if (imagePaths.length > 0) {
    const lines = imagePaths.map((p) => `- ${p}`).join('\n');
    formatted = `Attached images (use Read tool to view):\n${lines}\n\n${formatted}`;
  }

  let proc;
  try {
    proc = runClaude({ sessionId, isNew, message: formatted, cwd, extraDirs: imagePaths.length > 0 ? [TMP_DIR] : undefined });
  } catch (err) {
    cleanupImagePaths(imagePaths);
    writeMessage({ id, type: 'error', message: err.message });
    return;
  }
  inflight.set(id, { proc, imagePaths });

  let stderrBuf = '';
  proc.stderr?.on('data', (chunk) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
  });

  proc.on('error', (err) => {
    const message = err.code === 'ENOENT'
      ? '`claude` CLI not found on PATH. Install Claude Code and retry.'
      : err.message;
    writeMessage({ id, type: 'error', message });
    inflight.delete(id);
  });

  proc.on('exit', (code, signal) => {
    logErr(`claude ${sessionId.slice(0, 8)} exit code=${code} signal=${signal} stderr=${stderrBuf.length}`);
    const entry = inflight.get(id);
    if (entry?.cancelled || (signal && code === null)) {
      // Signal-kill (user-initiated cancel or process killed externally).
      // Synthesize a 'done' so the side panel finalizes the bubble cleanly
      // instead of leaving its thinking-dots animating forever.
      if (inflight.has(id)) writeMessage({ id, type: 'done', sessionId });
    } else if (code !== 0 && code !== null && inflight.has(id)) {
      writeMessage({ id, type: 'error', message: `claude exited (code=${code}): ${stderrBuf.slice(-400) || '(no stderr)'}` });
    }
    cleanupImagePaths(imagePaths);
    inflight.delete(id);
  });

  const emitter = new EventEmitter();
  emitter.on('error', () => {}); // prevent unhandled
  emitter.on('delta', (text) => {
    writeMessage({ id, type: 'delta', text });
  });
  emitter.on('done', (info) => {
    writeMessage({ id, type: 'done', sessionId: info.sessionId });
  });

  try {
    await parseStream(proc.stdout, emitter);
  } catch (err) {
    writeMessage({ id, type: 'error', message: err.message });
  }
}

process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

readMessages().catch((err) => {
  logErr('fatal:', err.message);
  process.exit(1);
});

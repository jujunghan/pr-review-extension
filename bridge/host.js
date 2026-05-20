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
import { parseStream, runClaude } from './src/claude.js';
import { createSessionStore } from './src/sessions.js';

const sessions = createSessionStore();
const inflight = new Map(); // id -> { proc }

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
  writeMessage({ id, type: 'error', message: `unknown type: ${type}` });
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

async function handleSend(msg) {
  const { id, prUrl, file, lines, code, question, cwd } = msg;
  if (!prUrl || !question) {
    writeMessage({ id, type: 'error', message: 'prUrl and question required' });
    return;
  }

  const isNew = !sessions.has(prUrl);
  const sessionId = sessions.getOrCreate(prUrl);
  const formatted = formatMessage({ file, lines, code, question });

  let proc;
  try {
    proc = runClaude({ sessionId, isNew, message: formatted, cwd });
  } catch (err) {
    writeMessage({ id, type: 'error', message: err.message });
    return;
  }
  inflight.set(id, { proc });

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
    if (code !== 0 && code !== null && inflight.has(id)) {
      writeMessage({ id, type: 'error', message: `claude exited (code=${code}): ${stderrBuf.slice(-400) || '(no stderr)'}` });
    }
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

import express from 'express';
import { EventEmitter } from 'node:events';
import { parseStream } from './claude.js';

export function createApp({ runClaude, sessions }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.post('/clear', (req, res) => {
    const { prUrl } = req.body || {};
    if (!prUrl) return res.status(400).json({ error: 'prUrl required' });
    sessions.clear(prUrl);
    res.json({ ok: true });
  });

  app.post('/send', async (req, res) => {
    const { prUrl, file, lines, code, question } = req.body || {};
    if (!prUrl || !question) {
      return res.status(400).json({ error: 'prUrl and question required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const isNew = !sessions.has(prUrl);
    const sessionId = sessions.getOrCreate(prUrl);
    const formatted = formatMessage({ file, lines, code, question });

    let ended = false;
    function endOnce() {
      if (ended) return;
      ended = true;
      res.end();
    }

    const emitter = new EventEmitter();
    emitter.on('delta', (text) => {
      res.write(`event: delta\ndata: ${JSON.stringify(text)}\n\n`);
    });
    emitter.on('done', (info) => {
      res.write(`event: done\ndata: ${JSON.stringify(info)}\n\n`);
      endOnce();
    });
    emitter.on('error', (err) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    });

    const TIMEOUT_MS = 30_000;
    let idleTimer = setTimeout(timeoutOut, TIMEOUT_MS);
    function bumpTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(timeoutOut, TIMEOUT_MS);
    }
    function timeoutOut() {
      emitter.emit('error', new Error('No response for 30s. Aborted.'));
      try { proc?.kill('SIGTERM'); } catch {}
      endOnce();
    }
    emitter.on('delta', bumpTimer);
    emitter.on('done', () => clearTimeout(idleTimer));

    let proc;
    try {
      proc = runClaude({ sessionId, isNew, message: formatted });
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      return endOnce();
    }

    proc.on('error', (err) => {
      const msg = err.code === 'ENOENT'
        ? '`claude` CLI not found on PATH. Install Claude Code and retry.'
        : err.message;
      emitter.emit('error', new Error(msg));
      endOnce();
    });

    req.on('close', () => {
      try { proc.kill('SIGTERM'); } catch {}
    });

    try {
      await parseStream(proc.stdout, emitter);
    } catch (err) {
      emitter.emit('error', err);
    }
    // Defer endOnce so that any proc 'error' events queued via setImmediate
    // (e.g. ENOENT from Node's spawn internals) are handled before we close
    // the response and their SSE writes are visible to the client.
    setImmediate(endOnce);
  });

  return app;
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

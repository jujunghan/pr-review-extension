import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createApp } from '../src/server.js';

function makeFakeProc(lines) {
  const stdout = Readable.from(lines.map((l) => l + '\n'));
  const proc = new EventEmitter();
  proc.stdout = stdout;
  proc.stderr = Readable.from([]);
  proc.kill = () => {};
  return proc;
}

function stubSessions() {
  const map = new Map();
  return {
    getOrCreate(url) {
      if (!map.has(url)) map.set(url, 'sid-' + map.size);
      return map.get(url);
    },
    has: (url) => map.has(url),
    clear: (url) => map.delete(url),
  };
}

test('GET /health returns ok', async () => {
  const app = createApp({ runClaude: () => null, sessions: stubSessions() });
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
  server.close();
});

test('POST /send streams deltas via SSE', async () => {
  const fakeProc = makeFakeProc([
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-1' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', session_id: 'sid-1' }),
  ]);
  const app = createApp({
    runClaude: () => fakeProc,
    sessions: stubSessions(),
  });
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prUrl: 'https://github.com/o/r/pull/1',
      file: 'a.js',
      lines: '1-10',
      code: 'foo',
      question: 'why?',
    }),
  });
  const text = await res.text();
  assert.match(text, /event: delta/);
  assert.match(text, /data: "hi"/);
  assert.match(text, /event: done/);
  server.close();
});

test('POST /clear removes mapping', async () => {
  const sessions = stubSessions();
  sessions.getOrCreate('https://github.com/o/r/pull/1');
  const app = createApp({ runClaude: () => null, sessions });
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/clear`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prUrl: 'https://github.com/o/r/pull/1' }),
  });
  assert.equal(res.status, 200);
  assert.equal(sessions.has('https://github.com/o/r/pull/1'), false);
  server.close();
});

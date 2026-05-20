import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { parseStream } from '../src/claude.js';

function makeReadable(lines) {
  return Readable.from(lines.map((l) => l + '\n'));
}

test('parseStream emits delta for partial assistant text', async () => {
  const events = [];
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: ' world' }] },
    }),
    JSON.stringify({ type: 'result', subtype: 'success', session_id: 'abc' }),
  ];

  const emitter = new EventEmitter();
  emitter.on('delta', (t) => events.push(['delta', t]));
  emitter.on('done', (r) => events.push(['done', r]));

  await parseStream(makeReadable(lines), emitter);

  assert.deepEqual(events, [
    ['delta', 'Hello'],
    ['delta', ' world'],
    ['done', { sessionId: 'abc' }],
  ]);
});

test('parseStream emits error on malformed JSON line', async () => {
  const events = [];
  const emitter = new EventEmitter();
  emitter.on('error', (e) => events.push(['error', e.message]));
  emitter.on('done', () => events.push(['done']));

  await parseStream(
    makeReadable(['not json', JSON.stringify({ type: 'result', session_id: 'x' })]),
    emitter,
  );

  assert.equal(events[0][0], 'error');
  assert.equal(events[1][0], 'done');
});

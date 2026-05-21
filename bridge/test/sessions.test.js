import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../src/sessions.js';

test('getOrCreate returns same UUID for same PR URL', () => {
  const store = createSessionStore();
  const id1 = store.getOrCreate('https://github.com/owner/repo/pull/1');
  const id2 = store.getOrCreate('https://github.com/owner/repo/pull/1');
  assert.equal(id1, id2);
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('getOrCreate throws on non-string or empty prUrl', () => {
  const store = createSessionStore();
  assert.throws(() => store.getOrCreate(null), TypeError);
  assert.throws(() => store.getOrCreate(undefined), TypeError);
  assert.throws(() => store.getOrCreate(''), TypeError);
  assert.throws(() => store.getOrCreate(123), TypeError);
});

test('getOrCreate returns different UUID for different PR URL', () => {
  const store = createSessionStore();
  const id1 = store.getOrCreate('https://github.com/owner/repo/pull/1');
  const id2 = store.getOrCreate('https://github.com/owner/repo/pull/2');
  assert.notEqual(id1, id2);
});

test('clear(url) drops mapping; next getOrCreate returns new UUID', () => {
  const store = createSessionStore();
  const id1 = store.getOrCreate('https://github.com/owner/repo/pull/1');
  store.clear('https://github.com/owner/repo/pull/1');
  const id2 = store.getOrCreate('https://github.com/owner/repo/pull/1');
  assert.notEqual(id1, id2);
});

test('has(url) reflects existence', () => {
  const store = createSessionStore();
  assert.equal(store.has('https://github.com/owner/repo/pull/1'), false);
  store.getOrCreate('https://github.com/owner/repo/pull/1');
  assert.equal(store.has('https://github.com/owner/repo/pull/1'), true);
});

test('set(prUrl, id) stores the id and getOrCreate returns it', () => {
  const store = createSessionStore();
  const id = '11111111-2222-3333-4444-555555555555';
  store.set('https://github.com/owner/repo/pull/1', id);
  assert.equal(store.has('https://github.com/owner/repo/pull/1'), true);
  assert.equal(store.getOrCreate('https://github.com/owner/repo/pull/1'), id);
});

test('set throws on non-string or empty inputs', () => {
  const store = createSessionStore();
  assert.throws(() => store.set('', 'abc'), TypeError);
  assert.throws(() => store.set('url', ''), TypeError);
  assert.throws(() => store.set(null, 'abc'), TypeError);
  assert.throws(() => store.set('url', 123), TypeError);
});

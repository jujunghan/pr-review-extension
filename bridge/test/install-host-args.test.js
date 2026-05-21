import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExtId, DEFAULT_PROD_EXT_ID } from '../install-host.js';

const VALID_A = 'a'.repeat(32);
const VALID_B = 'b'.repeat(32);
const INVALID = 'not-an-ext-id';

test('flag --ext-id wins over env and default', () => {
  const id = resolveExtId({
    argv: ['--ext-id', VALID_A],
    env: { PR_REVIEW_EXT_ID: VALID_B },
    defaultId: 'c'.repeat(32),
  });
  assert.equal(id, VALID_A);
});

test('env PR_REVIEW_EXT_ID is used when flag missing', () => {
  const id = resolveExtId({
    argv: [],
    env: { PR_REVIEW_EXT_ID: VALID_B },
    defaultId: 'c'.repeat(32),
  });
  assert.equal(id, VALID_B);
});

test('default is used when flag and env both missing', () => {
  const id = resolveExtId({
    argv: [],
    env: {},
    defaultId: VALID_A,
  });
  assert.equal(id, VALID_A);
});

test('returns null when nothing resolves to a valid id', () => {
  const id = resolveExtId({
    argv: [],
    env: {},
    defaultId: 'PLACEHOLDER_UNTIL_CWS_SUBMISSION',
  });
  assert.equal(id, null);
});

test('returns null when --ext-id has invalid format', () => {
  const id = resolveExtId({
    argv: ['--ext-id', INVALID],
    env: { PR_REVIEW_EXT_ID: VALID_A },
    defaultId: VALID_B,
  });
  // Invalid flag is a user error — do not silently fall back.
  assert.equal(id, null);
});

test('DEFAULT_PROD_EXT_ID is the documented placeholder until P3', () => {
  assert.equal(DEFAULT_PROD_EXT_ID, 'PLACEHOLDER_UNTIL_CWS_SUBMISSION');
});

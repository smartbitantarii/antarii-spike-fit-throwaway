/**
 * Tests for the leg (i) pending-request verdict. The native read cannot run
 * off a phone; the verdict is where a "no mark" gets misattributed, so it is
 * the half worth testing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EXPO_BACKGROUND_IDENTIFIER, judgePending } from './background-pending.ts';

const AT = '2026-11-03T18:00:00.000Z';

test('our request among those iOS holds is "held", with its earliest date', () => {
  const r = judgePending(
    [{ identifier: EXPO_BACKGROUND_IDENTIFIER, kind: 'processing', earliestBeginDate: '2026-11-03T18:15:00Z' }],
    AT,
  );
  assert.equal(r.verdict, 'held');
  assert.match(r.detail, /earliest 2026-11-03T18:15:00Z/);
});

test('🔴 an empty list is "not-held" — a later "no mark" is then our setup', () => {
  const r = judgePending([], AT);
  assert.equal(r.verdict, 'not-held');
  assert.match(r.detail, /All pending: none/);
});

test('⚠ a request under another identifier is not ours, and stays visible', () => {
  const r = judgePending(
    [{ identifier: 'antarii-spike-queue-drain', kind: 'processing', earliestBeginDate: '' }],
    AT,
  );
  assert.equal(r.verdict, 'not-held');
  assert.match(r.detail, /antarii-spike-queue-drain/);
});

test('no module is "not-checked", never "not-held"', () => {
  // Android has no module; reading that as "iOS holds nothing" would turn an
  // absent check into a finding.
  assert.equal(judgePending(null, AT).verdict, 'not-checked');
});

test('a thrown read is "threw", and the error is kept verbatim', () => {
  const r = judgePending(null, AT, 'boom');
  assert.equal(r.verdict, 'threw');
  assert.match(r.detail, /threw: boom/);
});

test('every verdict says that being held is not being run', () => {
  for (const r of [judgePending([], AT), judgePending(null, AT)]) {
    assert.match(r.notProven, /RUN/);
  }
});

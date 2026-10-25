/**
 * §3a's fill — the targets, the split, and the description that replaces a
 * hand-typed field.
 *
 * Run: node --test src/store/fill.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANSWERS_PER_INSTANCE,
  BUDGET_BYTES,
  FILL_FRACTION,
  MEDIA_TARGET_BYTES,
  RECORD_FRACTION,
  RECORD_TARGET_BYTES,
  SIGNATURE_BYTES,
  TOTAL_TARGET_BYTES,
  describeFill,
  fillState,
  instanceRows,
  remaining,
  signatureBlob,
} from './fill.ts';

test('the targets are SwR-100 and SwR-115 arithmetic, not round numbers', () => {
  // SwR-115's budget, SwR-100's 80 %, §3a's quarter for the record side.
  assert.equal(BUDGET_BYTES, 2 * 1024 * 1024 * 1024);
  assert.equal(FILL_FRACTION, 0.8);
  assert.equal(RECORD_FRACTION, 0.25);
  assert.equal(TOTAL_TARGET_BYTES, Math.round(BUDGET_BYTES * 0.8));
  assert.equal(RECORD_TARGET_BYTES, Math.round(BUDGET_BYTES * 0.25));

  // 🔴 The media side is what is LEFT, never its own fraction. Stating both
  // independently would let the three drift apart and stop summing to 80 %.
  assert.equal(RECORD_TARGET_BYTES + MEDIA_TARGET_BYTES, TOTAL_TARGET_BYTES);
});

test('the record side is about a quarter of the budget and the rest is media', () => {
  // §3a's own proportion, asserted so a later edit to one constant cannot
  // silently change the split the figures are compared across.
  assert.ok(Math.abs(RECORD_TARGET_BYTES / TOTAL_TARGET_BYTES - 0.3125) < 0.001);
  assert.ok(MEDIA_TARGET_BYTES > RECORD_TARGET_BYTES, 'media is the larger side');
});

test('completeness needs BOTH sides, not the total', () => {
  // ⚠ The trap this guards: a store stuffed with 1.6 GiB of records alone
  // would hit the total and be a fill §3a explicitly distinguishes from —
  // "a store full of media and a store full of records cost different
  // amounts for exactly the figures condition 1 measures".
  const recordsOnly = fillState({
    recordBytes: TOTAL_TARGET_BYTES,
    mediaBytes: 0,
    jobs: 200,
    instances: 1,
    answers: 1,
    mediaFiles: 0,
  });
  assert.equal(recordsOnly.totalBytes, TOTAL_TARGET_BYTES);
  assert.equal(recordsOnly.complete, false, 'the total is reached but the split is wrong');

  const both = fillState({
    recordBytes: RECORD_TARGET_BYTES,
    mediaBytes: MEDIA_TARGET_BYTES,
    jobs: 200,
    instances: 10,
    answers: 210,
    mediaFiles: 470,
  });
  assert.equal(both.complete, true);
});

test('remaining never goes negative when a side overshoots', () => {
  const over = fillState({
    recordBytes: RECORD_TARGET_BYTES * 2,
    mediaBytes: 0,
    jobs: 0,
    instances: 0,
    answers: 0,
    mediaFiles: 0,
  });
  const r = remaining(over);
  assert.equal(r.recordBytes, 0, 'an overshot side needs nothing, not a negative amount');
  assert.equal(r.mediaBytes, MEDIA_TARGET_BYTES);
});

test('an instance is many small answers and one large signature', () => {
  const rows = instanceRows(7);
  assert.equal(rows.length, ANSWERS_PER_INSTANCE + 1, 'the answers plus the signature');

  const sig = rows[rows.length - 1]!;
  assert.equal(sig.field, 'signature');
  assert.equal(sig.value.length, SIGNATURE_BYTES);

  // §3a: "completed instances with their answers and signatures". The shape
  // is lopsided on purpose — the signature dominates the instance's footprint.
  const answerBytes = rows.slice(0, -1).reduce((n, r) => n + r.value.length, 0);
  assert.ok(sig.value.length > answerBytes * 10, 'the signature should dominate');
});

test('the fill is deterministic — the same instance yields the same bytes', () => {
  // Otherwise two devices filled "the same way" hold different data, and the
  // figures stop being comparable across them.
  assert.deepEqual(instanceRows(42), instanceRows(42));
  assert.equal(signatureBlob(42), signatureBlob(42));
});

test('different instances differ, so the pages are not all one repeated string', () => {
  // ⚠ Identical rows would let any page-level compression flatter the fill:
  // the database would reach fewer bytes for the same row count, and the
  // record side would be smaller than the figure claims.
  assert.notEqual(signatureBlob(1), signatureBlob(2));
  assert.notDeepEqual(instanceRows(1), instanceRows(2));
});

test('describeFill is derived from measurement, never typed', () => {
  // 🔴 The field it replaces was hand-typed, and on 2026-10-24 a record went
  // out reading "none - wmpty store". A condition records cannot be grouped
  // by is barely a recorded condition.
  const empty = fillState({
    recordBytes: 0, mediaBytes: 0, jobs: 0, instances: 0, answers: 0, mediaFiles: 0,
  });
  assert.match(describeFill(empty), /^none/);

  const partial = fillState({
    recordBytes: 1024 * 1024, mediaBytes: 0, jobs: 200, instances: 1, answers: 21, mediaFiles: 0,
  });
  assert.match(describeFill(partial), /INCOMPLETE/, 'a part-built fill must say so');

  const done = fillState({
    recordBytes: RECORD_TARGET_BYTES,
    mediaBytes: MEDIA_TARGET_BYTES,
    jobs: 200, instances: 10_000, answers: 210_000, mediaFiles: 470,
  });
  const text = describeFill(done);
  assert.doesNotMatch(text, /INCOMPLETE/);
  // Both sides of the split appear, which is what §3a asks be recorded.
  assert.match(text, /records/);
  assert.match(text, /media/);
  assert.match(text, /200 jobs/);
});

test('the fill records that it is built from unconfirmed work', () => {
  // §3a: SwR-115 prunes "confirmed items beyond their retention… oldest
  // first, automatically" at exactly this level, and the spike is offline so
  // SwR-109's second limb can never be satisfied. A fill of confirmed items
  // past 30 days would delete itself under the measurement.
  const s = fillState({
    recordBytes: 1, mediaBytes: 1, jobs: 1, instances: 1, answers: 1, mediaFiles: 1,
  });
  assert.equal(s.unconfirmedOnly, true);
});

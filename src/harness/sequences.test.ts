/**
 * Tests for M7's sequences as data.
 * Run: node --test src/harness/sequences.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQUENCES,
  SHARES_START_WITH,
  drivableSequences,
  stepsForRecord,
  whyNotDrivable,
} from './sequences.ts';
import { CONDITION, TARGET_MS, type SeqId } from './harness.ts';

const ALL = Object.keys(SEQUENCES) as SeqId[];

test('all eight sequences are present, and they are the harness’s eight', () => {
  assert.equal(ALL.length, 8);
  assert.deepEqual([...ALL].sort(), Object.keys(TARGET_MS).sort());
  assert.deepEqual([...ALL].sort(), Object.keys(CONDITION).sort());
});

test('§6a: every sequence carries its steps, so the record can list them', () => {
  for (const id of ALL) {
    assert.ok(SEQUENCES[id].steps.length >= 2, id + ' has no usable steps');
    for (const s of SEQUENCES[id].steps) assert.ok(s.trim().length > 0, id + ' has an empty step');
  }
});

test('the steps include the RESET, which the sample depends on', () => {
  // Without the reset each iteration starts from the previous one's state, and
  // M7 lists it as a numbered step rather than an afterthought.
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5'] as SeqId[]) {
    assert.match(
      SEQUENCES[id].steps.join(' | '),
      /\(reset\)/,
      id + ' lists no reset step',
    );
  }
});

test('every step list names where the clock starts and stops', () => {
  for (const id of ALL) {
    const joined = SEQUENCES[id].steps.join(' | ');
    assert.match(joined, /mark start|Driven by S3/, id + ' never marks a start');
    assert.match(joined, /mark stop/, id + ' never marks a stop');
  }
});

// --------------------------------------------- what can actually be driven

test('🔴 only S3 and S6 are drivable today, and that is recorded rather than discovered', () => {
  assert.deepEqual(drivableSequences().sort(), ['S3', 'S6']);
});

test('every undrivable sequence says exactly what is missing, never a vague "not yet"', () => {
  for (const id of ALL) {
    const why = whyNotDrivable(id);
    if (SEQUENCES[id].drivable) {
      assert.equal(why, null, id + ' is drivable so it needs no reason');
      continue;
    }
    assert.ok(why && why.length > 30, id + ' gives no usable reason: ' + why);
    assert.doesNotMatch(why!, /^not yet|^todo|^tbd/i, id + ' gives a placeholder reason');
  }
});

test('the blockers name a missing THING, not a missing intention', () => {
  // A reason like "not implemented" tells a reader nothing about what to do.
  assert.match(SEQUENCES.S1.blockedBy!, /no job list/);
  assert.match(SEQUENCES.S2.blockedBy!, /focus/);
  assert.match(SEQUENCES.S4.blockedBy!, /no job or form list/);
  assert.match(SEQUENCES.S5.blockedBy!, /fixture/);
  assert.match(SEQUENCES.S7.blockedBy!, /evaluator/);
  assert.match(SEQUENCES.S8.blockedBy!, /pricing resolver/);
});

test('S5 is blocked by the FIXTURE, not by the camera needing a human', () => {
  // ⚠ M7 §3 says "a fixed fixture image, not a live capture" — so S5 is
  // automatable in principle, and recording it as "needs a human 101 times"
  // would have written off a sequence that only needs an asset.
  assert.match(SEQUENCES.S5.steps.join(' '), /fixed fixture image, not a live capture/);
  assert.match(SEQUENCES.S5.blockedBy!, /no fixture bundled/);
});

// ------------------------------------------------- the shared start

test('M7: S6 shares S3’s start, so driving them apart would make the pair incomparable', () => {
  assert.equal(SHARES_START_WITH.S6, 'S3');
  assert.equal(SHARES_START_WITH.S3, undefined, 'S3 owns the start');
  assert.match(SEQUENCES.S6.steps[0]!, /Driven by S3/);
});

test('S3’s steps require a field at least one RULE depends on', () => {
  // Without that, S6 — the re-evaluation — measures nothing at all, which M7
  // flags in the step itself.
  assert.match(SEQUENCES.S3.steps[0]!, /at least one rule depends on/);
  assert.match(SEQUENCES.S3.steps[0]!, /required, or S6 measures nothing/);
});

// ------------------------------------------------------- the record

test('§6a: stepsForRecord returns the steps of what was run, copied not shared', () => {
  const rec = stepsForRecord(['S3', 'S6']);
  assert.deepEqual(Object.keys(rec).sort(), ['S3', 'S6']);
  assert.deepEqual(rec.S3, SEQUENCES.S3.steps);
  rec.S3!.push('tampered');
  assert.ok(
    !SEQUENCES.S3.steps.includes('tampered'),
    'the record must not be able to mutate the specification',
  );
});

test('an empty selection yields an empty listing rather than everything', () => {
  assert.deepEqual(stepsForRecord([]), {});
});

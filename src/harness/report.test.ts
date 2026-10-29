/**
 * Tests for §8's record shape.
 * Run: node --test src/harness/report.test.ts
 *
 * ⚠ Several of these assert that a field is REQUIRED. That is the point of
 * the module: four of §8's lines exist because a review found them missing,
 * and a record that can omit them silently would repeat the finding.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord, emitRecord, serialiseRecord, devicePayload, stableJson, type RunRecord } from './report.ts';
import { TARGET_MS, type Figure } from './harness.ts';

function figure(seq: 'S1' = 'S1', n = 100): Figure {
  return {
    seq,
    condition: 1,
    targetMs: TARGET_MS[seq],
    n,
    p95Ms: 120,
    samplesMs: new Array(n).fill(120),
    discardedWarmupMs: [200],
    pass: true,
    context: { buildId: 'N', device: 'Galaxy M04', fill: '80%', offline: true },
  };
}

function goodRecord(): RunRecord {
  return {
    date: '2026-10-19T10:00:00.000Z',
    device: {
      platform: 'android',
      capability: 'mid-tier Android, ~3y, ~4 GB',
      model: 'Galaxy M04',
      osVersion: 'UP1A.231005.007.M045FXXSCEYG1',
      deviation: 'weaker than baseline',
    },
    formShape: { sections: 3, visibleFieldsInLargestSection: 20, repeatsGrownTo: 50 },
    worklistVolume: 200,
    offline: true,
    buildId: 'N',
    expoSdkVersion: '58.0.11',
    reactNativeVersion: '0.88.0',
    sequenceSteps: { S1: ['open the form', 'wait for the first field to accept input'] },
    batches: [
      {
        sequences: ['S1'],
        fillAtStart: { recordBytes: 1, mediaBytes: 1, percentOfBudget: 80 },
        fillAtEnd: { recordBytes: 1, mediaBytes: 2, percentOfBudget: 83 },
        figures: [figure()],
        conditions: { iterations: 101, warmupDiscarded: 1, settleMs: 0 },
      },
    ],
    saveStopEvent: 'durable in the device store — the write committed, not queued (brief §6c)',
    axis5: { step3: 'pass', step5aAt80Percent: 'pass', differenceFinding: null },
    footprint: { withWasmBytes: 40_000_000, withoutWasmBytes: 31_000_000 },
    decisions: {
      d1Package: 'expo-sqlite 58.0.13 with useSQLCipher',
      d2ConfigPlugin: "expo-sqlite's own first-party plugin; none written",
      d3LicenceVerbatim: 'BSD-style, from the licence file',
      d3Edition: 'community',
    },
    failures: [],
  };
}

test('a complete record validates and emits', () => {
  const r = goodRecord();
  assert.deepEqual(validateRecord(r), []);
  const json = emitRecord(r);
  assert.ok(json.includes('Galaxy M04'));
  assert.equal(JSON.parse(json).worklistVolume, 200);
});

test('an incomplete record is REFUSED, not emitted with gaps', () => {
  const r = goodRecord();
  r.saveStopEvent = '';
  assert.throws(() => emitRecord(r), /incomplete and will not be emitted/);
  assert.throws(() => emitRecord(r), /m6: the stop event/);
});

test('every problem is reported at once, not the first one found', () => {
  const r = goodRecord();
  r.date = '';
  r.worklistVolume = Number.NaN;
  r.saveStopEvent = '';
  const problems = validateRecord(r);
  assert.ok(problems.length >= 3, 'got: ' + problems.join(' | '));
});

// --------------------------- the four fields a review had to restore

test("M7: the device's CAPABILITY is required, not just the model", () => {
  const r = goodRecord();
  r.device.capability = '';
  assert.match(validateRecord(r).join('|'), /CAPABILITY is missing/);
});

test("M7: the form's shape is three numbers, not one", () => {
  const r = goodRecord();
  r.formShape.visibleFieldsInLargestSection = 0;
  assert.match(validateRecord(r).join('|'), /visible fields in the largest section/);
});

test('M7: the scripted steps are listed WITH the record, not referenced', () => {
  const r = goodRecord();
  r.sequenceSteps = {};
  assert.match(validateRecord(r).join('|'), /must be LISTED WITH the record/);
});

test('m3: the fill is recorded at the start AND end of each batch', () => {
  const r = goodRecord();
  // @ts-expect-error deliberately removing a required field
  delete r.batches[0].fillAtEnd;
  assert.match(validateRecord(r).join('|'), /START AND END, not once/);
});

test('M4: axis 5 is recorded twice, not once', () => {
  const r = goodRecord();
  r.axis5.step5aAt80Percent = '';
  assert.match(validateRecord(r).join('|'), /axis 5 is recorded TWICE/);
});

test("m6: condition 1's save figure carries the stop event it was measured against", () => {
  // Because §6c's definition is stricter than SwR-100's, a fail there is a
  // fail against a definition no requirement sets.
  const r = goodRecord();
  assert.ok(r.saveStopEvent.includes('not queued'));
  r.saveStopEvent = '';
  assert.match(validateRecord(r).join('|'), /m6/);
});

// --------------------------------------------- the failure attribution

test("§7 rule 4: 'vendor' is permitted on axis 5 ONLY", () => {
  const r = goodRecord();
  r.failures = [{
    condition: 1,
    figureOrLeg: 'S1',
    measured: '420ms',
    cause: 'vendor',
    handset: 'Galaxy M04',
    batterySetting: 'unrestricted',
    axis5: false,
  }];
  assert.match(validateRecord(r).join('|'), /'vendor' is permitted on axis 5 only/);

  r.failures[0]!.axis5 = true;
  assert.deepEqual(validateRecord(r), [], 'on axis 5 it is allowed');
});

test('FN5: a failure names the handset AND its battery setting', () => {
  const r = goodRecord();
  r.failures = [{
    condition: 2, figureOrLeg: 'S6', measured: '500ms', cause: 'prototype',
    handset: 'Galaxy M04', batterySetting: '', axis5: false,
  }];
  assert.match(validateRecord(r).join('|'), /names the handset AND its battery setting/);
});

// ------------------------------------------------------ the decisions

test('D3: a commercial edition must record the price; community need not', () => {
  const r = goodRecord();
  r.decisions.d3Edition = 'commercial';
  assert.match(validateRecord(r).join('|'), /commercial edition must record the price/);
  r.decisions.d3Price = '£0';
  assert.deepEqual(validateRecord(r), []);
});

test('D1/D2/D3 are required, being decisions rather than measurements', () => {
  const r = goodRecord();
  r.decisions.d1Package = '';
  r.decisions.d3LicenceVerbatim = '';
  const p = validateRecord(r).join('|');
  assert.match(p, /D1/);
  assert.match(p, /VERBATIM/);
});

// --------------------------------------------------------- not-established

test('a figure with a null p95 is VALID — "Not established" is a verdict, not an error', () => {
  const r = goodRecord();
  const f = figure('S1', 40);
  f.p95Ms = null;
  f.pass = null;
  r.batches[0]!.figures = [f];
  assert.deepEqual(validateRecord(r), [], 'the record may carry an unestablished figure');
});

test('serialisation is stable, so two records of one run compare byte for byte', () => {
  assert.equal(serialiseRecord(goodRecord()), serialiseRecord(goodRecord()));
});

test('🔴 serialisation keeps NESTED fields — the allowlist bug that emitted a husk', () => {
  // The first serialiser passed `Object.keys(r).sort()` as stringify's second
  // argument, which is an allowlist applied at EVERY level, so everything
  // nested was dropped. The record validated and then emitted almost empty.
  const json = emitRecord(goodRecord());
  const back = JSON.parse(json);
  assert.equal(back.device.model, 'Galaxy M04', 'nested device fields must survive');
  assert.equal(back.formShape.repeatsGrownTo, 50);
  assert.equal(back.batches[0].figures[0].n, 100);
  assert.equal(back.decisions.d1Package, 'expo-sqlite 58.0.13 with useSQLCipher');
  assert.equal(back.batches[0].fillAtEnd.percentOfBudget, 83);
});

test('arrays keep their order — a sorted time series would be meaningless', () => {
  const r = goodRecord();
  r.batches[0]!.figures[0]!.samplesMs = [300, 100, 200];
  const back = JSON.parse(serialiseRecord(r));
  assert.deepEqual(back.batches[0].figures[0].samplesMs, [300, 100, 200]);
});

test('🔴 a device payload SAYS whether it is a campaign or incidental marks', () => {
  const ctx = { buildId: 'N', device: 'Galaxy M04', fill: 'none', offline: true };
  const marks = devicePayload('incidental-marks', ctx, [figure()]);
  assert.equal(marks.kind, 'incidental-marks');
  assert.match(marks.kindNote, /NOT A MEASUREMENT/);
  assert.match(marks.kindNote, /Must not be read as a figure/);

  const campaign = devicePayload('campaign', ctx, [figure()]);
  assert.equal(campaign.kind, 'campaign');
  assert.match(campaign.kindNote, /warm-up discarded/);
  // ⚠ The note differs by kind, so the distinction survives into the file
  // rather than living in whoever remembers how the run was produced.
  assert.notEqual(marks.kindNote, campaign.kindNote);
});

test('the payload carries the run context a figure is meaningless without', () => {
  const ctx = { buildId: 'N+1', device: 'iPhone 13', fill: '80%', offline: false };
  const p = devicePayload('campaign', ctx, [figure()], '2026-10-19T12:00:00.000Z');
  assert.equal(p.buildId, 'N+1');
  assert.equal(p.device.model, 'iPhone 13');
  assert.equal(p.fill, '80%');
  assert.equal(p.offline, false);
  assert.equal(p.date, '2026-10-19T12:00:00.000Z');
});

test('§6a: a campaign payload carries its STEPS; incidental marks carry none', () => {
  const ctx = { buildId: 'N', device: 'Galaxy A35 5G', fill: 'none', offline: true };
  const steps = { S3: ['open at a field a rule depends on', 'mark start'] };

  const camp = devicePayload('campaign', ctx, [figure()], '2026-10-23T00:00:00.000Z', steps);
  assert.deepEqual(camp.steps, steps, 'the record must list what was performed');

  // ⚠ Empty for incidental marks, and that emptiness is informative: they
  // follow no script, so there are no steps to list.
  const marks = devicePayload('incidental-marks', ctx, [figure()]);
  assert.deepEqual(marks.steps, {});
});

test('🔴 the cold start travels as an observation with NO target and NO verdict', () => {
  // It was briefly instrumented as S1, which it is not: M7 starts S1 at the
  // form-open tap from the job list with the store already open. Reported
  // under S1's name it would have been judged against a 300ms target that
  // binds a navigation. SwR-100 binds five interactions and launch is not
  // among them, so a number without a verdict is the only honest shape.
  const ctx = { buildId: 'N', device: 'Galaxy A35 5G', fill: 'none', offline: true };
  const p = devicePayload('incidental-marks', ctx, [], '2026-10-23T00:00:00.000Z', {}, 306.9);

  assert.equal(p.coldStartMs, 306.9);
  // It must NOT appear among the figures, which carry targets and verdicts.
  assert.deepEqual(p.figures, []);
  assert.ok(!('targetMs' in (p as unknown as Record<string, unknown>)));
});

test('a payload with no cold start says null rather than omitting it', () => {
  const ctx = { buildId: 'N', device: 'x', fill: 'none', offline: true };
  const p = devicePayload('campaign', ctx, [figure()]);
  assert.equal(p.coldStartMs, null, 'absent must be explicit, not missing');
});

// ---------------------------------------------- adversarial review C1 and M4
//
// 🔴 Both findings are the same defect in two fields: a value that LOOKS
// recorded and was not. `offline` was a hard-coded `false` nothing ever wrote,
// so twenty records asserted a run condition against requirements that bind
// "offline included"; `buildId` was `N` across twenty-plus commits, so no
// record could say which code produced it.
//
// ⚠ These tests exist because the type system cannot catch it: this project
// has no type-checking, so a caller that omits either field compiles and runs.

test('C1: an omitted run condition records null, not false', () => {
  const ctx = { buildId: 'N', device: 'x', fill: 'none' } as never;
  const p = devicePayload('campaign', ctx, [figure()]);
  assert.equal(p.offline, null, 'absent must be *not established*, never a claim');
  assert.notEqual(p.offline, false, 'false is an assertion about the run');
});

test('C1: offline === false survives, because `||` would have eaten it', () => {
  // ⚠ The one-character version of the bug: `readOffline() || default` would
  // discard a legitimate recorded `false` for the null default.
  const ctx = { buildId: 'N', device: 'x', fill: 'none', offline: false };
  assert.equal(devicePayload('campaign', ctx, [figure()]).offline, false);
  const on = { buildId: 'N', device: 'x', fill: 'none', offline: true };
  assert.equal(devicePayload('campaign', on, [figure()]).offline, true);
});

test('M4: the commit is recorded, and an absent one is null rather than missing', () => {
  const withCommit = {
    buildId: 'N', device: 'x', fill: 'none', offline: true, commit: 'deadbee',
  };
  assert.equal(devicePayload('campaign', withCommit, [figure()]).commit, 'deadbee');

  const without = { buildId: 'N', device: 'x', fill: 'none', offline: true } as never;
  assert.equal(devicePayload('campaign', without, [figure()]).commit, null);
});

test('🔴 M4/C1: both keys are PRESENT in the serialised record even when unset', () => {
  // The real hazard, and the reason `?? null` is in the builder: an
  // `undefined` field is DROPPED by JSON.stringify, so the record would lose
  // the field entirely rather than carry "not established" into the evidence.
  const ctx = { buildId: 'N', device: 'x', fill: 'none' } as never;
  const json = stableJson(devicePayload('campaign', ctx, [figure()]));
  const back = JSON.parse(json) as Record<string, unknown>;
  assert.ok('offline' in back, 'offline must survive serialisation');
  assert.ok('commit' in back, 'commit must survive serialisation');
  assert.equal(back.offline, null);
  assert.equal(back.commit, null);
});

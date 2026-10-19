/**
 * Tests for the campaign runner.
 * Run: node --test src/harness/campaign.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Harness, SAMPLE_N, WARMUP_PASSES, type RunContext } from './harness.ts';
import { runCampaign, ITERATIONS } from './campaign.ts';

const context: RunContext = {
  buildId: 'N',
  device: 'test',
  fill: 'none',
  offline: true,
};

/** A clock the test drives, so elapsed times are exact rather than flaky. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function harnessWith(c: ReturnType<typeof clock>) {
  return new Harness(context, c.now);
}

test('a campaign runs 101 passes and reports 100 — the warm-up is discarded', async () => {
  const c = clock();
  const h = harnessWith(c);
  let seen = 0;
  const r = await runCampaign(h, 'S1', ({ iteration }) => {
    seen = iteration;
    h.start('S1');
    c.advance(10);
    h.stop('S1');
  });

  assert.equal(seen, ITERATIONS, 'the loop must run every iteration');
  assert.equal(ITERATIONS, SAMPLE_N + WARMUP_PASSES);
  assert.equal(r.figure.n, SAMPLE_N, 'the reported sample is 100');
  assert.equal(r.figure.discardedWarmupMs.length, WARMUP_PASSES);
  assert.equal(r.figure.p95Ms, 10);
  assert.equal(r.figure.pass, true, '10ms is inside S1\'s 300ms target');
});

test('the run conditions travel with the figure, because M7 does not fix them', async () => {
  const c = clock();
  const h = harnessWith(c);
  const r = await runCampaign(h, 'S1', () => { h.start('S1'); c.advance(1); h.stop('S1'); });
  assert.deepEqual(r.conditions, { iterations: 101, warmupDiscarded: 1, settleMs: 0 });
});

test('the warm-up flag is true only for the first pass', async () => {
  const c = clock();
  const h = harnessWith(c);
  const warm: number[] = [];
  await runCampaign(h, 'S1', ({ iteration, warmup }) => {
    if (warmup) warm.push(iteration);
    h.start('S1'); c.advance(1); h.stop('S1');
  });
  assert.deepEqual(warm, [1]);
});

// ------------------------------------------------- the contamination guard

test('🔴 a campaign REFUSES a harness that has already recorded that sequence', async () => {
  // This is the guard that matters most: App.tsx marks S1/S3/S6 during
  // ordinary use, into the same harness. Appending a campaign to that would
  // report a p95 over a mixture of conditions — which looks like a result.
  const c = clock();
  const h = harnessWith(c);
  h.start('S1'); c.advance(5); h.stop('S1'); // ordinary use, not a measurement

  await assert.rejects(
    () => runCampaign(h, 'S1', () => { h.start('S1'); c.advance(1); h.stop('S1'); }),
    /already has 1 recorded pass/,
  );
});

test('a clean harness for a DIFFERENT sequence is not blocked', async () => {
  const c = clock();
  const h = harnessWith(c);
  h.start('S1'); c.advance(5); h.stop('S1');
  const r = await runCampaign(h, 'S4', () => { h.start('S4'); c.advance(2); h.stop('S4'); });
  assert.equal(r.figure.n, SAMPLE_N, 'S4 was untouched, so it may be measured');
});

// ------------------------------------------- catching a broken iteration

test('an iteration that records nothing fails AT THAT ITERATION, not at the end', async () => {
  const c = clock();
  const h = harnessWith(c);
  await assert.rejects(
    () => runCampaign(h, 'S1', ({ iteration }) => {
      if (iteration === 3) return; // forgot to start/stop
      h.start('S1'); c.advance(1); h.stop('S1');
    }),
    /iteration 3 recorded 0 passes, not 1/,
  );
});

test('an iteration that records twice is caught too', async () => {
  const c = clock();
  const h = harnessWith(c);
  await assert.rejects(
    () => runCampaign(h, 'S1', ({ iteration }) => {
      h.start('S1'); c.advance(1); h.stop('S1');
      if (iteration === 2) { h.start('S1'); c.advance(1); h.stop('S1'); }
    }),
    /iteration 2 recorded 2 passes, not 1/,
  );
});

test('a throwing iteration names the iteration and whether it was the warm-up', async () => {
  const c = clock();
  const h = harnessWith(c);
  await assert.rejects(
    () => runCampaign(h, 'S1', ({ iteration }) => {
      if (iteration === 1) throw new Error('camera refused');
      h.start('S1'); c.advance(1); h.stop('S1');
    }),
    /iteration 1 of 101 \(warm-up\) failed: camera refused/,
  );
});

test('a leaked mark is attributed to the iteration that leaked it', async () => {
  const c = clock();
  const h = harnessWith(c);
  await assert.rejects(
    () => runCampaign(h, 'S1', ({ iteration }) => {
      h.start('S1'); c.advance(1); h.stop('S1');
      if (iteration === 2) h.start('S1'); // left open
    }),
    /left open/,
  );
});

// ------------------------------------------------------------- abort

test('an aborted campaign yields NO figure — a short sample is not a result', async () => {
  const c = clock();
  const h = harnessWith(c);
  const ac = new AbortController();
  await assert.rejects(
    () => runCampaign(h, 'S1', ({ iteration }) => {
      h.start('S1'); c.advance(1); h.stop('S1');
      if (iteration === 10) ac.abort();
    }, { signal: ac.signal }),
    /aborted after 10 of 101 iterations/,
  );
  // And what it did record stays below the sample, so p95 is null.
  assert.equal(h.figure('S1').p95Ms, null, 'a partial campaign must not produce a p95');
});

// ------------------------------------------------------------- settle

test('settleMs is honoured and recorded', async () => {
  const c = clock();
  const h = harnessWith(c);
  const r = await runCampaign(h, 'S1', () => { h.start('S1'); c.advance(1); h.stop('S1'); }, {
    settleMs: 1,
  });
  assert.equal(r.conditions.settleMs, 1);
  assert.equal(r.figure.n, SAMPLE_N);
});

test('a nonsense settle is refused rather than silently treated as zero', async () => {
  const c = clock();
  const h = harnessWith(c);
  await assert.rejects(
    () => runCampaign(h, 'S1', () => {}, { settleMs: -1 }),
    /non-negative/,
  );
});

// ------------------------------------------------- the reducing sequences

test('a sequence that reduces within an iteration (S2) contributes exactly one sample', async () => {
  // S2 moves focus 19 times per iteration and reduces those to that
  // iteration's own p95, so one iteration still contributes ONE sample —
  // which is what keeps n meaning what §6a says it means.
  const c = clock();
  const h = harnessWith(c);
  const r = await runCampaign(h, 'S2', () => {
    const within: number[] = [];
    for (let k = 0; k < 19; k++) {
      const t0 = c.now();
      c.advance(4);
      within.push(c.now() - t0);
    }
    h.reduceIteration('S2', within);
  });
  assert.equal(r.figure.n, SAMPLE_N, 'nineteen moves still make one sample');
  assert.equal(r.figure.p95Ms, 4);
});

test('⚠ driving S2 with nineteen stops instead of one reduce is CAUGHT', async () => {
  // The mistake this guard exists for, and it is an easy one: every `stop`
  // pushes a sample, so timing the nineteen moves through the harness would
  // quietly redefine the sample as 1,900 rather than 100.
  const c = clock();
  const h = harnessWith(c);
  await assert.rejects(
    () => runCampaign(h, 'S2', () => {
      for (let k = 0; k < 19; k++) { h.start('S2', 'f' + k); c.advance(4); h.stop('S2', 'f' + k); }
    }),
    /iteration 1 recorded 19 passes, not 1/,
  );
});

test('progress is reported for every iteration, warm-up included', async () => {
  const c = clock();
  const h = harnessWith(c);
  const seen: number[] = [];
  await runCampaign(h, 'S1', () => { h.start('S1'); c.advance(1); h.stop('S1'); }, {
    onProgress: (p) => seen.push(p.iteration),
  });
  assert.equal(seen.length, ITERATIONS);
  assert.equal(seen[0], 1);
  assert.equal(seen[seen.length - 1], ITERATIONS);
});

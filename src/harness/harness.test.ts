/**
 * Tests for M7's harness. An untested measurement harness is worse than none:
 * a wrong p95 here would be read as a requirement's verdict.
 *
 * Run: node --test src/harness/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Harness, p95, SAMPLE_N, TARGET_MS, CONDITION, type RunContext } from './harness.ts';

const ctx: RunContext = {
  buildId: 'test',
  device: 'test-device',
  fill: 'n/a',
  offline: false,
};

/** a clock we control, so no test depends on real elapsed time */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test('p95 returns null below the full sample, so a short run is never a result', () => {
  assert.equal(p95([1, 2, 3]), null);
  assert.equal(p95(new Array(SAMPLE_N - 1).fill(10)), null);
});

test('p95 is nearest-rank, so every figure reported actually occurred', () => {
  // 1..100 -> ceil(0.95*100) = 95th rank = value 95
  const s = Array.from({ length: SAMPLE_N }, (_, i) => i + 1);
  assert.equal(p95(s), 95);
  // order must not matter
  assert.equal(p95([...s].reverse()), 95);
});

test('the warm-up pass is discarded and n reports the sample, not the runs', () => {
  const c = fakeClock();
  const h = new Harness(ctx, c.now);
  // 101 runs: the first is warm-up
  for (let i = 0; i < SAMPLE_N + 1; i++) {
    h.start('S1');
    c.advance(i === 0 ? 9999 : 10); // a wild warm-up must not reach the sample
    h.stop('S1');
  }
  const f = h.figure('S1');
  assert.equal(f.n, SAMPLE_N, 'n must be the sample size, not the run count');
  assert.deepEqual(f.discardedWarmupMs, [9999]);
  assert.equal(f.p95Ms, 10, 'the discarded warm-up must not move the p95');
  assert.equal(f.pass, true);
});

test('one start carries two stops — S3 and S6 share a start by design', () => {
  const c = fakeClock();
  const h = new Harness(ctx, c.now);
  for (let i = 0; i < SAMPLE_N + 1; i++) {
    h.start('S3', `i${i}`);
    h.start('S6', `i${i}`);
    c.advance(20);
    h.stop('S3', `i${i}`); // durable in the store
    c.advance(30);
    h.stop('S6', `i${i}`); // next interaction accepted
  }
  assert.equal(h.figure('S3').p95Ms, 20);
  assert.equal(h.figure('S6').p95Ms, 50, 'S6 measures from the same start, not from S3 stop');
});

test('an unmeasured target is not-established, never a fail', () => {
  const h = new Harness(ctx, fakeClock().now);
  const f = h.figure('S8');
  assert.equal(f.n, 0);
  assert.equal(f.p95Ms, null);
  assert.equal(f.pass, null, 'pass must be null, not false — the gate-cell rule\'s third verdict');
});

test('condition 1 fails if ANY of its five exceeds its target — SwR-100 has no qualifier', () => {
  const c = fakeClock();
  const h = new Harness(ctx, c.now);
  const fill = (seq: 'S1' | 'S2' | 'S3' | 'S4' | 'S5', ms: number) => {
    for (let i = 0; i < SAMPLE_N + 1; i++) {
      h.start(seq, `i${i}`);
      c.advance(ms);
      h.stop(seq, `i${i}`);
    }
  };
  fill('S1', 10);
  fill('S2', 10);
  fill('S3', 10);
  fill('S4', 10);
  fill('S5', 2500); // over its 2 s target
  const r = h.condition1();
  assert.equal(r.verdict, 'fail');
  assert.equal(r.figures.filter((f) => f.pass === false).length, 1);
});

test('condition 1 is not-established while any of its five is unmeasured', () => {
  const c = fakeClock();
  const h = new Harness(ctx, c.now);
  for (let i = 0; i < SAMPLE_N + 1; i++) {
    h.start('S1');
    c.advance(10);
    h.stop('S1');
  }
  assert.equal(h.condition1().verdict, 'not-established');
});

test('S2 reduces its 19 field moves to one figure, so n keeps its meaning', () => {
  const h = new Harness(ctx, fakeClock().now);
  for (let i = 0; i < SAMPLE_N + 1; i++) {
    // 19 moves within the iteration; one slow move must not become a sample
    const within = [...new Array(18).fill(5), 280];
    h.reduceIteration('S2', within);
  }
  const f = h.figure('S2');
  assert.equal(f.n, SAMPLE_N, 'one figure per iteration, not 19');
  assert.equal(f.p95Ms, 280, "the iteration's own p95 is what is kept");
});

test('a leaked start is refused rather than silently losing a figure', () => {
  const h = new Harness(ctx, fakeClock().now);
  h.start('S4');
  assert.throws(() => h.start('S4'), /started twice/);
  assert.throws(() => h.stop('S1'), /without a start/);
  assert.throws(() => h.record(), /left open/);
});

test('targets and conditions match the brief', () => {
  assert.equal(TARGET_MS.S4, 1000);
  assert.equal(TARGET_MS.S5, 2000);
  assert.equal(TARGET_MS.S6, 300);
  assert.equal(CONDITION.S6, 2);
  assert.equal(CONDITION.S7, 6);
  assert.equal(CONDITION.S8, 7);
});

/**
 * The campaign runner — what turns a harness into a measurement.
 *
 * ⚠ WHY THIS DID NOT EXIST AND HAD TO. `Harness` TIMES a sequence: you call
 * `start`, the sequence happens, you call `stop`. It has no way to run
 * anything. §6a requires **n = 100 per figure per device with one warm-up pass
 * discarded**, and nothing in the spike drove that — so every figure the
 * project needs was unreachable even though the timing was built and tested.
 *
 * 🔴 AND `App.tsx` MARKING S1/S3/S6 DURING ORDINARY USE IS NOT A MEASUREMENT.
 * Those marks land in the same harness. A campaign started on a harness that
 * has already been used would **append to samples taken under different
 * conditions** and report a p95 over a mixture — which would look like a
 * result and be worthless. `runCampaign` refuses a dirty sequence outright.
 *
 * Imports only the harness. No platform, no React: a campaign is a loop with
 * rules, and all of the rules are testable on a development machine.
 */
import {
  SAMPLE_N,
  WARMUP_PASSES,
  type Figure,
  type Harness,
  type SeqId,
} from './harness.ts';

/** §6a: one warm-up discarded, so each sequence runs 101 and reports 100. */
export const ITERATIONS = WARMUP_PASSES + SAMPLE_N;

export interface IterationContext {
  /** 1-based, counting the warm-up */
  iteration: number;
  warmup: boolean;
}

/**
 * One pass of the sequence. It must call `harness.start(seq)` and
 * `harness.stop(seq)` exactly once between them — or, for a sequence that
 * reduces within an iteration like S2, call `reduceIteration` once.
 */
export type Iteration = (ctx: IterationContext) => Promise<void> | void;

export interface CampaignProgress {
  seq: SeqId;
  iteration: number;
  total: number;
  warmup: boolean;
}

export interface CampaignOptions {
  /**
   * Quiet time between iterations.
   *
   * ⚠ **M7 SPECIFIES NOTHING HERE, AND THAT SILENCE IS WHY THIS IS A
   * PARAMETER RATHER THAN A CONSTANT.** Running 101 iterations back to back
   * may couple them through thermal throttling or garbage collection; adding
   * a delay changes what is measured in a different way. Neither is obviously
   * right, so the value used is **carried into the result** and belongs in
   * §8's record beside the figure. Defaults to 0 — back to back — because
   * that is what the brief describes by omission, not because it is better.
   */
  settleMs?: number;
  onProgress?: (p: CampaignProgress) => void;
  /** Stops the campaign between iterations; mid-iteration is never cut. */
  signal?: AbortSignal;
}

export interface CampaignResult {
  figure: Figure;
  /** the run conditions this figure was taken under, for §8's record */
  conditions: { iterations: number; warmupDiscarded: number; settleMs: number };
  /** wall time for the whole campaign, which is not the figure */
  elapsedMs: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Everything the harness has recorded for a sequence, warm-ups included. */
function recordedCount(harness: Harness, seq: SeqId): number {
  const f = harness.figure(seq);
  return f.n + f.discardedWarmupMs.length;
}

/**
 * Runs one sequence to a full §6a sample.
 *
 * ⚠ ONE SEQUENCE AT A TIME, AND DELIBERATELY NOT CONCURRENT. Two campaigns
 * overlapping would contend for the device's CPU, disk and memory and
 * contaminate both figures — and the contamination would be invisible,
 * because each would still produce a plausible p95.
 */
export async function runCampaign(
  harness: Harness,
  seq: SeqId,
  iterate: Iteration,
  options: CampaignOptions = {},
): Promise<CampaignResult> {
  const settleMs = options.settleMs ?? 0;
  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new Error('settleMs must be a non-negative number of milliseconds');
  }

  // 🔴 The contamination guard. See the header: ordinary use of the app marks
  // the same sequences, and a p95 over a mixture is worse than no p95.
  const already = recordedCount(harness, seq);
  if (already > 0) {
    throw new Error(
      'M7: ' + seq + ' already has ' + already + ' recorded pass(es) on this harness. A campaign ' +
        'must start from a clean one, or the figure mixes samples taken under different conditions.',
    );
  }

  const startedAt = Date.now();

  for (let i = 1; i <= ITERATIONS; i++) {
    // Checked BETWEEN iterations only: cutting one mid-flight would leave a
    // mark open and silence the figure anyway.
    if (options.signal?.aborted) {
      throw new Error(
        'M7: ' + seq + ' campaign aborted after ' + (i - 1) + ' of ' + ITERATIONS +
          ' iterations — no figure, because a short sample is not a result.',
      );
    }

    const warmup = i <= WARMUP_PASSES;
    const before = recordedCount(harness, seq);

    try {
      await iterate({ iteration: i, warmup });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(
        'M7: ' + seq + ' iteration ' + i + ' of ' + ITERATIONS +
          (warmup ? ' (warm-up)' : '') + ' failed: ' + why,
      );
    }

    /**
     * ⚠ CAUGHT AT THE ITERATION THAT DID IT, not at the end. An `iterate`
     * that forgets to stop would otherwise run all 101 passes and hand back a
     * figure with `p95 = null`, and the operator would be left guessing which
     * part of a long run on a phone went wrong.
     */
    const after = recordedCount(harness, seq);
    if (after !== before + 1) {
      throw new Error(
        'M7: ' + seq + ' iteration ' + i + ' recorded ' + (after - before) +
          ' passes, not 1. Each iteration must call start/stop (or reduceIteration) exactly once.',
      );
    }

    // A leaked mark belongs to the iteration that leaked it.
    harness.assertSettled();

    if (options.onProgress) options.onProgress({ seq, iteration: i, total: ITERATIONS, warmup });
    if (settleMs > 0 && i < ITERATIONS) await delay(settleMs);
  }

  const figure = harness.figure(seq);

  /**
   * ⚠ The harness already returns `p95 = null` below a full sample, which is
   * the gate-cell rule's *Not established*. This asserts the count as well,
   * because reaching here with the wrong n means the loop itself is wrong —
   * a different fault from a run that was cut short, and one that would
   * otherwise hide behind the same null.
   */
  if (figure.n !== SAMPLE_N) {
    throw new Error(
      'M7: ' + seq + ' finished with n=' + figure.n + ', expected ' + SAMPLE_N +
        '. The campaign loop is wrong, not the run.',
    );
  }

  return {
    figure,
    conditions: { iterations: ITERATIONS, warmupDiscarded: WARMUP_PASSES, settleMs },
    elapsedMs: Date.now() - startedAt,
  };
}

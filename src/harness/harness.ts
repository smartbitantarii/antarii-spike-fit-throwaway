/**
 * M7 — the measurement harness for the ADR-003 fit spike and the ADR-005
 * evaluator-hosting spike.
 *
 * Brief §6a: "Instrumented, not hand-timed. Every figure is taken from timers
 * inside the prototype, driven by a scripted interaction sequence whose steps
 * are listed with the record."
 *
 * The sequences are specified in the documentation repository at
 * initiatives/architecture-and-technology/spikes/M7-scripted-sequences.md.
 * This file implements the contract that specification defines; it does not
 * decide any target or clock.
 *
 * Deliberately dependency-free: it must run identically on both devices and
 * add nothing to what is being measured.
 */

export type SeqId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';

/** Targets are the requirements', via brief §6b. Milliseconds. */
export const TARGET_MS: Readonly<Record<SeqId, number>> = Object.freeze({
  S1: 300,   // opening a form                      SwR-100
  S2: 300,   // moving between fields                SwR-100
  S3: 300,   // saving an answer                     SwR-100
  S4: 1000,  // opening the job or form list         SwR-100
  S5: 2000,  // photograph attached and visible      SwR-100, SwR-086, SwR-102
  S6: 300,   // SwR-066 re-evaluation                SyR-088
  S7: 300,   // guard evaluation                     SyR-088
  S8: 300,   // pricing resolution                   SwR-036
});

export const CONDITION: Readonly<Record<SeqId, number>> = Object.freeze({
  S1: 1, S2: 1, S3: 1, S4: 1, S5: 1, S6: 2, S7: 6, S8: 7,
});

/** §6a: n = 100 per figure per device, and one warm-up pass discarded. */
export const SAMPLE_N = 100;
export const WARMUP_PASSES = 1;

type Mark = { seq: SeqId; token: string; at: number };

export interface RunContext {
  /** build identifier, recorded with every figure (§6d) */
  buildId: string;
  /** capability and actual model, e.g. "mid-tier Android / Pixel 6a" (§6d) */
  device: string;
  /** the §3a fill state the device is at THROUGHOUT the sample (§6a) */
  fill: string;
  /** whether the run is offline (§6d) */
  offline: boolean;
}

/**
 * One figure's result. Every sample is retained, not only the p95 — a p95
 * nobody can re-examine is indefensible, and a condition-1 failure reopens
 * three ADRs. (M7-scripted-sequences.md §4c, the author's choice.)
 */
export interface Figure {
  seq: SeqId;
  condition: number;
  targetMs: number;
  n: number;
  p95Ms: number | null;
  samplesMs: number[];
  discardedWarmupMs: number[];
  pass: boolean | null;
  context: RunContext;
}

/**
 * p95 by the nearest-rank method on a sorted sample.
 *
 * Nearest-rank is chosen over interpolation deliberately: every reported
 * figure is then a measurement that actually occurred, which matters when the
 * figure gates an ADR's acceptance. Returns null below the full sample so a
 * short run can never be mistaken for a result.
 */
export function p95(samplesMs: readonly number[]): number | null {
  if (samplesMs.length < SAMPLE_N) return null;
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[rank - 1];
}

export class Harness {
  private readonly open = new Map<string, Mark>();
  private readonly samples = new Map<SeqId, number[]>();
  private readonly warmup = new Map<SeqId, number[]>();
  private readonly iterations = new Map<SeqId, number>();

  private readonly context: RunContext;
  /** injected so the prototype's own clock is read, never a wall clock outside it (§6a) */
  private readonly now: () => number;

  /**
   * Fields are assigned explicitly rather than declared as constructor
   * parameter properties: those emit code, so a strip-only TypeScript loader
   * refuses them. Keeping to strip-only syntax means this harness runs under
   * any toolchain on either device, which is the point of it.
   */
  constructor(context: RunContext, now: () => number = () => Date.now()) {
    this.context = context;
    this.now = now;
  }

  private key(seq: SeqId, token: string): string {
    return `${seq}::${token}`;
  }

  /**
   * One start event may carry several stops: S3 and S6 share a start by the
   * brief's design (§6c), and running them separately would measure two
   * different writes and make the comparison meaningless.
   */
  start(seq: SeqId, token = 'default'): void {
    const k = this.key(seq, token);
    if (this.open.has(k)) {
      throw new Error(`M7: ${k} started twice without a stop — a leaked mark would silence a figure`);
    }
    this.open.set(k, { seq, token, at: this.now() });
  }

  stop(seq: SeqId, token = 'default'): number {
    const k = this.key(seq, token);
    const mark = this.open.get(k);
    if (!mark) {
      throw new Error(`M7: ${k} stopped without a start`);
    }
    this.open.delete(k);
    const elapsed = this.now() - mark.at;

    const iteration = (this.iterations.get(seq) ?? 0) + 1;
    this.iterations.set(seq, iteration);

    // §6a: one warm-up pass is discarded, so each sequence runs 101 and reports 100.
    if (iteration <= WARMUP_PASSES) {
      push(this.warmup, seq, elapsed);
    } else {
      push(this.samples, seq, elapsed);
    }
    return elapsed;
  }

  /**
   * S2 moves focus 19 times per iteration. Reducing those to that iteration's
   * own p95 keeps n meaning what §6a says it means; letting all 19 through
   * would quietly redefine the sample as 1,900.
   * (M7-scripted-sequences.md §4b, the author's choice.)
   */
  reduceIteration(seq: SeqId, withinIterationMs: readonly number[]): void {
    if (withinIterationMs.length === 0) {
      throw new Error(`M7: ${seq} reduce called with no samples`);
    }
    const sorted = [...withinIterationMs].sort((a, b) => a - b);
    const rank = Math.ceil(0.95 * sorted.length);
    const value = sorted[rank - 1];

    const iteration = (this.iterations.get(seq) ?? 0) + 1;
    this.iterations.set(seq, iteration);
    if (iteration <= WARMUP_PASSES) {
      push(this.warmup, seq, value);
    } else {
      push(this.samples, seq, value);
    }
  }

  /** Nothing may still be open when a figure is read. */
  assertSettled(): void {
    if (this.open.size > 0) {
      throw new Error(`M7: ${[...this.open.keys()].join(', ')} left open — the figures below them are incomplete`);
    }
  }

  figure(seq: SeqId): Figure {
    const samplesMs = this.samples.get(seq) ?? [];
    const value = p95(samplesMs);
    return {
      seq,
      condition: CONDITION[seq],
      targetMs: TARGET_MS[seq],
      n: samplesMs.length,
      p95Ms: value,
      samplesMs: [...samplesMs],
      discardedWarmupMs: [...(this.warmup.get(seq) ?? [])],
      // null, not false, below the full sample: an unmeasured target is
      // "Not established", which is the gate-cell rule's third verdict —
      // never a fail.
      pass: value === null ? null : value < TARGET_MS[seq],
      context: this.context,
    };
  }

  /**
   * Condition 1 fails if ANY of its five figures exceeds its target —
   * SwR-100 carries "no qualifier" (brief §6b).
   */
  condition1(): { verdict: 'pass' | 'fail' | 'not-established'; figures: Figure[] } {
    const figures = (['S1', 'S2', 'S3', 'S4', 'S5'] as SeqId[]).map((s) => this.figure(s));
    if (figures.some((f) => f.pass === null)) {
      return { verdict: 'not-established', figures };
    }
    return { verdict: figures.every((f) => f.pass) ? 'pass' : 'fail', figures };
  }

  /** §6d's per-run record, minus the fields a human supplies. */
  record(): { context: RunContext; figures: Figure[] } {
    this.assertSettled();
    const seqs: SeqId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
    return {
      context: this.context,
      figures: seqs.map((s) => this.figure(s)).filter((f) => f.n > 0 || f.discardedWarmupMs.length > 0),
    };
  }
}

function push(m: Map<SeqId, number[]>, seq: SeqId, v: number): void {
  const a = m.get(seq);
  if (a) a.push(v);
  else m.set(seq, [v]);
}

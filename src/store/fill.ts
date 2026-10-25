/**
 * §3a's fill — the device state every condition-1 figure is supposed to be
 * taken in, and which no figure so far has been taken in.
 *
 * `SwR-100` measures *"over a worklist window of 7 days (`N-F1`) with the
 * device storage at **80 % of its budget**"*, and the brief is explicit that
 * this is **a data volume, not a measurement period** — *"nobody has to wait
 * seven days"*. `SwR-115` sets the budget at **2 GB**.
 *
 * ⚠ WHAT THE 80 % CONSISTS OF MATTERS, AND THE BRIEF SAYS WHY: *"a store full
 * of media and a store full of records cost different amounts for exactly the
 * form-open and list-open figures condition 1 measures"*. So the split is
 * **stated and reproducible**: the worklist, then **completed instances with
 * their answers and signatures until the record side is at about a quarter of
 * the budget**, then **media to reach 80 %** — and *"the split is recorded
 * with the figures"*.
 *
 * ➕ §3a labels the proportion as its own choice: *"a quarter records, the rest
 * media, is roughly what a worklist of photographed inspections looks like —
 * and what matters for comparability is that the split is **stated**, not that
 * it is this split."*
 */
import type { Job } from '../form/worklist.ts';

/**
 * ⚠ A READING, STATED RATHER THAN ASSUMED. `SwR-115` says **"2 GB"** and does
 * not say whether that is 2×10⁹ or 2×1024³ — a 7 % difference, which is more
 * than some of the margins this fill is meant to test. **The binary reading is
 * taken** because a device storage budget is what a phone's own settings screen
 * reports, and those are binary. *The alternative would make the fill 120 MB
 * smaller; since §3a asks only that the split be stated, this is stated.*
 */
export const BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

/** `SwR-100`: *"the device storage at 80 % of its budget"*. */
export const FILL_FRACTION = 0.8;

/** §3a: *"until the record side is at about a quarter of the budget"*. */
export const RECORD_FRACTION = 0.25;

export const TOTAL_TARGET_BYTES = Math.round(BUDGET_BYTES * FILL_FRACTION);
export const RECORD_TARGET_BYTES = Math.round(BUDGET_BYTES * RECORD_FRACTION);
export const MEDIA_TARGET_BYTES = TOTAL_TARGET_BYTES - RECORD_TARGET_BYTES;

/**
 * 🔴 THE FILL MUST NOT PRUNE ITSELF MID-RUN, which `SwR-115` would otherwise do
 * at exactly this level — it removes *"confirmed items beyond their retention
 * (`SwR-109`)… oldest first, automatically"*.
 *
 * `SwR-109` retains until **the later of** `N-F3`'s 30 days **and** a contact in
 * which the server confirms no re-offer is outstanding — and **the spike is
 * offline**, so the second limb cannot be satisfied. So the fill is built from
 * **unconfirmed** work, which `SwR-109` says *"are never removed by any
 * automatic process"*.
 *
 * ⚠ THE SPIKE IMPLEMENTS NO RETENTION, so nothing here enforces it; the flag
 * exists to make the record say the fill is of the kind that would survive.
 * *A fill built from already-cleared items past 30 days would delete itself
 * under the measurement — which is the trap, and it is avoided by construction
 * rather than by a rule the prototype applies.*
 */
export const UNCONFIRMED = true;

/**
 * What a completed instance contributes. ➕ Chosen so the record side is mostly
 * **many small answers plus one large signature**, which is the shape §3a names
 * — *"completed instances with their answers and signatures"*. ⚠ Twenty answers
 * matches the dense section's field count, so the fill's instances look like the
 * form the spike actually renders rather than like a synthetic row count.
 */
export const ANSWERS_PER_INSTANCE = 20;

/**
 * ➕ A signature's size is the author's estimate and is labelled as one: nothing
 * in the corpus sets it. 48 KiB is a plausible PNG of a signature pad at phone
 * resolution. *It only affects how many instances are needed to reach the
 * record target, not the target itself, because the builder measures the
 * database rather than predicting it.*
 */
export const SIGNATURE_BYTES = 48 * 1024;

export interface FillTargets {
  recordBytes: number;
  mediaBytes: number;
  totalBytes: number;
}

export const TARGETS: Readonly<FillTargets> = Object.freeze({
  recordBytes: RECORD_TARGET_BYTES,
  mediaBytes: MEDIA_TARGET_BYTES,
  totalBytes: TOTAL_TARGET_BYTES,
});

/**
 * What the device actually holds. 🔴 MEASURED, NEVER PREDICTED — the builder
 * fills until the database really is this big, because SQLite's storage
 * efficiency for a given row shape is not something to guess at, and a fill
 * that *computed* its size would be a fill nobody had checked.
 */
export interface FillState {
  recordBytes: number;
  mediaBytes: number;
  totalBytes: number;
  jobs: number;
  instances: number;
  answers: number;
  mediaFiles: number;
  /** false until BOTH sides have reached their targets */
  complete: boolean;
  /** §3a's rule, carried into the record rather than left in a comment */
  unconfirmedOnly: boolean;
}

export function fillState(
  parts: Omit<FillState, 'totalBytes' | 'complete' | 'unconfirmedOnly'>,
): FillState {
  const totalBytes = parts.recordBytes + parts.mediaBytes;
  return {
    ...parts,
    totalBytes,
    complete: parts.recordBytes >= RECORD_TARGET_BYTES && parts.mediaBytes >= MEDIA_TARGET_BYTES,
    unconfirmedOnly: UNCONFIRMED,
  };
}

/** How much more each side needs; never negative. */
export function remaining(state: FillState): { recordBytes: number; mediaBytes: number } {
  return {
    recordBytes: Math.max(0, RECORD_TARGET_BYTES - state.recordBytes),
    mediaBytes: Math.max(0, MEDIA_TARGET_BYTES - state.mediaBytes),
  };
}

/**
 * A short, honest description for `§6d`'s fill field.
 *
 * 🔴 IT IS DERIVED FROM MEASUREMENT, NOT TYPED. The fill has been a hand-typed
 * operator field until now, and on 2026-10-24 one record went out reading
 * *"none - **wmpty** store"*. A free-text condition that records cannot be
 * grouped by is barely a recorded condition at all.
 */
export function describeFill(state: FillState): string {
  if (state.totalBytes === 0) return 'none — empty store, no fill generated';
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(0) + ' MiB';
  return (
    (state.complete ? '§3a fill' : '§3a fill INCOMPLETE') +
    ' — ' +
    mb(state.recordBytes) +
    ' records (' +
    state.instances +
    ' instances, ' +
    state.answers +
    ' answers) + ' +
    mb(state.mediaBytes) +
    ' media (' +
    state.mediaFiles +
    ' files) = ' +
    mb(state.totalBytes) +
    ' of a ' +
    mb(BUDGET_BYTES) +
    ' budget, ' +
    state.jobs +
    ' jobs'
  );
}

/**
 * The answers of one completed instance, deterministically.
 *
 * ⚠ The values are TEXT of a plausible length rather than lorem filler of a
 * round number, so the database's page usage resembles real answers. ➕ The
 * signature is last and large, which is what makes an instance's footprint
 * lopsided in the way §3a describes.
 */
export function instanceRows(instance: number): Array<{ field: string; value: string }> {
  const rows: Array<{ field: string; value: string }> = [];
  for (let i = 1; i <= ANSWERS_PER_INSTANCE; i++) {
    // A deterministic, non-repeating body: repeated identical text would let
    // SQLite's page compression (where enabled) flatter the fill.
    const body = 'd' + i + '-' + ((instance * 2654435761 + i * 40503) % 1_000_000_007).toString(36);
    rows.push({ field: 'd' + i, value: body.padEnd(96, 'x' + (instance % 10)) });
  }
  rows.push({ field: 'signature', value: signatureBlob(instance) });
  return rows;
}

/**
 * A stand-in for a captured signature: a base64-ish blob of `SIGNATURE_BYTES`.
 *
 * ⚠ LABELLED AS A STAND-IN. The spike captures no signatures — `SwR-103` is not
 * in its scope — so this is a byte count in the right place, not a signature.
 * *What the measurement needs from it is its size and its presence in the
 * record side of the split; nothing reads its content.*
 */
export function signatureBlob(instance: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunk: string[] = [];
  let x = (instance + 1) * 2654435761;
  for (let i = 0; i < 1024; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    chunk.push(alphabet[x % 64]!);
  }
  const unit = chunk.join('');
  return unit.repeat(Math.ceil(SIGNATURE_BYTES / unit.length)).slice(0, SIGNATURE_BYTES);
}

/**
 * §3a's worklist: *"every job scheduled within 7 days ahead **plus every job
 * with an in-progress or returned instance regardless of date**"*.
 *
 * ⚠ THE SPIKE MODELS A JOB AND NOTHING ELSE. §3a also names sites, customers,
 * published form versions, catalogue, price rules, tax classes, lifecycle
 * versions and roles — and the spike's store has **one table**. Building those
 * would mean inventing a schema **ADR-003 has not decided**, and then measuring
 * the invention. *Recorded as a deviation rather than quietly satisfied: the
 * fill's record side reaches §3a's VOLUME, with a narrower SHAPE than §3a
 * describes.*
 */
export function worklistForFill(jobs: readonly Job[]): readonly Job[] {
  return jobs;
}

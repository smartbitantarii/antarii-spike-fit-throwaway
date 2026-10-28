/**
 * §8's record — as a shape that refuses to be incomplete.
 *
 * ⚠ WHY A SCHEMA AND NOT A PROSE TEMPLATE. The run plan's §8 lists what each
 * record must carry, and **four of those lines exist because a review found
 * them missing** — `M7` (the form's shape, and the labelled additions), `m3`
 * (storage at the start *and* end of each batch), `m6` (the stop event
 * condition 1's save figure was measured against), `M4` (axis 5 twice). A
 * prose template cannot enforce any of that; a validator can, and a figure
 * that reaches §8 without its context is not evidence.
 *
 * 🔴 THE DISCIPLINE THIS ENCODES: a missing field makes the record INVALID,
 * never silently absent. The gate-cell rule's third verdict is *Not
 * established*, and a record that quietly omitted the fill percentage would
 * present an unestablished figure as an established one.
 *
 * ➕ FIELDS THE BRIEF DOES NOT ASK FOR ARE MARKED AS SUCH. §6d is explicit
 * that it is not a requirement — *"this brief's own… nothing in it is a
 * requirement"* — and the run plan adds four things of its own and labels
 * them. That labelling is carried into the data, so nobody reading a record
 * later mistakes the plan's additions for the brief's demands.
 *
 * Imports only the harness. No platform: assembling and validating a record
 * is logic, and it is tested on a development machine.
 */
import type { Figure, RunContext, SeqId } from './harness.ts';

/** §6d: "platform and device (capability AND actual model)" — both, not one. */
export interface DeviceIdentity {
  platform: 'ios' | 'android';
  /** the capability SyR-210 states, e.g. "mid-tier Android, ~3y, ~4 GB" */
  capability: string;
  /** the actual handset, e.g. "Galaxy M04" */
  model: string;
  /**
   * ⚠ The plan's addition, labelled: the OS version. A build number is
   * preferred over a marketing name because it is self-checking — "Android
   * 16" identifies far less than `BP4A.251205.006.A356EXXSBDZH1`.
   */
  osVersion: string;
  /**
   * ⚠ Where this device sits against `SyR-210`'s stated baseline, and which
   * way. Recorded because the reading of a result depends on it: a pass on a
   * weaker device is conclusive, a failure on one proves nothing about the
   * baseline — the false-fail class this initiative caught four times.
   */
  deviation: 'at baseline' | 'weaker than baseline' | 'stronger than baseline';
}

/** §6d, in its own words: "sections, visible fields in the largest section, repeats grown to". */
export interface FormShape {
  sections: number;
  visibleFieldsInLargestSection: number;
  repeatsGrownTo: number;
}

/**
 * §6d's fill, plus `m3`'s correction. The percentage is recorded at the START
 * and END of each figure batch because **1.6 GB of a 2 GB budget leaves 400
 * MB**, and 100 photograph captures consume a measurable part of it — so the
 * store drifts off the 80 % state §6a requires *"throughout"* unless it is
 * re-trimmed and the drift is visible.
 */
export interface FillState {
  recordBytes: number;
  mediaBytes: number;
  /** of SwR-115's 2 GB budget (tenant-configurable), as measured */
  percentOfBudget: number;
}

export interface FigureBatch {
  /** the sequences measured in this batch, in the order they ran */
  sequences: SeqId[];
  fillAtStart: FillState;
  fillAtEnd: FillState;
  figures: Figure[];
  /** the campaign's own conditions, since M7 fixes none of them */
  conditions: { iterations: number; warmupDiscarded: number; settleMs: number };
}

export type FailureCause = 'framework' | 'prototype' | 'vendor';

/**
 * §7 rule 4, as corrected by `FN5`: a failure is attributed to **framework,
 * prototype — or, on axis 5 only, vendor** — "with the handset and its
 * battery setting named".
 */
export interface FailureAttribution {
  condition: number;
  figureOrLeg: string;
  measured: string;
  cause: FailureCause;
  handset: string;
  batterySetting: string;
  /** ⚠ `vendor` is permitted on axis 5 alone; anywhere else it is invalid. */
  axis5: boolean;
}

/** §5a and §6d: recorded as DECISIONS, explicitly not as measurements. */
export interface SpikeDecisions {
  /** D1 — the package by name and version */
  d1Package: string;
  /** D2 — the config-plugin path, or the plugin we wrote */
  d2ConfigPlugin: string;
  /** D3 — edition and licence VERBATIM from the licence file */
  d3LicenceVerbatim: string;
  d3Edition: 'community' | 'commercial';
  /** required when the edition is commercial, and only then */
  d3Price?: string;
}

export interface RunRecord {
  /** §6d: the date of the run */
  date: string;
  device: DeviceIdentity;
  formShape: FormShape;
  worklistVolume: number;
  offline: boolean;

  /** ➕ the plan's labelled additions */
  buildId: string;
  expoSdkVersion: string;
  reactNativeVersion: string;

  /**
   * §6a: "a scripted interaction sequence **whose steps are listed with the
   * record**" — the steps themselves, not a reference to them. Omitted from
   * the 2026-10-11 record list and restored on `M7`.
   */
  sequenceSteps: Record<string, string[]>;

  batches: FigureBatch[];

  /**
   * `m6`: beside condition 1's *saving an answer* figure, the stop event it
   * was measured against. Brief §6c stops that clock at *"durable in the
   * device store — the write committed, not queued"*, which is the strictest
   * available reading and is **not** what `SwR-100` states — so a fail
   * recorded there is a fail against a definition no requirement sets, and
   * the record must say so or the figure overstates what it found.
   */
  saveStopEvent: string;

  /**
   * `M4`: axis 5 appears TWICE — the step 3 gate result and the step 5a
   * result at the 80 % fill — "and a difference between them named as a
   * finding". One slot per condition was wrong.
   */
  axis5: { step3: string; step5aAt80Percent: string; differenceFinding: string | null };

  /** brief §3b: the client's size, one number, with and without the Wasm module */
  footprint: { withWasmBytes: number; withoutWasmBytes: number };

  decisions: SpikeDecisions;
  failures: FailureAttribution[];
}

/**
 * Everything wrong with a record, as a list — not the first problem found.
 *
 * ⚠ Returning every problem is deliberate: these records are assembled at a
 * bench, often on a phone, and a validator that reported one missing field at
 * a time would turn a five-minute correction into five trips.
 */
export function validateRecord(r: RunRecord): string[] {
  const problems: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) problems.push(msg);
  };

  need(!!r.date, '§6d: the run date is missing');
  need(!!r.device?.model, '§6d: the actual device model is missing');
  need(!!r.device?.capability, '§6d: the device CAPABILITY is missing — §6d asks for both, not the model alone');
  need(!!r.device?.osVersion, "the OS version is missing (the plan's labelled addition)");
  need(!!r.buildId, "the build identifier is missing (the plan's labelled addition)");
  need(!!r.expoSdkVersion && !!r.reactNativeVersion, "the Expo SDK / React Native versions are missing (the plan's labelled additions)");

  need(r.formShape?.sections > 0, "§6d: the form's shape needs its section count");
  need(
    r.formShape?.visibleFieldsInLargestSection > 0,
    "§6d: 'visible fields in the largest section' is missing — the form's shape is three numbers, not one",
  );
  need(r.formShape?.repeatsGrownTo > 0, "§6d: 'repeats grown to' is missing");
  need(Number.isFinite(r.worklistVolume), '§6d: the worklist volume is missing');

  need(
    !!r.sequenceSteps && Object.keys(r.sequenceSteps).length > 0,
    '§6a: the scripted sequence steps must be LISTED WITH the record, not referenced',
  );

  need(r.batches?.length > 0, 'no figure batches — a record with no figures is not a record');
  for (const [i, b] of (r.batches ?? []).entries()) {
    const at = 'batch ' + (i + 1) + ': ';
    need(!!b.fillAtStart && !!b.fillAtEnd, at + 'm3 requires the fill at the START AND END, not once');
    if (b.fillAtStart && b.fillAtEnd) {
      need(
        Number.isFinite(b.fillAtStart.percentOfBudget) && Number.isFinite(b.fillAtEnd.percentOfBudget),
        at + 'the fill percentage is missing at one end',
      );
    }
    need(b.figures?.length > 0, at + 'no figures');
    for (const f of b.figures ?? []) {
      // ⚠ Not an error. A null p95 is the gate-cell rule's *Not established*,
      // and a record is entitled to carry one — it must simply not be read
      // as a pass or a fail.
      need(Number.isFinite(f.n), at + f.seq + ": n is missing, and §6a's sample size is the point");
    }
  }

  need(!!r.saveStopEvent, "m6: the stop event condition 1's save figure was measured against is missing");
  need(!!r.axis5?.step3 && !!r.axis5?.step5aAt80Percent, 'M4: axis 5 is recorded TWICE — step 3 and step 5a at the 80% fill');
  need(
    Number.isFinite(r.footprint?.withWasmBytes) && Number.isFinite(r.footprint?.withoutWasmBytes),
    '§3b: the footprint is required with AND without the WebAssembly module',
  );

  need(!!r.decisions?.d1Package, 'D1: the package by name and version is missing');
  need(!!r.decisions?.d2ConfigPlugin, 'D2: the config-plugin path is missing');
  need(!!r.decisions?.d3LicenceVerbatim, 'D3: the licence must be recorded VERBATIM from the licence file');
  if (r.decisions?.d3Edition === 'commercial') {
    need(!!r.decisions.d3Price, 'D3: a commercial edition must record the price');
  }

  for (const f of r.failures ?? []) {
    need(!!f.handset && !!f.batterySetting, 'FN5: a failure names the handset AND its battery setting');
    // 🔴 `vendor` is axis 5's alone. Allowing it elsewhere would let any
    // failure be attributed away from the framework or the prototype, which
    // is precisely what §7 rule 4 exists to prevent.
    need(
      f.cause !== 'vendor' || f.axis5,
      "§7 rule 4: 'vendor' is permitted on axis 5 only — " + f.figureOrLeg,
    );
  }

  return problems;
}

/**
 * Stable JSON, key-sorted at every level so two records of one run compare
 * byte for byte.
 *
 * 🔴 NOT `JSON.stringify(r, Object.keys(r).sort(), 2)`. That form of the
 * second argument is an ALLOWLIST APPLIED AT EVERY LEVEL, not a sort order:
 * nested keys absent from the top-level list are dropped. The first version
 * of this function did exactly that and **silently emitted records missing
 * the device, the form shape and the figures** — the record validated,
 * because validation reads the object, and then serialised to a husk.
 *
 * ⚠ ARRAYS ARE NOT SORTED. `samplesMs` is a time series and `sequences` is
 * the order the sequences ran in; sorting either would destroy the meaning
 * while leaving the record looking well-formed.
 */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/**
 * Stable JSON for anything the device sends — a full record or a device
 * payload. ➕ Taking `unknown` rather than `RunRecord` because both travel the
 * same way and the alternative was a cast at the call site, which is where a
 * cast stops being a note and starts being a lie.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortDeep(value), null, 2);
}

export function serialiseRecord(r: RunRecord): string {
  return stableJson(r);
}

/**
 * Refuses to emit an invalid record.
 *
 * ⚠ The whole point of the validator is that it is not optional. A caller
 * that could serialise around it would eventually do so at a bench, at the
 * end of a long run, when the missing field looked unimportant.
 */
export function emitRecord(r: RunRecord): string {
  const problems = validateRecord(r);
  if (problems.length > 0) {
    throw new Error(
      'the run record is incomplete and will not be emitted:\n  - ' + problems.join('\n  - '),
    );
  }
  return serialiseRecord(r);
}

/** The device-supplied half, so a caller fills in only what a human knows. */
export function partialRecordFromHarness(
  context: RunContext,
  batches: FigureBatch[],
): Pick<RunRecord, 'date' | 'buildId' | 'offline' | 'batches'> {
  return {
    date: new Date().toISOString(),
    buildId: context.buildId,
    offline: context.offline,
    batches,
  };
}

/**
 * 🔴 WHAT THE DEVICE IS SENDING, STATED IN THE PAYLOAD ITSELF.
 *
 * The app marks S1, S3 and S6 during ORDINARY USE — opening the form, saving
 * an answer, re-evaluating. Those marks are real timings and they are **not a
 * measurement**: there is no warm-up discarded, no controlled fill, no
 * §6a sample, and the device was being poked by hand. A payload that did not
 * say so could be read later as figures, and **a p95 over incidental marks
 * would look exactly like a p95 over a campaign**.
 *
 * ➕ So the kind travels with the data rather than in someone's memory of how
 * it was produced. Whatever assembles §8's record can then refuse to treat
 * `incidental-marks` as figures, instead of trusting a filename or a note.
 */
export type DevicePayloadKind = 'campaign' | 'incidental-marks';

export interface DevicePayload {
  kind: DevicePayloadKind;
  /**
   * §6a: “a scripted interaction sequence whose steps are listed WITH the
   * record”. Empty for incidental marks, which follow no script — and that
   * emptiness is itself informative.
   */
  steps: Record<string, string[]>;
  /** why this kind, in words, so the record is self-explaining */
  kindNote: string;
  date: string;
  buildId: string;
  device: { model: string };
  offline: boolean;
  fill: string;
  figures: Figure[];
  /**
   * 🔴 THE COLD START — AND IT IS DELIBERATELY NOT A FIGURE.
   *
   * Opening the application was briefly instrumented as `S1`, which it is
   * not: **M7 §3 starts `S1` at the form-open tap FROM THE JOB LIST, with
   * the store already open** — a navigation, not a launch. A cold start
   * recorded under `S1`'s name would be compared against `S1`'s 300 ms
   * target, which binds a different thing entirely.
   *
   * ⚠ So it travels as its own observation with **no target and no
   * pass/fail**, because **`SwR-100` binds five interactions and launch is
   * not among them** — opening a form, moving between fields and saving an
   * answer under 300 ms, the job or form list under 1 second, and a
   * captured photograph. *Whether launch should be bound at all is an
   * open question for the owner; until it is answered, reporting a number
   * without a verdict is the only honest shape.*
   */
  coldStartMs: number | null;
  /**
   * ➕ A RUN CONDITION, RECORDED BECAUSE IT DETERMINES THE FIGURE. `S5`'s total
   * includes the wait for a location fix, so the deadline in force is part of
   * what the number means — and a reader seeing *“S5 p95 = 420 ms”* cannot
   * otherwise tell whether the deadline was 300 ms or 1000 ms. `buildId` is a
   * hand-typed label here, not a commit, so it does not resolve the question.
   *
   * ⚠ This exists because of the refresh-rate lesson: **S6 − S3 was read
   * against a frame time that was never recorded**, and the figure could not be
   * re-interpreted afterwards. *A condition that shapes a figure and is not
   * written down makes the figure un-rereadable.*
   */
  locationDeadlineMs: number | null;
  /**
   * 🔴 WHICH VARIANT PRODUCED THIS FIGURE — A RUN CONDITION THAT WAS VISIBLE
   * ONLY ON A SCREEN UNTIL NOW.
   *
   * `S2` has been run plain, with a blur before the collapse, with Android's
   * input services suppressed, and without the collapse at all. ⚠ **Every one
   * of those records was identical in the data** — same `seq`, same `device`,
   * same `fill` — and they were told apart by their timestamps and by the
   * author's memory of the order they were run in. *That is not evidence; it
   * is recollection standing next to evidence.*
   *
   * ➕ The same lesson as `locationDeadlineMs`, and before that the refresh
   * rate behind `S6 − S3`: **a condition that shapes a figure and is not
   * written down makes the figure un-rereadable.** The note travels with it so
   * the record explains itself, as `kindNote` does.
   */
  variant: { name: string; note: string } | null;
  /**
   * 🔴 §3a's FILL, MEASURED — WHICH §3a REQUIRES: *“the split is recorded with
   * the figures”*. The brief is explicit about why it has to be the split and
   * not a total: *“a store full of media and a store full of records cost
   * different amounts for exactly the form-open and list-open figures
   * condition 1 measures”*.
   *
   * ⚠ IT SITS BESIDE THE OPERATOR'S TYPED `fill`, NOT INSTEAD OF IT. The typed
   * field is §6d's *“the state held throughout”* in the operator's own words;
   * this one is the device's. **Where they disagree, this is the evidence** —
   * on 2026-10-24 a record went out reading *“none - wmpty store”*, and a
   * free-text condition that records cannot be grouped by is barely a recorded
   * condition at all.
   */
  fillState: FillStateRecord | null;
  /**
   * 🔴 WHAT OPENING THE STORE COST THIS LAUNCH, BY PHASE.
   *
   * `coldStartMs` has been the only launch number, and the claim that
   * *“`cipher_integrity_check` over a 512 MiB database costs ~3.1 s”* was read
   * off the DIFFERENCE between a filled device and an empty one — two whole
   * launches, each of which also loads a bundle and mounts React. ⚠ **That is
   * an attribution, not a measurement**, and `F-1` and `F-3` both rest on it.
   *
   * ➕ These are timers around the phases themselves, so the check's cost is
   * read directly and on ONE device in ONE state. `integrityChecked` says
   * whether the check ran, so a launch taken without it can never be mistaken
   * for one taken with it.
   */
  openTimings: OpenTimingsRecord | null;
  /**
   * 🔴 CONDITION 5 LEG (i)'s EVIDENCE — every mark the queue probe left behind.
   *
   * Leg (i) fails when *"the queue cannot be read or written in any state in
   * which `SwR-107` requires work to continue — foreground, background,
   * suspended, terminated, device locked"*. ⚠ **Four of those five states have
   * no screen to watch**, and in one of them the application does not exist, so
   * the evidence is written to a plain file as it happens and carried here on
   * the next delivery.
   *
   * ✕ These are **not a figure**. There is no number to meet: `SyR-076` says
   * background synchronisation continues *"within what the device platform
   * permits, **with no separate figure**"*. What they record is **which states
   * the platform permitted**, which is the whole of leg (i)'s question.
   */
  backgroundMarks: BackgroundMarkRecord[] | null;
  /**
   * 🔴 WHAT THE BACKGROUND INTEGRITY CHECK FOUND, AND WHAT IT COST THERE.
   *
   * ADR-003 §5.3.3a moved the check off the launch path, which **changes which
   * record field carries its cost**: `openTimings.integrityMs` is now 0 on an
   * ordinary launch, and this is where the figure lives instead.
   *
   * ⚠ **`durationMs` here is NOT comparable to the 3692 ms Android phase
   * figure.** That one was measured inside a cold open with nothing else
   * running; this one runs **while the UI is live**, so it competes for I/O
   * with whatever the worker is doing. *Same PRAGMA, different conditions —
   * and §5.3.3a's decision does not depend on the two matching.*
   */
  verify: VerifyOutcomeRecord | null;
}

/** Mirrors `src/store/store.ts`'s `VerifyOutcome`, so `report.ts` imports no store code. */
export interface VerifyOutcomeRecord {
  ok: boolean;
  durationMs: number;
  problems: number;
  error: string | null;
}

/** Mirrors `src/platform/expo-background.ts`'s `BackgroundMark`. */
export interface BackgroundMarkRecord {
  at: string;
  trigger: string;
  appState: string;
  storeOpened: boolean;
  storeError: string | null;
  queueRead: boolean;
  queueDepth: number | null;
  queueWritten: boolean;
  error: string | null;
}

/** Mirrors `src/store/store.ts`'s `OpenTimings`, so `report.ts` imports no store code. */
export interface OpenTimingsRecord {
  keyMs: number;
  integrityMs: number;
  schemaMs: number;
  totalMs: number;
  integrityChecked: boolean;
}

/** Mirrors `src/store/fill.ts`'s `FillState`, so `report.ts` imports no store code. */
export interface FillStateRecord {
  recordBytes: number;
  mediaBytes: number;
  totalBytes: number;
  jobs: number;
  instances: number;
  answers: number;
  mediaFiles: number;
  complete: boolean;
  unconfirmedOnly: boolean;
}

const KIND_NOTE: Readonly<Record<DevicePayloadKind, string>> = Object.freeze({
  campaign:
    'a driven campaign: §6a’s n per figure with the warm-up discarded. Eligible to become a §8 figure.',
  'incidental-marks':
    'NOT A MEASUREMENT — marks taken while the app was used by hand. No warm-up discarded, ' +
    'no controlled fill, no §6a sample. Must not be read as a figure.',
});

export function devicePayload(
  kind: DevicePayloadKind,
  context: RunContext,
  figures: Figure[],
  atIso: string = new Date().toISOString(),
  steps: Record<string, string[]> = {},
  coldStartMs: number | null = null,
  locationDeadlineMs: number | null = null,
  variant: { name: string; note: string } | null = null,
  fillStateRecord: FillStateRecord | null = null,
  openTimings: OpenTimingsRecord | null = null,
  backgroundMarks: BackgroundMarkRecord[] | null = null,
  verify: VerifyOutcomeRecord | null = null,
): DevicePayload {
  return {
    kind,
    kindNote: KIND_NOTE[kind],
    steps,
    date: atIso,
    buildId: context.buildId,
    device: { model: context.device },
    offline: context.offline,
    fill: context.fill,
    figures,
    coldStartMs,
    locationDeadlineMs,
    variant,
    fillState: fillStateRecord,
    openTimings,
    backgroundMarks,
    verify,
  };
}

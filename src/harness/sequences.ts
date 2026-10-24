/**
 * M7's eight sequences as data — their steps, and whether this prototype can
 * actually drive them.
 *
 * ⚠ THE STEPS ARE HERE BECAUSE §6a REQUIRES THEM IN THE RECORD: "a scripted
 * interaction sequence **whose steps are listed with the record**". A record
 * that pointed at a document instead would leave a reader unable to tell what
 * was actually performed — and the 2026-10-11 record list omitted them until
 * review finding `M7` put them back.
 *
 * 🔴 AND THE HONEST PART: NOT ALL EIGHT CAN BE DRIVEN YET. Three need screens
 * this prototype does not have, and two need work that is not built. Marking
 * that in data rather than discovering it at a bench is the point — **a
 * sequence driven by an approximation measures the approximation**, which is
 * the wrong-cause class this initiative has caught four times.
 */
import type { SeqId } from './harness.ts';

export interface SequenceSpec {
  id: SeqId;
  /** M7 §3's steps, in order, including the reset the sample depends on */
  steps: string[];
  /** can this prototype perform it faithfully today? */
  drivable: boolean;
  /** when it cannot, exactly what is missing — never a vague "not yet" */
  blockedBy?: string;
}

export const SEQUENCES: Readonly<Record<SeqId, SequenceSpec>> = Object.freeze({
  S1: {
    id: 'S1',
    steps: [
      'From the job list, with the §3a fill loaded.',
      'mark start → tap the job’s form entry.',
      'Wait until the first field is focusable. mark stop.',
      'Leave the form without saving; return to the list. (reset)',
    ],
    drivable: true,
  },
  S2: {
    id: 'S2',
    steps: [
      'Open the dense section — ~20 visible fields, the brief’s labelled density.',
      'Focus field 1.',
      'For k = 1…19: mark start → move focus to field k+1 → on accepting input, mark stop.',
      'Collapse the section. (reset)',
    ],
    drivable: false,
    blockedBy:
      'the dense section renders but nothing manages focus programmatically, and S2 measures ' +
      'focus latency. Timing a state update instead would measure the wrong thing.',
  },
  S3: {
    id: 'S3',
    steps: [
      'Open the form at a field that at least one rule depends on — required, or S6 measures nothing.',
      'mark start → set the value.',
      'mark stop S3 when the store reports the write committed.',
      'mark stop S6 when the next interaction is accepted — every dependent rule applied, input unblocked.',
      'Restore the prior value and let it settle. (reset)',
    ],
    drivable: true,
  },
  S4: {
    id: 'S4',
    steps: [
      'From a non-list screen, worklist at its loaded volume.',
      'mark start → navigate to the list.',
      'Wait until the first screenful is interactive. mark stop.',
      'Navigate away. (reset)',
    ],
    drivable: true,
  },
  S5: {
    id: 'S5',
    steps: [
      'Open a form section with a media field, store at the fill.',
      'mark start → the shutter returns an image (a fixed fixture image, not a live capture).',
      'Wait until the thumbnail is visible, after compression and stamping. mark stop.',
      'Delete the attachment; confirm the staging file is gone (ADR-003 §5.3.3). (reset)',
    ],
    drivable: true,
  },
  S6: {
    id: 'S6',
    steps: [
      'Driven by S3: the same start, a second stop.',
      'mark stop S6 when the next interaction is accepted — every dependent rule applied, input unblocked.',
    ],
    drivable: true,
  },
  S7: {
    id: 'S7',
    steps: [
      'mark start → the guard evaluation is requested.',
      'Wait for the verdict to return to the caller. mark stop.',
    ],
    drivable: false,
    blockedBy: 'the evaluator does not exist — ADR-005 spike territory, not built.',
  },
  S8: {
    id: 'S8',
    steps: [
      'mark start → the line resolution is requested.',
      'Wait until the resolution record is complete (SwR-019), not merely the price returned. mark stop.',
    ],
    drivable: false,
    blockedBy: 'the pricing resolver does not exist — ADR-005 spike territory, not built.',
  },
});

/**
 * ✅ S1 and S4 became drivable once the worklist existed (2026-10-23). Both
 * are NAVIGATIONS — M7 starts S1 "from the job list" with the store already
 * open, and S4 "from a non-list screen" — so neither could be performed at
 * all while there was nowhere to navigate between. ➕ *That absence is also
 * what let a cold start be instrumented under S1's name.*
 */

/**
 * ⚠ S3 AND S6 SHARE ONE START, which is M7's design and not an optimisation:
 * §3 lists them as a single section with one `mark start` and two stops, so
 * driving them separately would measure two different value-sets and make the
 * pair incomparable. A campaign on S3 therefore produces S6's figure too.
 */
export const SHARES_START_WITH: Partial<Record<SeqId, SeqId>> = Object.freeze({
  S6: 'S3',
});

export function drivableSequences(): SeqId[] {
  return (Object.keys(SEQUENCES) as SeqId[]).filter((s) => SEQUENCES[s].drivable);
}

/** What §6a wants in the record: the steps of what was actually run. */
export function stepsForRecord(ids: readonly SeqId[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of ids) out[id] = [...SEQUENCES[id].steps];
  return out;
}

/**
 * Why a figure is absent, in the record's own words.
 *
 * 🔴 An absent figure and an unmeasurable one are NOT the same thing, and the
 * gate-cell rule's *Not established* covers both — so the record has to say
 * which. "No figure because nothing drove it" and "no figure because the
 * prototype cannot drive it faithfully" lead to different next actions.
 */
export function whyNotDrivable(id: SeqId): string | null {
  return SEQUENCES[id].drivable ? null : (SEQUENCES[id].blockedBy ?? 'not stated');
}

/**
 * Build 1 — the spike form's model.
 *
 * Shape is brief §3a's: SwR-082's collapsible sections with one expanded at a
 * time, a dense section of ~20 visible fields, and a repeating section grown
 * to many repeats, one level only (SwR-080).
 *
 * Strip-only TypeScript throughout: no enums, no parameter properties, no
 * decorators — so any toolchain on either device can run it.
 */

export type FieldId = string;

/** The eight of SwR-049's twenty-one types the spike form uses (M3's size). */
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'single-select'
  | 'multi-select'
  | 'checkbox'
  | 'media'
  | 'check-item';

/**
 * 🔴 THE FIELD TYPES THAT CAN TAKE INPUT FOCUS — WHICH IS NOT ALL OF THEM,
 * AND THAT IS WHAT MAKES `S2` A DEVIATION FROM ITS BRIEF.
 *
 * M7 §3's `S2` starts when *“focus leaves field k”* and stops when *“field k+1
 * accepts input”*, and specifies **19 moves** across the dense section's twenty
 * fields. ⚠ But the dense section deliberately cycles **eight** types, and only
 * `text` and `number` render a `TextInput`. The other six render `Pressable`s,
 * which have no input focus to move. *The form is not wrong — its mix was chosen
 * because “twenty of one widget would measure the cheapest case and call it the
 * density figure”. The brief and the form simply disagree about what a dense
 * section contains.*
 *
 * ✕ THE ALTERNATIVES WERE REJECTED, EACH FOR A STATED REASON.
 * `AccessibilityInfo.setAccessibilityFocus` moves the SCREEN-READER cursor, so
 * timing it would measure TalkBack rather than the form · inventing an “active
 * control” state of our own would measure our own invention · making the dense
 * section twenty text boxes would make `S2` pass easily and destroy what the
 * density condition is for.
 *
 * ➕ AND THE DEVIATION COSTS NOTHING IN THE FIGURE, WHICH IS WHY IT IS THE HONEST
 * CHOICE RATHER THAN MERELY THE AVAILABLE ONE. §4b reduces an iteration by its
 * **own p95**, and nearest-rank p95 over 19 samples is rank 19 — **the maximum**.
 * So counting fourteen non-moves as instantaneous would yield **the same number**
 * while claiming to have measured fourteen things it did not.
 *
 * *(**Decision — owner**, 2026-10-24: measure the real transitions, record the
 * deviation.)*
 *
 * ⚠ This list and `widgets.tsx` carry the same fact and can drift, so a test
 * reads the widget source rather than trusting a convention — the same treatment
 * `build.test.ts` gives `app.json` and `build.ts`.
 */
export const FOCUSABLE_FIELD_TYPES: readonly FieldType[] = ['text', 'number'];

export interface FieldDef {
  id: FieldId;
  type: FieldType;
  label: string;
  /** section this field belongs to */
  section: string;
  /** SwR-080: a field inside a repeating section, one level only */
  repeating?: boolean;
}

/**
 * A rule's effect. SwR-066 names exactly these outcomes:
 * "the resulting show / hide / require / validity / value changes applied".
 */
export type Effect =
  | { kind: 'show'; target: FieldId }
  | { kind: 'hide'; target: FieldId }
  | { kind: 'require'; target: FieldId }
  | { kind: 'optional'; target: FieldId }
  | { kind: 'invalid'; target: FieldId; message: string }
  | { kind: 'value'; target: FieldId; compute: (a: Answers) => Value };

export interface RuleDef {
  id: string;
  /** fields this rule reads — the edges of the dependency graph */
  reads: FieldId[];
  /** evaluated against current answers; true means the effects apply */
  when: (a: Answers) => boolean;
  effects: Effect[];
}

export interface SectionDef {
  id: string;
  label: string;
  /** SwR-082: collapsible, and the form keeps one expanded at a time */
  collapsible: boolean;
  /** SwR-080: a repeating section, one level only */
  repeating?: boolean;
}

export interface FormDef {
  id: string;
  version: string;
  sections: SectionDef[];
  fields: FieldDef[];
  rules: RuleDef[];
}

export type Value = string | number | boolean | null | string[];
export type Answers = Readonly<Record<FieldId, Value>>;

/** What re-evaluation produces, and what the UI applies. */
export interface FieldState {
  visible: boolean;
  required: boolean;
  valid: boolean;
  message: string | null;
}

export type FormState = Readonly<Record<FieldId, FieldState>>;

export function defaultState(form: FormDef): FormState {
  const s: Record<FieldId, FieldState> = {};
  for (const f of form.fields) {
    s[f.id] = { visible: true, required: false, valid: true, message: null };
  }
  return s;
}

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

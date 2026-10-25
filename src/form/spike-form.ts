/**
 * §3a's form shape — the one thing every figure is measured against.
 *
 * Brief §3a / run plan §4, item 1:
 *   SwR-082's collapsible sections, one expanded at a time · a DENSE SECTION
 *   OF ~20 VISIBLE FIELDS (the brief's labelled density) · a REPEATING
 *   SECTION grown to many repeats, ONE LEVEL ONLY (SwR-080) · SwR-066's
 *   re-evaluation on every answer change.
 *
 * M3's size: "the form uses EIGHT of the palette's twenty-one types, so this
 * is sixteen widget presentations rather than forty-two". The eight are
 * enumerated here, and spike-form.test.ts asserts the shape rather than
 * trusting it.
 */
import { FOCUSABLE_FIELD_TYPES } from './model.ts';
import type { FieldDef, FieldId, FieldType, FormDef, RuleDef, SectionDef } from './model.ts';

export const DENSE_FIELD_COUNT = 20;

/** The eight of SwR-049's twenty-one types the spike exercises (M3). */
export const USED_TYPES: readonly FieldType[] = [
  'text',
  'number',
  'date',
  'single-select',
  'multi-select',
  'checkbox',
  'media',
  'check-item',
];

/**
 * The dense section's fields that can take focus, in the order they render —
 * `S2`'s subjects. ➕ Derived from the form rather than listed, so changing
 * `DENSE_FIELD_COUNT` or `USED_TYPES` moves `S2` with it instead of silently
 * leaving it measuring the wrong fields.
 */
export function denseFocusOrder(f: FormDef = spikeForm): FieldId[] {
  return f.fields
    .filter((x) => x.section === 'dense' && FOCUSABLE_FIELD_TYPES.includes(x.type))
    .map((x) => x.id);
}

/**
 * The consecutive pairs `S2` times: `[from, to]`.
 *
 * ⚠ THE PAIRS ARE NOT ALL ADJACENT ON SCREEN, and that is recorded rather than
 * smoothed over. With eight types cycling across twenty fields the focusable
 * ones are `d1, d2, d9, d10, d17, d18`, so `d2 → d9` steps over six
 * non-focusable controls — a real move a worker makes, and one that may have to
 * scroll. *A figure that silently averaged a scroll with a neighbour-hop would
 * hide the thing most likely to cost.*
 */
export function denseFocusTransitions(f: FormDef = spikeForm): Array<[FieldId, FieldId]> {
  const order = denseFocusOrder(f);
  const pairs: Array<[FieldId, FieldId]> = [];
  for (let i = 0; i + 1 < order.length; i++) {
    pairs.push([order[i]!, order[i + 1]!]);
  }
  return pairs;
}

const sections: SectionDef[] = [
  { id: 'dense', label: 'Inspection detail', collapsible: true },
  { id: 'repeats', label: 'Items found', collapsible: true, repeating: true },
  { id: 'media', label: 'Evidence', collapsible: true },
];

/**
 * The dense section cycles the eight types so density is measured against a
 * realistic mix rather than twenty text boxes — twenty of one widget would
 * measure the cheapest case and call it the density figure.
 */
const dense: FieldDef[] = Array.from({ length: DENSE_FIELD_COUNT }, (_, i) => ({
  id: `d${i + 1}`,
  type: USED_TYPES[i % USED_TYPES.length]!,
  label: `Detail ${i + 1}`,
  section: 'dense',
}));

/** SwR-080: one level only. A nested repeat is out of scope by requirement. */
const repeats: FieldDef[] = [
  { id: 'item.desc', type: 'text', label: 'Description', section: 'repeats', repeating: true },
  { id: 'item.qty', type: 'number', label: 'Quantity', section: 'repeats', repeating: true },
  { id: 'item.total', type: 'number', label: 'Line total', section: 'repeats', repeating: true },
];

const media: FieldDef[] = [
  { id: 'photo', type: 'media', label: 'Photograph', section: 'media' },
  { id: 'defect', type: 'check-item', label: 'Defect present', section: 'media' },
  { id: 'explanation', type: 'text', label: 'Explanation', section: 'media' },
];

/**
 * Rules chosen so S6 measures something real:
 *  - one DIRECT dependency, and
 *  - one THROUGH A CALCULATION, which is the half of SwR-066 a naive
 *    implementation gets wrong.
 */
const rules: RuleDef[] = [
  {
    // direct: a failed check item requires an explanation
    id: 'defect-requires-explanation',
    reads: ['defect'],
    when: (a) => a.defect === 'fail',
    effects: [{ kind: 'require', target: 'explanation' }],
  },
  {
    // calculation: a line total derived from quantity
    id: 'line-total',
    reads: ['item.qty'],
    when: (a) => typeof a['item.qty'] === 'number',
    effects: [
      {
        kind: 'value',
        target: 'item.total',
        compute: (a) => (a['item.qty'] as number) * 25,
      },
    ],
  },
  {
    // reads the CALCULATED value — the transitive half of SwR-066
    id: 'large-total-needs-photo',
    reads: ['item.total'],
    when: (a) => typeof a['item.total'] === 'number' && (a['item.total'] as number) > 200,
    effects: [{ kind: 'require', target: 'photo' }],
  },
  {
    // a validity effect, so S6 exercises more than show/require
    id: 'quantity-range',
    reads: ['item.qty'],
    when: (a) => typeof a['item.qty'] === 'number' && (a['item.qty'] as number) > 99,
    effects: [{ kind: 'invalid', target: 'item.qty', message: 'Out of range' }],
  },
];

export const spikeForm: FormDef = {
  id: 'spike-form',
  version: '1',
  sections,
  fields: [...dense, ...repeats, ...media],
  rules,
};

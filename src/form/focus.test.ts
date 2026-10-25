/**
 * `S2`'s subjects: which fields can take focus, and which pairs it times.
 *
 * Run: node --test src/form/focus.test.ts
 *
 * ⚠ `FOCUSABLE_FIELD_TYPES` and `widgets.tsx` carry the SAME FACT in two files,
 * so they can drift — and a drift here is invisible at the bench, because `S2`
 * would still produce a plausible p95 over whatever fields happened to register.
 * `build.test.ts` treats `app.json` and `build.ts` the same way, for the same
 * reason: *"the project has already been bitten three times by a Status field
 * disagreeing with a Version field two lines below it"*.
 *
 * ➕ So this reads the widget source rather than trusting a convention. It
 * cannot IMPORT `widgets.tsx` — that pulls in React Native, which does not run
 * on a development machine, which is exactly why the two files were allowed to
 * disagree in the first place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FOCUSABLE_FIELD_TYPES } from './model.ts';
import { spikeForm, denseFocusOrder, denseFocusTransitions } from './spike-form.ts';
import { DENSE_FIELD_COUNT, USED_TYPES } from './spike-form.ts';

/** The `case '<type>':` labels in `widgets.tsx` whose branch renders a `TextInput`. */
function typesRenderingATextInput(): string[] {
  const src = readFileSync(new URL('../ui/widgets.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('switch (field.type)'));

  const found: string[] = [];
  // Cases can stack (`case 'checkbox':` immediately above `case 'check-item':`),
  // so labels are collected until a branch body is seen, then attributed together.
  let pending: string[] = [];
  for (const line of body.split('\n')) {
    const label = /^\s*case '([^']+)':\s*\{?\s*$/.exec(line);
    if (label) {
      pending.push(label[1]!);
      continue;
    }
    if (/^\s*case /.test(line)) continue;
    if (line.includes('<TextInput')) {
      found.push(...pending);
      pending = [];
      continue;
    }
    // A `return (` begins a branch body; once one is under way without a
    // TextInput on the first lines, the pending labels belong to it anyway.
    if (/^\s*return\b/.test(line) && pending.length > 0) {
      // keep `pending` until the branch is resolved by the lines that follow
      continue;
    }
    if (/^\s*case |^\s*\}/.test(line) && pending.length > 0 && /^\s*\}/.test(line)) {
      pending = [];
    }
  }
  return [...new Set(found)].sort();
}

test('FOCUSABLE_FIELD_TYPES names exactly the types that render a TextInput', () => {
  assert.deepEqual(
    typesRenderingATextInput(),
    [...FOCUSABLE_FIELD_TYPES].sort(),
    'model.ts and widgets.tsx disagree about which fields can take focus — ' +
      'S2 would measure a different set of transitions than it claims to',
  );
});

test('the dense section really does contain non-focusable fields', () => {
  // 🔴 THIS IS THE DEVIATION, ASSERTED RATHER THAN DESCRIBED. If the dense
  // section ever became all text boxes, S2 would match M7 §3 exactly and this
  // test should fail so the deviation note is removed rather than left lying.
  const dense = spikeForm.fields.filter((f) => f.section === 'dense');
  assert.equal(dense.length, DENSE_FIELD_COUNT);
  const focusable = denseFocusOrder();
  assert.ok(
    focusable.length < dense.length,
    'the dense section is now entirely focusable — S2 no longer deviates from M7 §3, ' +
      'and sequences.ts still says it does',
  );
});

test('S2 times the consecutive focusable pairs, in render order', () => {
  const order = denseFocusOrder();
  const pairs = denseFocusTransitions();

  assert.equal(pairs.length, order.length - 1, 'n transitions for n+1 fields');
  pairs.forEach(([from, to], i) => {
    assert.equal(from, order[i]);
    assert.equal(to, order[i + 1]);
  });

  // ⚠ Not all pairs are adjacent on screen, and that is deliberate: with eight
  // types cycling, `d2 → d9` steps over six non-focusable controls and may have
  // to scroll. A figure that hid that would hide the costliest move.
  const ids = order.map((id) => Number(id.slice(1)));
  assert.ok(
    ids.some((n, i) => i > 0 && n - ids[i - 1]! > 1),
    'every focusable field is adjacent — the "steps over" reasoning in spike-form.ts is stale',
  );
});

test('the focus order follows from the form, not from a hand-written list', () => {
  // Changing the type cycle must move S2 with it. This is the property that
  // keeps `denseFocusOrder` honest when `USED_TYPES` is edited.
  const expected = Array.from({ length: DENSE_FIELD_COUNT }, (_, i) => ({
    id: `d${i + 1}`,
    type: USED_TYPES[i % USED_TYPES.length]!,
  }))
    .filter((f) => FOCUSABLE_FIELD_TYPES.includes(f.type))
    .map((f) => f.id);

  assert.deepEqual(denseFocusOrder(), expected);
});

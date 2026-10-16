/**
 * The form's shape is asserted, not trusted: every figure is measured
 * against it, so a form that quietly drifted from §3a would make all five of
 * condition 1's figures measure the wrong thing.
 *
 * Run: node --test src/form/spike-form.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spikeForm, DENSE_FIELD_COUNT, USED_TYPES } from './spike-form.ts';
import { evaluate, plan, danglingReferences } from './evaluate.ts';

test('§3a: the dense section carries ~20 visible fields', () => {
  const dense = spikeForm.fields.filter((f) => f.section === 'dense');
  assert.equal(dense.length, DENSE_FIELD_COUNT);
  assert.equal(DENSE_FIELD_COUNT, 20, "the brief's labelled density");
});

test('M3: eight of the palette\'s twenty-one types, and the dense section uses all eight', () => {
  assert.equal(USED_TYPES.length, 8);
  const inDense = new Set(spikeForm.fields.filter((f) => f.section === 'dense').map((f) => f.type));
  assert.equal(inDense.size, 8, 'twenty of one widget would measure the cheapest case');
});

test('SwR-080: the repeating section is one level only', () => {
  const repeating = spikeForm.sections.filter((s) => s.repeating);
  assert.equal(repeating.length, 1, 'one repeating section');
  const nested = spikeForm.fields.filter((f) => f.repeating && f.section !== repeating[0]!.id);
  assert.equal(nested.length, 0, 'no repeating field outside it — a nested repeat is out of scope by requirement');
});

test('SwR-082: every section is collapsible, so one-expanded-at-a-time is possible', () => {
  assert.ok(spikeForm.sections.every((s) => s.collapsible));
  assert.ok(spikeForm.sections.length >= 2, 'one section cannot demonstrate one-at-a-time');
});

test('the form has no dangling references, which SwR-045 would refuse at publish', () => {
  assert.deepEqual(danglingReferences(spikeForm), []);
});

test('the rules give S6 something real: a direct dependency AND one through a calculation', () => {
  const order = plan(spikeForm);

  // direct
  const direct = evaluate(spikeForm, { defect: 'fail' }, order);
  assert.equal(direct.state.explanation.required, true);

  // through a calculation: qty 9 -> total 225 -> photo required
  const calc = evaluate(spikeForm, { 'item.qty': 9 }, order);
  assert.equal(calc.answers['item.total'], 225);
  assert.equal(calc.state.photo.required, true, 'the transitive half of SwR-066, in one pass');

  // and below the threshold it must not fire
  const small = evaluate(spikeForm, { 'item.qty': 2 }, order);
  assert.equal(small.answers['item.total'], 50);
  assert.equal(small.state.photo.required, false);
});

test('a validity effect fires too, so S6 is not only show/require', () => {
  const r = evaluate(spikeForm, { 'item.qty': 150 }, plan(spikeForm));
  assert.equal(r.state['item.qty'].valid, false);
  assert.equal(r.state['item.qty'].message, 'Out of range');
});

test('the form plans without a cycle', () => {
  assert.doesNotThrow(() => plan(spikeForm));
});

/**
 * Tests for SwR-066's re-evaluation. Conditions 2 and 6 measure this, so a
 * wrong answer here would be measured precisely and still be wrong.
 *
 * Run: node --test src/form/evaluate.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, plan, danglingReferences, DependencyCycleError } from './evaluate.ts';
import type { FormDef } from './model.ts';

function form(partial: Partial<FormDef>): FormDef {
  return {
    id: 'spike',
    version: '1',
    sections: [{ id: 'main', label: 'Main', collapsible: true }],
    fields: [],
    rules: [],
    ...partial,
  };
}

const f = (id: string) => ({ id, type: 'text' as const, label: id, section: 'main' });
const n = (id: string) => ({ id, type: 'number' as const, label: id, section: 'main' });

test('a direct dependency is re-evaluated and its effect applied', () => {
  const def = form({
    fields: [f('reading'), f('explanation')],
    rules: [{
      id: 'r1',
      reads: ['reading'],
      when: (a) => a.reading === 'fail',
      effects: [{ kind: 'require', target: 'explanation' }],
    }],
  });
  assert.equal(evaluate(def, { reading: 'ok' }).state.explanation.required, false);
  assert.equal(evaluate(def, { reading: 'fail' }).state.explanation.required, true);
});

test('"or through a calculation": the closure is transitive, in one pass', () => {
  // qty -> total (value) -> r2 reads total -> requires approval
  const def = form({
    fields: [n('qty'), n('total'), f('approval')],
    rules: [
      {
        id: 'calc-total',
        reads: ['qty'],
        when: () => true,
        effects: [{ kind: 'value', target: 'total', compute: (a) => (a.qty as number) * 10 }],
      },
      {
        id: 'needs-approval',
        reads: ['total'],
        when: (a) => (a.total as number) > 50,
        effects: [{ kind: 'require', target: 'approval' }],
      },
    ],
  });

  const low = evaluate(def, { qty: 2, total: 0, approval: null });
  assert.equal(low.answers.total, 20);
  assert.equal(low.state.approval.required, false, 'total 20 must not require approval');

  const high = evaluate(def, { qty: 9, total: 0, approval: null });
  assert.equal(high.answers.total, 90);
  assert.equal(
    high.state.approval.required,
    true,
    'the rule reading a CALCULATED value must see it in the same pass — SwR-066 says "or through a calculation"',
  );
});

test('the plan orders writers before readers regardless of declaration order', () => {
  const def = form({
    fields: [n('a'), n('b'), n('c')],
    rules: [
      // declared reader-first on purpose
      { id: 'reads-c', reads: ['c'], when: () => true, effects: [{ kind: 'require', target: 'a' }] },
      { id: 'writes-c', reads: ['b'], when: () => true, effects: [{ kind: 'value', target: 'c', compute: () => 7 }] },
    ],
  });
  const order = plan(def);
  assert.ok(order.indexOf('writes-c') < order.indexOf('reads-c'), 'writer must precede reader');
});

test('SwR-065: a dependency cycle is an error, not a hang', () => {
  const def = form({
    fields: [n('x'), n('y')],
    rules: [
      { id: 'x-from-y', reads: ['y'], when: () => true, effects: [{ kind: 'value', target: 'x', compute: () => 1 }] },
      { id: 'y-from-x', reads: ['x'], when: () => true, effects: [{ kind: 'value', target: 'y', compute: () => 1 }] },
    ],
  });
  assert.throws(() => plan(def), DependencyCycleError);
});

test('every effect kind SwR-066 names is applied', () => {
  const def = form({
    fields: [f('trigger'), f('t1'), f('t2'), f('t3'), f('t4'), n('t5')],
    rules: [{
      id: 'all',
      reads: ['trigger'],
      when: () => true,
      effects: [
        { kind: 'hide', target: 't1' },
        { kind: 'show', target: 't2' },
        { kind: 'require', target: 't3' },
        { kind: 'invalid', target: 't4', message: 'out of range' },
        { kind: 'value', target: 't5', compute: () => 42 },
      ],
    }],
  });
  const r = evaluate(def, { trigger: 'go' });
  assert.equal(r.state.t1.visible, false);
  assert.equal(r.state.t2.visible, true);
  assert.equal(r.state.t3.required, true);
  assert.equal(r.state.t4.valid, false);
  assert.equal(r.state.t4.message, 'out of range');
  assert.equal(r.answers.t5, 42);
});

test('evaluation is pure, so state is swapped in once rather than streamed', () => {
  const def = form({
    fields: [f('a'), f('b')],
    rules: [{ id: 'r', reads: ['a'], when: () => true, effects: [{ kind: 'hide', target: 'b' }] }],
  });
  const answers = Object.freeze({ a: 'x' });
  const first = evaluate(def, answers);
  const second = evaluate(def, answers);
  assert.deepEqual(first.state, second.state, 'same input, same settled result');
  assert.deepEqual(answers, { a: 'x' }, 'the caller\'s answers must not be mutated');
});

test('a rule naming a removed field does not crash at runtime', () => {
  // SwR-045 makes this a publish-time error; the engine must still not throw
  const def = form({
    fields: [f('kept')],
    rules: [{ id: 'r', reads: ['kept'], when: () => true, effects: [{ kind: 'hide', target: 'gone' }] }],
  });
  assert.doesNotThrow(() => evaluate(def, { kept: 'v' }));
  assert.deepEqual(danglingReferences(def), ['r targets unknown field gone']);
});

test('danglingReferences reports every problem at once, for the designer', () => {
  const def = form({
    fields: [f('kept')],
    rules: [{ id: 'r', reads: ['missing'], when: () => true, effects: [{ kind: 'hide', target: 'alsoMissing' }] }],
  });
  assert.equal(danglingReferences(def).length, 2);
});

test('the fired list and evaluated count are reported, for a challenged figure', () => {
  const def = form({
    fields: [f('a'), f('b'), f('c')],
    rules: [
      { id: 'yes', reads: ['a'], when: () => true, effects: [{ kind: 'require', target: 'b' }] },
      { id: 'no', reads: ['a'], when: () => false, effects: [{ kind: 'require', target: 'c' }] },
    ],
  });
  const r = evaluate(def, { a: '1' });
  assert.deepEqual(r.fired, ['yes']);
  assert.equal(r.evaluated, 2, 'both rules evaluated; one fired');
});

/**
 * SwR-066's re-evaluation — the thing conditions 2 and 6 measure.
 *
 * The requirement, verbatim from SRS v1.4:
 *
 *   "On every change to an answer, all rules that depend on it, directly or
 *    through a calculation, shall be re-evaluated before the next interaction
 *    is accepted, and the resulting show / hide / require / validity / value
 *    changes applied — within the SyR-088 field-interaction target (under
 *    300 ms) on each supported platform's baseline device, offline included"
 *
 * Three obligations follow, and each is tested:
 *   (a) "all rules that depend on it, DIRECTLY OR THROUGH A CALCULATION" —
 *       the closure is transitive, because a value effect changes an answer
 *       which other rules read.
 *   (b) "BEFORE the next interaction is accepted" — one settled result, not a
 *       stream of partial ones. Hence a single pure call.
 *   (c) SwR-065 — a dependency cycle is an error, not a hang.
 */

import type { Answers, FieldId, FormDef, FormState, Value } from './model.ts';
import { defaultState } from './model.ts';

export class DependencyCycleError extends Error {
  readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`SwR-065: dependency cycle through ${cycle.join(' -> ')}`);
    this.name = 'DependencyCycleError';
    this.cycle = cycle;
  }
}

/** rule id -> rule ids that must be evaluated after it, because it writes what they read */
function buildGraph(form: FormDef): Map<string, Set<string>> {
  const writers = new Map<FieldId, string[]>();
  for (const r of form.rules) {
    for (const e of r.effects) {
      if (e.kind === 'value') {
        const a = writers.get(e.target);
        if (a) a.push(r.id);
        else writers.set(e.target, [r.id]);
      }
    }
  }
  const edges = new Map<string, Set<string>>();
  for (const r of form.rules) edges.set(r.id, new Set());
  for (const r of form.rules) {
    for (const read of r.reads) {
      for (const w of writers.get(read) ?? []) {
        if (w !== r.id) edges.get(w)!.add(r.id); // writer before reader
      }
    }
  }
  return edges;
}

/**
 * Evaluation order, computed once per form definition rather than per
 * keystroke: the graph depends on the definition, not on the answers, and
 * SwR-043 makes a published version an immutable snapshot. Doing it per
 * change would put graph construction inside the 300 ms budget for nothing.
 */
export function plan(form: FormDef): string[] {
  const edges = buildGraph(form);
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on stack, 2 done
  const order: string[] = [];
  const stack: string[] = [];

  function visit(id: string): void {
    const st = state.get(id) ?? 0;
    if (st === 2) return;
    if (st === 1) {
      const from = stack.indexOf(id);
      throw new DependencyCycleError([...stack.slice(from), id]);
    }
    state.set(id, 1);
    stack.push(id);
    for (const next of edges.get(id) ?? []) visit(next);
    stack.pop();
    state.set(id, 2);
    order.push(id);
  }

  for (const r of form.rules) visit(r.id);
  return order.reverse(); // writers first
}

export interface EvaluationResult {
  answers: Answers;
  state: FormState;
  /** rules whose `when` was true this pass — useful when a figure is challenged */
  fired: string[];
  /** how many rules were evaluated; the harness records it beside the figure */
  evaluated: number;
}

/**
 * One settled re-evaluation. Pure: the caller swaps state in once, which is
 * what "before the next interaction is accepted" requires — a partially
 * applied form would accept input against a state no rule had finished with.
 */
export function evaluate(
  form: FormDef,
  answers: Answers,
  order: readonly string[] = plan(form),
): EvaluationResult {
  const byId = new Map(form.rules.map((r) => [r.id, r]));
  const nextAnswers: Record<FieldId, Value> = { ...answers };
  const state: Record<FieldId, { visible: boolean; required: boolean; valid: boolean; message: string | null }> = {};
  for (const [k, v] of Object.entries(defaultState(form))) state[k] = { ...v };

  const fired: string[] = [];
  let evaluated = 0;

  for (const id of order) {
    const rule = byId.get(id);
    if (!rule) continue;
    evaluated++;
    if (!rule.when(nextAnswers)) continue;
    fired.push(id);
    for (const e of rule.effects) {
      const s = state[e.target];
      if (!s) continue; // a rule naming a removed field: SwR-045's publish-time error, not a runtime crash
      switch (e.kind) {
        case 'show':
          s.visible = true;
          break;
        case 'hide':
          s.visible = false;
          break;
        case 'require':
          s.required = true;
          break;
        case 'optional':
          s.required = false;
          break;
        case 'invalid':
          s.valid = false;
          s.message = e.message;
          break;
        case 'value':
          // a value effect changes an answer, which later rules read —
          // this is the "or through a calculation" half of SwR-066
          nextAnswers[e.target] = e.compute(nextAnswers);
          break;
      }
    }
  }

  return { answers: nextAnswers, state, fired, evaluated };
}

/**
 * SwR-045's publish-time check, not a runtime one: a rule or calculation
 * referring to a field the version does not provide. Returned rather than
 * thrown, because the designer is shown every problem at once.
 */
export function danglingReferences(form: FormDef): string[] {
  const known = new Set(form.fields.map((f) => f.id));
  const bad: string[] = [];
  for (const r of form.rules) {
    for (const read of r.reads) {
      if (!known.has(read)) bad.push(`${r.id} reads unknown field ${read}`);
    }
    for (const e of r.effects) {
      if (!known.has(e.target)) bad.push(`${r.id} targets unknown field ${e.target}`);
    }
  }
  return bad;
}

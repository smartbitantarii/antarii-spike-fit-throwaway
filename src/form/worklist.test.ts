/**
 * Tests for the worklist that S1 navigates from and S4 navigates to.
 * Run: node --test src/form/worklist.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeWorklist,
  jobForIteration,
  DEFAULT_WORKLIST_VOLUME,
  type Job,
} from './worklist.ts';

test('a worklist is exactly the volume asked for', () => {
  assert.equal(makeWorklist(0).length, 0);
  assert.equal(makeWorklist(1).length, 1);
  assert.equal(makeWorklist(200).length, 200);
  assert.equal(makeWorklist().length, DEFAULT_WORKLIST_VOLUME);
});

test('🔴 it is DETERMINISTIC — two runs at one volume present the same list', () => {
  // §6d records the worklist volume as a run condition. If the list differed
  // between runs, two figures recorded at the same volume would be
  // measurements of different things while looking identical in the record.
  assert.deepEqual(makeWorklist(50), makeWorklist(50));
  assert.deepEqual(makeWorklist(200), makeWorklist(200));
});

test('a smaller worklist is a prefix of a larger one, so volume is the only variable', () => {
  const small = makeWorklist(10);
  const large = makeWorklist(200);
  assert.deepEqual(small, large.slice(0, 10));
});

test('every job is fully populated — a blank row would not render what a real one does', () => {
  for (const j of makeWorklist(60)) {
    for (const [k, v] of Object.entries(j)) {
      assert.ok(typeof v === 'string' && v.length > 0, j.id + ' has an empty ' + k);
    }
    assert.match(j.due, /^\d{4}-\d{2}-\d{2}$/, j.id + ' has a malformed date: ' + j.due);
  }
});

test('ids are unique, so a list key never collides', () => {
  const jobs = makeWorklist(200);
  assert.equal(new Set(jobs.map((j) => j.id)).size, 200);
  assert.equal(new Set(jobs.map((j) => j.reference)).size, 200);
});

test('the rows vary, so the list is not 200 copies of one thing', () => {
  // A list of identical rows would let the renderer and the reader off
  // lightly in a way a real worklist does not.
  const jobs = makeWorklist(60);
  assert.ok(new Set(jobs.map((j) => j.customer)).size > 1);
  assert.ok(new Set(jobs.map((j) => j.site)).size > 1);
  assert.ok(new Set(jobs.map((j) => j.state)).size > 1);
});

test('a nonsense volume is refused rather than yielding an empty list', () => {
  assert.throws(() => makeWorklist(-1), /non-negative whole number/);
  assert.throws(() => makeWorklist(1.5), /whole number/);
});

// ------------------------------------------- which job each iteration opens

test('⚠ iterations step THROUGH the list rather than always opening row 0', () => {
  // Always tapping the first row would measure a row certain to be mounted
  // and laid out already, which flatters the navigation S1 exists to time.
  const jobs = makeWorklist(200);
  assert.equal(jobForIteration(jobs, 0).id, 'job-0');
  assert.equal(jobForIteration(jobs, 1).id, 'job-1');
  assert.equal(jobForIteration(jobs, 150).id, 'job-150');
});

test('it wraps, so a campaign longer than the list keeps working', () => {
  const jobs = makeWorklist(10);
  assert.equal(jobForIteration(jobs, 10).id, 'job-0');
  assert.equal(jobForIteration(jobs, 101).id, 'job-1');
});

test('an empty worklist is refused rather than returning undefined', () => {
  assert.throws(() => jobForIteration([] as Job[], 0), /empty worklist/);
});

test('a 101-pass campaign reaches well beyond the first screenful', () => {
  // The point of stepping: at 101 iterations against 200 jobs, the campaign
  // opens rows the list must realise rather than ones already on screen.
  const jobs = makeWorklist(DEFAULT_WORKLIST_VOLUME);
  const opened = new Set<string>();
  for (let i = 1; i <= 101; i++) opened.add(jobForIteration(jobs, i).id);
  assert.equal(opened.size, 101, 'every iteration should open a different job');
});

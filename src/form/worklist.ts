/**
 * The worklist — what `S1` navigates FROM and `S4` navigates TO.
 *
 * ⚠ IT EXISTS BECAUSE TWO SEQUENCES CANNOT BE MEASURED WITHOUT IT, and their
 * absence was not a gap in the plan but in the prototype: M7 §3 starts `S1`
 * *"from the job list, with the §3a fill loaded"* and `S4` *"from a non-list
 * screen, worklist at its loaded volume"*. With no list there was nowhere to
 * navigate from or to, so both were undrivable.
 *
 * 🔴 AND IT IS WHY THE COLD START WAS MISTAKEN FOR `S1`. With no list, the
 * nearest thing to "opening a form" was application launch — so the shell
 * instrumented a launch under `S1`'s name and a 306.9 ms cold start was read
 * against a navigation's 300 ms target. A real list removes the temptation.
 *
 * ➕ DETERMINISTIC, NOT RANDOM. §6d records the worklist volume as a run
 * condition, and two runs at the same volume must present the same list or
 * the figures are not comparable. A random generator would make every run a
 * slightly different measurement while looking identical in the record.
 *
 * Imports nothing.
 */

export interface Job {
  id: string;
  /** what a worker would recognise it by */
  reference: string;
  customer: string;
  site: string;
  /** ISO date, so the list has something to sort and render */
  due: string;
  state: 'scheduled' | 'in progress' | 'awaiting parts';
}

/**
 * ➕ THE AUTHOR'S DEFAULT, AND NOTHING IN THE CORPUS SETS IT. M7 says
 * *"worklist at its loaded volume"* without naming a number, and `SwR-115`'s
 * 2 GB budget governs storage rather than list length. 200 is chosen as a
 * plausible day's-work-plus-backlog for a field worker — large enough that a
 * list must virtualise rather than render everything, which is the thing
 * `S4` is actually measuring.
 *
 * ⚠ It travels in the record as `worklistVolume`, so a figure taken at a
 * different volume is visibly a different measurement rather than a silently
 * different one.
 */
export const DEFAULT_WORKLIST_VOLUME = 200;

const CUSTOMERS = [
  'Ashdown Facilities',
  'Brayfield Estates',
  'Carrow Retail',
  'Deanfield Housing',
  'Eastmere Logistics',
];

const SITES = [
  'Unit 4, Mill Road',
  'Harbour Point',
  'Northgate Depot',
  'Riverside Works',
  'Tanner Street',
  'West Quay',
];

const STATES: Job['state'][] = ['scheduled', 'in progress', 'awaiting parts'];

/**
 * A worklist of exactly `n` jobs, the same every time for a given `n`.
 *
 * ⚠ The index drives every field, so there is no clock and no randomness: a
 * run on one device and a run on another at the same volume present the same
 * list, which is what makes their `S4` figures comparable at all.
 */
export function makeWorklist(n: number = DEFAULT_WORKLIST_VOLUME): Job[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('a worklist volume must be a non-negative whole number');
  }
  const jobs: Job[] = [];
  for (let i = 0; i < n; i++) {
    const day = (i % 28) + 1;
    const month = (Math.floor(i / 28) % 12) + 1;
    jobs.push({
      id: 'job-' + i,
      reference: 'WO-' + String(10_000 + i),
      customer: CUSTOMERS[i % CUSTOMERS.length]!,
      site: SITES[i % SITES.length]!,
      due:
        '2026-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
      state: STATES[i % STATES.length]!,
    });
  }
  return jobs;
}

/**
 * The job `S1` navigates into.
 *
 * ⚠ NOT the first one. M7's reset returns to the list and the next iteration
 * taps again; always tapping row 0 would measure a row that is certain to be
 * mounted and laid out already, which flatters the navigation. Stepping
 * through the list means each iteration opens a row the list may have to
 * realise first — which is what a worker does.
 */
export function jobForIteration(jobs: readonly Job[], iteration: number): Job {
  if (jobs.length === 0) throw new Error('an empty worklist has no job to open');
  return jobs[iteration % jobs.length]!;
}

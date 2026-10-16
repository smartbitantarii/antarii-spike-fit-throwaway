/**
 * The one thing that would make leg (iii)'s verdict wrong in the direction of
 * a false pass: a record that stamps `N` while the installed artefact is
 * `N+1`.
 *
 * Run: node --test src/build.test.ts
 *
 * ⚠ `app.json` and `src/build.ts` are two files carrying the same version —
 * one for the OS and the store, one for the harness record — so they can
 * drift, and a drift here is invisible at the bench. The project has already
 * been bitten three times by a Status field disagreeing with a Version field
 * two lines below it; this is the same class of defect in code, so it gets a
 * test rather than a convention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, RUNTIME_VERSION, BUILD_ID, buildStamp } from './build.ts';

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
  expo: { version: string; runtimeVersion: string };
};

test('build.ts agrees with app.json about the version', () => {
  assert.equal(
    APP_VERSION,
    app.expo.version,
    'src/build.ts and app.json disagree — the harness record would name the wrong build',
  );
});

test('build.ts agrees with app.json about the runtime version', () => {
  assert.equal(RUNTIME_VERSION, String(app.expo.runtimeVersion));
});

test("the build id is one of the run plan's two names", () => {
  // The run plan calls them N and N+1 throughout, and the verdict table reads
  // that way, so the record uses those names rather than a semantic version.
  assert.ok(['N', 'N+1'].includes(BUILD_ID), 'BUILD_ID should be N or N+1, got ' + BUILD_ID);
});

test('the stamp is unambiguous on its own, which is what a record line needs', () => {
  const s = buildStamp();
  assert.ok(s.includes(BUILD_ID));
  assert.ok(s.includes(APP_VERSION), 'the stamp must carry the version, not just the name');
  assert.ok(s.includes(RUNTIME_VERSION));
});

/**
 * Produce version N+1 — which, per the run plan, is the WHOLE of producing it.
 *
 *   "N+1 need differ from N in nothing but its version, since what is tested
 *   is the update, not the change."  — spike-run-plan.md §4
 *
 * So this script does exactly that and nothing else: it edits the version in
 * both places that carry it and flips the build name. ⚠ It is a script rather
 * than a note because the two files MUST agree — `build.test.ts` fails if they
 * do not — and because leg (iii) is run twice (once per platform) and a
 * hand-edit is where the third run goes wrong.
 *
 * Usage:  node scripts/bump-to-n-plus-1.mjs          # N  -> N+1
 *         node scripts/bump-to-n-plus-1.mjs --back   # N+1 -> N
 *
 * ➕ `--back` exists because the two platforms are built from the same
 * repository: after iOS has had its N and N+1, Android needs an N again.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const back = process.argv.includes('--back');

const appPath = join(root, 'app.json');
const buildPath = join(root, 'src', 'build.ts');

const app = JSON.parse(readFileSync(appPath, 'utf8'));
let build = readFileSync(buildPath, 'utf8');

const current = app.expo.version;
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  throw new Error('app.json version is not x.y.z: ' + current);
}

// The patch component carries the N -> N+1 step. Nothing else about the
// application changes, so nothing larger than a patch is honest.
parts[2] += back ? -1 : 1;
if (parts[2] < 0) throw new Error('already at the lowest version: ' + current);
const next = parts.join('.');

// `runtimeVersion` moves with it: leg (iii) installs one build over another,
// and a runtime version that did not change would describe them as the same
// runtime, which is the thing under test.
const nextRuntime = String(Number(app.expo.runtimeVersion) + (back ? -1 : 1));
if (Number(nextRuntime) < 1) throw new Error('runtimeVersion cannot go below 1');

const nextBuildId = back ? 'N' : 'N+1';

app.expo.version = next;
app.expo.runtimeVersion = nextRuntime;

function replaceOnce(src, pattern, replacement) {
  const m = src.match(pattern);
  if (!m || src.split(pattern).length !== 2) {
    throw new Error('expected exactly one match for ' + pattern + ' in src/build.ts');
  }
  return src.replace(pattern, replacement);
}

build = replaceOnce(build, /export const APP_VERSION = '[^']*';/, "export const APP_VERSION = '" + next + "';");
build = replaceOnce(build, /export const RUNTIME_VERSION = '[^']*';/, "export const RUNTIME_VERSION = '" + nextRuntime + "';");
build = replaceOnce(build, /export const BUILD_ID = '[^']*';/, "export const BUILD_ID = '" + nextBuildId + "';");

writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
writeFileSync(buildPath, build);

console.log('build  : ' + nextBuildId);
console.log('version: ' + current + ' -> ' + next);
console.log('runtime: ' + nextRuntime);
console.log('');
console.log('Now run `npm test` — build.test.ts checks the two files agree —');
console.log('then build and install this over the previous one with transfers in flight.');

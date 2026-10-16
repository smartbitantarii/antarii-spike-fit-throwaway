/**
 * The build's own identity — what makes N and N+1 distinguishable.
 *
 * Leg (iii) installs one version over another "with transfers in flight" and
 * asks whether the transfer session identifier and the persisted part list
 * survive. ⚠ A result like that is only evidence if the record can show WHICH
 * BUILD wrote each thing — otherwise "the part list survived the update" is
 * indistinguishable from "the update never happened".
 *
 * ➕ The run plan is explicit that this is the ONLY difference: "N+1 need
 * differ from N in nothing but its version, since what is tested is the
 * update, not the change." So bumping a version is the whole of producing
 * N+1, and `npm run bump-version` does it in both places at once.
 *
 * 🔴 TWO PLACES, ONE TRUTH. `app.json` carries the version the store and the
 * OS see; this file carries the version the code reports into the harness
 * record. They MUST agree, and `build.test.ts` fails if they do not — because
 * a record that stamps `N` while the installed artefact is `N+1` would make
 * leg (iii)'s verdict wrong in the direction of a false pass.
 */

/** Must equal `expo.version` in `app.json`. Enforced by `build.test.ts`. */
export const APP_VERSION = '1.0.0';

/** Must equal `expo.runtimeVersion` in `app.json`. Enforced by `build.test.ts`. */
export const RUNTIME_VERSION = '1';

/**
 * What goes in the harness record and in every persisted session row.
 * `N` for the first build, `N+1` for the second — the run plan's own names,
 * used rather than a semantic version so the record reads the way the brief
 * and the verdict table read.
 */
export const BUILD_ID = 'N';

/** Both, for a record line that is unambiguous on its own. */
export function buildStamp(): string {
  return BUILD_ID + ' (v' + APP_VERSION + ', runtime ' + RUNTIME_VERSION + ')';
}

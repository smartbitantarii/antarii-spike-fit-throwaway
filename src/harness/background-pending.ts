/**
 * Leg (i) — the verdict on **whether iOS is holding our background request.**
 *
 * 🔴 **WHY A "NO MARK" NEEDS THIS BESIDE IT.** Round 5's first iPhone wait
 * (3 h 31 min) left no mark, and `expo-background-task` discards the error from
 * `BGTaskScheduler.submit`. So *"iOS chose not to run it"* and *"iOS never
 * accepted it"* produced identical evidence. ✕ Only the first is a *platform
 * limit*; the second is our setup, as the wrong identifier was until
 * 2026-11-03.
 *
 * ⚠ Pure, so it can be tested off the phone; the native read lives in
 * `modules/antarii-bg-probe`.
 */

/** One entry from `BGTaskScheduler.pendingTaskRequests()`, as the module sends it. */
export interface PendingRequest {
  identifier: string;
  kind: string;
  earliestBeginDate: string;
  requiresNetworkConnectivity?: string;
  requiresExternalPower?: string;
}

/**
 * Read in `expo-background-task`'s `BackgroundTaskConstants.swift`; the same
 * value `app.json` declares in `BGTaskSchedulerPermittedIdentifiers`.
 */
export const EXPO_BACKGROUND_IDENTIFIER = 'com.expo.modules.backgroundtask.processing';

export type PendingVerdict =
  /** ✅ iOS holds our request — a later "no mark" is iOS's choice. */
  | 'held'
  /** 🔴 iOS holds nothing of ours — a "no mark" is our setup, not the phone. */
  | 'not-held'
  /** ⚠ The check could not run (Android, or the module did not link). */
  | 'not-checked'
  /** ✕ The check itself failed. */
  | 'threw';

export interface PendingRecord {
  capability: string;
  verdict: PendingVerdict;
  detail: string;
  notProven: string;
}

const CAPABILITY = 'ios background request held';
const NOT_PROVEN =
  'that iOS will ever RUN the request (only a background-task mark shows that), ' +
  'and anything about the request after this moment — a cold launch re-submits it';

export function judgePending(
  requests: ReadonlyArray<PendingRequest> | null,
  atIso: string,
  error: string | null = null,
): PendingRecord {
  if (error !== null) {
    return {
      capability: CAPABILITY,
      verdict: 'threw',
      detail: `at ${atIso}: pendingTaskRequests threw: ${error}`,
      notProven: 'everything — the check did not complete. ' + NOT_PROVEN,
    };
  }
  if (requests === null) {
    return {
      capability: CAPABILITY,
      verdict: 'not-checked',
      detail: `at ${atIso}: no AntariiBgProbeModule (Android, or the module did not link)`,
      notProven: 'everything — the check did not run. ' + NOT_PROVEN,
    };
  }
  const ours = requests.find((r) => r.identifier === EXPO_BACKGROUND_IDENTIFIER);
  // ⚠ Everything iOS returned goes in the detail, ours or not, so a request
  // under an unexpected identifier is visible rather than silently ignored.
  const all = requests.length === 0
    ? 'none'
    : requests.map((r) => JSON.stringify(r)).join('; ');
  if (!ours) {
    return {
      capability: CAPABILITY,
      verdict: 'not-held',
      detail: `at ${atIso}: iOS holds no ${EXPO_BACKGROUND_IDENTIFIER} request. All pending: ${all}`,
      notProven: NOT_PROVEN,
    };
  }
  return {
    capability: CAPABILITY,
    verdict: 'held',
    detail: `at ${atIso}: iOS holds ${ours.kind} request ${ours.identifier}, ` +
      `earliest ${ours.earliestBeginDate || 'unset'}. All pending: ${all}`,
    notProven: NOT_PROVEN,
  };
}

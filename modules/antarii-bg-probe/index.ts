/**
 * Leg (i) — the JavaScript side of the iOS pending-request check.
 *
 * ⚠ **iOS ONLY.** `expo-module.config.json` lists no Android module, so on
 * Android `native` is `null` and the check reports that it did not run. *Android
 * is checked from outside instead, with `adb shell dumpsys jobscheduler`.*
 *
 * ⚠ **`requireOptionalNativeModule`**, for the reason `antarii-evaluator` gives:
 * a missing module must be a result on the screen, never a launch crash.
 */

import { requireOptionalNativeModule } from 'expo';

import type { PendingRequest } from '../../src/harness/background-pending.ts';

const native = requireOptionalNativeModule<{
  pendingTaskRequests(): Promise<PendingRequest[]>;
}>('AntariiBgProbeModule');

/** `null` when the native module is absent — Android, or a failed link. */
export async function pendingTaskRequests(): Promise<PendingRequest[] | null> {
  if (!native) return null;
  return native.pendingTaskRequests();
}

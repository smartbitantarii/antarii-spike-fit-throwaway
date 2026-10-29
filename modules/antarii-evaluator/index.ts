/**
 * `SC-10` — the JavaScript side of the Rust hosting probe.
 *
 * 🔴 **THE ONLY QUESTION THIS ANSWERS: can a Rust library be hosted in this
 * client and called from JavaScript at all?** Nothing has ever run Rust in
 * this stack — the earlier Go→WebAssembly attempt was reverted — so this is an
 * **integration** question. ✕ It is not a performance measurement, and it is
 * not the condition language evaluator.
 *
 * ⚠ **THE TWO PLATFORMS PROVE DIFFERENT AMOUNTS, AND THE RECORD SAYS SO.**
 * Swift calls a C function directly, so iOS exercises both the integer path
 * and the **decimal-string** path specification §4.8 actually binds. Kotlin
 * reaches native code only through JNI, and a JNI string needs the `jni` crate
 * or an NDK C shim — neither of which is required to answer the question — so
 * **Android proves hosting and not marshalling.**
 */

import { requireOptionalNativeModule } from 'expo';

/**
 * ⚠ **`requireOptionalNativeModule`, NOT `requireNativeModule`**, and this is
 * the whole difference between a probe and a crash.
 *
 * If the native module is absent — autolinking missed it, the library did not
 * link, the `.so` is for the wrong ABI — the strict form **throws at import
 * time**, which in React Native means a blank screen with no JavaScript
 * running. *That is `F-12`'s failure mode, and a probe that cannot report its
 * own absence is useless.* The optional form returns `null` and lets the
 * screen say so.
 */
const native = requireOptionalNativeModule<{
  probeAdd(a: number, b: number): number;
  probeDoubleDecimal?(input: string): string | null;
}>('AntariiEvaluatorModule');

export type HostingVerdict =
  /** 🔴 No native module at all — autolinking or linking failed. */
  | 'not-hosted'
  /** ✅ The library loaded and returned the right answer. */
  | 'hosted'
  /** ✕ The library loaded and returned the WRONG answer. */
  | 'wrong-answer'
  /** ✕ The library loaded and the call threw. */
  | 'threw';

export interface HostingProbe {
  verdict: HostingVerdict;
  detail: string;
  /** ⚠ Every probe states what it did NOT establish, in its own record. */
  notProven: string;
}

const NOT_PROVEN_BASE =
  'SwR-066/SwR-036 300 ms (not measured — the narrowed spike drops performance), ' +
  'the condition language itself (§§5, 7–11 unwritten), concurrency, memory under load';

/**
 * ✅ **The linkage probe.** Two integers across the boundary and back.
 *
 * ➕ **The answer is CHECKED, not merely received.** A bridge that returns
 * `undefined`, `0` or a coerced string would otherwise read as success — and
 * the whole point is that *"the call returned"* and *"the call worked"* are
 * different facts.
 */
export function probeHosting(): HostingProbe {
  if (!native) {
    return {
      verdict: 'not-hosted',
      detail:
        'requireOptionalNativeModule returned null — no AntariiEvaluatorModule. ' +
        'Autolinking did not find modules/antarii-evaluator, or the native ' +
        'library failed to link.',
      notProven: 'everything — the library was never reached. ' + NOT_PROVEN_BASE,
    };
  }
  try {
    // Values chosen so a truncation to 32 bits would be visible: the sum
    // exceeds 2^31 and both operands are below it.
    const got = native.probeAdd(2_000_000_000, 147_483_647);
    const want = 2_147_483_647;
    if (got !== want) {
      return {
        verdict: 'wrong-answer',
        detail: `probeAdd returned ${String(got)} (${typeof got}), expected ${want}`,
        notProven: 'the boundary is reachable but not trustworthy. ' + NOT_PROVEN_BASE,
      };
    }
    return {
      verdict: 'hosted',
      detail: `probeAdd crossed the boundary and returned ${want}`,
      notProven:
        'decimal-string marshalling on ANDROID (JNI strings not built — see ' +
        'jni.rs). ' + NOT_PROVEN_BASE,
    };
  } catch (e) {
    return {
      verdict: 'threw',
      detail: `probeAdd threw: ${e instanceof Error ? e.message : String(e)}`,
      notProven: 'the boundary exists and failed. ' + NOT_PROVEN_BASE,
    };
  }
}

/**
 * **The marshalling probe — §4.8's own contract.** iOS only.
 *
 * Specification §4.8 decides that a number crosses every implementation
 * boundary as a **decimal string**, *"with the scale carried by the digits
 * present"*, and names *"JavaScript ↔ the native library on the device"* as
 * one of the three boundaries it binds. **This is that boundary.**
 *
 * ⚠ Returns `null` where the platform does not offer the function at all,
 * which on Android is the expected answer rather than a failure.
 */
export function probeDecimalBoundary(): HostingProbe | null {
  if (!native || typeof native.probeDoubleDecimal !== 'function') return null;
  try {
    // `1.50` doubled is `3.00`: §4.4 applies no rounding, so the SCALE must
    // survive. A boundary that returned `3` would have lost it — which is
    // exactly what §4.8 rejects a scaled integer for.
    const got = native.probeDoubleDecimal('1.50');
    if (got !== '3.00') {
      return {
        verdict: 'wrong-answer',
        detail: `probeDoubleDecimal('1.50') returned ${JSON.stringify(got)}, expected "3.00"`,
        notProven:
          'the string crossed but the scale or the value did not survive. ' +
          NOT_PROVEN_BASE,
      };
    }
    return {
      verdict: 'hosted',
      detail: "probeDoubleDecimal('1.50') returned \"3.00\" — scale survived the boundary",
      notProven: NOT_PROVEN_BASE,
    };
  } catch (e) {
    return {
      verdict: 'threw',
      detail: `probeDoubleDecimal threw: ${e instanceof Error ? e.message : String(e)}`,
      notProven: 'the boundary exists and failed on strings. ' + NOT_PROVEN_BASE,
    };
  }
}

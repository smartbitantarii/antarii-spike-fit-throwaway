/**
 * Condition 4 — the CAPABILITY PROBE JUDGEMENTS. Imports nothing.
 *
 * 🔴 WHY THIS IS SPLIT FROM `expo-capability.ts`, AND IT IS THIS CODEBASE'S
 * OWN RULE RATHER THAN A NEW ONE.
 *
 * `expo-media.ts` states the boundary: the `expo-*` modules are the only ones
 * that import the platform, and `src/media/prepare.ts` *"imports nothing and
 * is tested on a development machine"*. ✕ **The first draft of these probes
 * ignored that and put the judgement beside the `expo-image-picker` import** —
 * and the test could not even load, because **Node refuses to strip types
 * inside `node_modules`**. *The boundary is not a style preference; it is what
 * makes a judgement testable at all.*
 *
 * ---------------------------------------------------------------------------
 * WHAT A PROBE IS, AND WHAT IT IS NOT.
 *
 * Brief §5 condition 4 asks whether the framework offers a route to each
 * capability `SyR-089` names, and **`SB-009` settled the shape**: a handset
 * with no radio does not fail the axis — what fails it is *"the framework
 * offering no route on a device that has one"*.
 *
 * ✅ So a probe presses the route and reports a verdict. ✕ It does **not**
 * store, encrypt, queue, stamp, compress, or attach anything to a form.
 *
 * ⚠ **AND IT PROVES NOTHING ABOUT THE REQUIREMENTS THE CAPABILITY SERVES.**
 * `SwR-086`'s compression, `SwR-102`'s stamping and `SwR-100`'s 2-second
 * photograph figure are separate obligations measured elsewhere. *A
 * "route exists" read as covering those would bank a pass nobody earned —
 * the `C1`/`C2`/`M5` defect class in a new place, which is why every result
 * carries its own `notProven` rather than relying on a comment here.*
 */

/**
 * ⚠ FIVE OUTCOMES, NOT TWO — because `SB-009` needs *no hardware* told apart
 * from *no route*, and an operator declining a prompt is neither.
 */
export type ProbeVerdict =
  /** ✅ The framework offered a route and it produced something. */
  | 'route-exists'
  /** ✕ The route exists in the API and the platform refused it. */
  | 'refused'
  /** ⚠ No radio, no sensor, no camera — `SB-009`: this does NOT fail the axis. */
  | 'no-hardware'
  /** ⚠ The operator cancelled. Not a verdict about the framework at all. */
  | 'cancelled'
  /** 🔴 No route offered by the framework. THIS is what fails condition 4. */
  | 'no-route';

export interface ProbeResult {
  capability: string;
  verdict: ProbeVerdict;
  /** What was observed, in the words the platform used. Never paraphrased. */
  detail: string;
  /** ⚠ Every probe states what it did NOT establish, in its own record. */
  notProven: string;
}

const VIDEO_NOT_PROVEN =
  'duration limits (SwR-078), compression (SwR-086), stamping (SwR-102), size (SyR-082)';
const SIGNATURE_NOT_PROVEN =
  'image rendering, SwR-102 stamping, storage as encrypted media, legal sufficiency';

/** The shape `expo-image-picker` returns, narrowed to what a verdict needs. */
export interface CapturedAsset {
  uri?: string | null;
  /** ✅ null on an image asset — which is how video is told from a still. */
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * `SyR-089`'s **video capture**, judged from what the recorder returned.
 *
 * ⚠ **`duration` IS THE DISCRIMINATOR, and it is the whole reason this is not
 * just a null-check on `uri`.** The same `launchCameraAsync` call serves
 * photographs, so a route that handed back a **still** would otherwise pass as
 * video. *`expo-image-picker`'s own types give `duration` as null on an image
 * asset — read from `ImagePicker.types.d.ts` in the installed package.*
 */
export function judgeVideoAsset(asset: CapturedAsset | null | undefined): ProbeResult {
  const capability = 'video capture';
  if (!asset?.uri) {
    return {
      capability,
      verdict: 'no-route',
      detail: 'the recorder returned no asset uri',
      notProven: VIDEO_NOT_PROVEN,
    };
  }
  if (asset.duration == null) {
    return {
      capability,
      verdict: 'no-route',
      detail: 'an asset with no duration — a still, not a recording',
      notProven: VIDEO_NOT_PROVEN,
    };
  }
  if (asset.duration <= 0) {
    return {
      capability,
      verdict: 'cancelled',
      detail: `duration ${asset.duration}ms — nothing was recorded`,
      notProven: VIDEO_NOT_PROVEN,
    };
  }
  return {
    capability,
    verdict: 'route-exists',
    detail:
      `uri=${asset.uri.slice(0, 48)}… duration=${asset.duration}ms ` +
      `${asset.width ?? '?'}x${asset.height ?? '?'}`,
    notProven: VIDEO_NOT_PROVEN,
  };
}

/**
 * `SyR-089`'s **signature capture**, judged from the points a stroke produced.
 *
 * ➕ **NO NEW NATIVE DEPENDENCY, and the reasoning is worth stating because the
 * obvious move is a drawing library.** The capability question is whether the
 * framework can capture freehand touch, and React Native's own `PanResponder`
 * either delivers a stroke or it does not — **the points ARE the answer.**
 * *Rendering it prettily is a product concern and is deliberately absent.*
 *
 * ⚠ **It also cannot repeat `F-12`.** A new native package left the
 * application unable to start and the cause is still unexplained; a probe that
 * adds no package cannot do that.
 */
export function judgeSignatureStroke(
  points: ReadonlyArray<{ x: number; y: number }>,
): ProbeResult {
  const capability = 'signature capture';
  const MIN_POINTS = 12;
  if (points.length === 0) {
    return {
      capability,
      verdict: 'no-route',
      detail: 'PanResponder delivered no points at all',
      notProven: SIGNATURE_NOT_PROVEN,
    };
  }
  if (points.length < MIN_POINTS) {
    return {
      capability,
      verdict: 'cancelled',
      detail: `only ${points.length} points — a tap, not a stroke (minimum ${MIN_POINTS})`,
      notProven: SIGNATURE_NOT_PROVEN,
    };
  }
  // ➕ A bounding box as well as a count, so a finger held still while the
  // clock ran is told from a stroke. *A count alone would pass the former.*
  let minX = points[0]!.x, maxX = points[0]!.x, minY = points[0]!.y, maxY = points[0]!.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.round(maxX - minX);
  const h = Math.round(maxY - minY);
  if (w < 8 && h < 8) {
    return {
      capability,
      verdict: 'cancelled',
      detail: `${points.length} points but a ${w}x${h} box — the finger did not move`,
      notProven: SIGNATURE_NOT_PROVEN,
    };
  }
  return {
    capability,
    verdict: 'route-exists',
    detail: `${points.length} points over a ${w}x${h} box`,
    notProven: SIGNATURE_NOT_PROVEN,
  };
}

/**
 * ⚠ NOT PROBED TODAY, ENUMERATED RATHER THAN LEFT SILENT.
 *
 * ✕ **`SB-009` means a missing probe is not a condition-4 failure — but it is
 * not a pass either, and silence in a record reads as a pass.** So the record
 * carries ***not established*** with the reason.
 */
export const NOT_PROBED_TODAY = Object.freeze([
  Object.freeze({
    capability: 'barcode and QR, offline',
    reason:
      'needs expo-camera — the only new native package in scope, isolated to its own ' +
      'build step because F-12 is unexplained and one package keeps blame attributable',
  }),
  Object.freeze({
    capability: 'NFC',
    reason:
      'needs a non-Expo native module AND an iOS entitlement — that is O2, unanswered ' +
      '(dropped from today on the author’s recommendation, 2026-10-29)',
  }),
]);

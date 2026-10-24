/**
 * S5's subject — "photograph attached and visible, INCLUDING compression
 * (`SwR-086`) and stamping (`SwR-102`)", under 2 s.
 *
 * ⚠ S5's stop event is not "the shutter closed". M7 §2 defines it as "the
 * thumbnail is visible in the form, AFTER compression and stamping", so the
 * figure has to absorb both — which means both must actually happen, and both
 * are decided here rather than inside a platform call where nothing could
 * test them.
 *
 * Imports nothing. The Expo calls that execute these decisions live in
 * `src/platform/expo-adapters.ts`, the only module that imports Expo.
 */

// ---------------------------------------------------------------------------
// SwR-086 — the media quality levels, and the layered maximums.
// ---------------------------------------------------------------------------

/** `SwR-086`'s closed list, in order, weakest first. The order IS the floor rule. */
export const QUALITY_LEVELS = ['standard', 'high-detail', 'full'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

/**
 * `N-C4`, set 2026-09-17: "photographs 1600 px / 3000 px long edge / native".
 * `null` is `full` — "what the device's camera natively produces" — and is
 * null rather than a big number so nothing can accidentally downscale it.
 */
export const LONG_EDGE_PX: Readonly<Record<QualityLevel, number | null>> = Object.freeze({
  standard: 1600,
  'high-detail': 3000,
  full: null,
});

export function rank(level: QualityLevel): number {
  return QUALITY_LEVELS.indexOf(level);
}

/**
 * `SwR-086`: "**Standard is the floor**: no setting at any layer shall produce
 * less, since below it evidence stops being evidence."
 */
export const FLOOR: QualityLevel = 'standard';

/**
 * The layers, exactly as `SwR-086` names them: "a **platform ceiling**
 * (operator), a **tenant maximum** at or below it, and a **field maximum** at
 * or below the tenant's. Per field the designer sets a **default** (at or
 * below the field maximum)".
 *
 * "shipped platform ceiling *Full*, tenant maximum *High detail*, tenant
 * default *Standard*" — so the defaults below are the shipped ones.
 */
export interface QualityLayers {
  platformCeiling: QualityLevel;
  tenantMaximum: QualityLevel;
  /** the designer's, per field; absent means the tenant's maximum applies */
  fieldMaximum?: QualityLevel;
  /** the designer's per-field default; absent means the tenant default is used */
  fieldDefault?: QualityLevel;
  /** "the tenant carries defaults for fields that set none" */
  tenantDefault: QualityLevel;
}

export const SHIPPED_LAYERS: QualityLayers = Object.freeze({
  platformCeiling: 'full',
  tenantMaximum: 'high-detail',
  tenantDefault: 'standard',
});

function lower(a: QualityLevel, b: QualityLevel): QualityLevel {
  return rank(a) <= rank(b) ? a : b;
}

/**
 * The effective maximum for a field: each layer at or below the one above it.
 *
 * ⚠ A layer set ABOVE the one above it is CLAMPED, not honoured and not
 * rejected. `SwR-086` words each layer as "at or below" the one above, so a
 * higher value is not a permission — and clamping is what makes the sentence
 * true however the configuration was built. The floor is applied last, since
 * "no setting at any layer shall produce less".
 */
export function effectiveMaximum(layers: QualityLayers): QualityLevel {
  let max = layers.platformCeiling;
  max = lower(max, layers.tenantMaximum);
  if (layers.fieldMaximum) max = lower(max, layers.fieldMaximum);
  return rank(max) < rank(FLOOR) ? FLOOR : max;
}

/** The level in force before the worker touches anything. */
export function effectiveDefault(layers: QualityLayers): QualityLevel {
  const max = effectiveMaximum(layers);
  const wanted = layers.fieldDefault ?? layers.tenantDefault;
  const chosen = lower(wanted, max);
  return rank(chosen) < rank(FLOOR) ? FLOOR : chosen;
}

/**
 * `SwR-086`: "The **worker may raise** the level for a **single capture, up to
 * the field maximum** — never above it".
 *
 * ⚠ "Raise" is one-directional and this enforces it: a request BELOW the level
 * in force is refused rather than applied, because `SwR-086`'s floor reasoning
 * is that below Standard "evidence stops being evidence" and the same logic
 * makes a worker-initiated downgrade the wrong thing to permit silently.
 * ➕ Refusing rather than clamping is the author's reading, labelled: the
 * requirement grants a raise and is silent on a lowering, and a silent
 * downgrade of evidence is the worse failure.
 */
export function resolveForCapture(
  layers: QualityLayers,
  workerRaise?: QualityLevel,
): { level: QualityLevel; raised: boolean } {
  const base = effectiveDefault(layers);
  if (!workerRaise) return { level: base, raised: false };
  const max = effectiveMaximum(layers);
  if (rank(workerRaise) < rank(base)) {
    throw new Error('SwR-086 permits the worker to RAISE a single capture, not to lower it');
  }
  if (rank(workerRaise) > rank(max)) {
    throw new Error('SwR-086: never above the field maximum');
  }
  return { level: workerRaise, raised: rank(workerRaise) > rank(base) };
}

// ---------------------------------------------------------------------------
// SwR-102 — the stamp.
// ---------------------------------------------------------------------------

export interface LocationFix {
  latitude: number;
  longitude: number;
  /**
   * `SwR-102` stamps "the device location AND ITS ACCURACY".
   *
   * ⚠ NULLABLE, AND THE REQUIREMENT DOES NOT SAY WHAT THAT IS.
   * `expo-location`'s own typings declare `accuracy: number | null` ("can be
   * null on Web if it's not available"), so the platform can return a
   * position with no accuracy. `SwR-102` pairs the two and is silent on that
   * case. Dropping the fix would discard a real position; recording it with a
   * null accuracy keeps the position and makes the absence visible, which is
   * the lesser of the two. **Treated as a minor open point rather than
   * decided here**, the case being web-only on current typings and the spike
   * targeting devices.
   */
  accuracyMetres: number | null;
}

/**
 * `SwR-102`: stamped with the device date and time and, "where the device can
 * provide it **within the capture moment**", the location and its accuracy;
 * "where it is unavailable or withheld the stamp shall record *location
 * unavailable* and the capture **shall** proceed".
 */
export interface CaptureStamp {
  /** the device's own clock at capture */
  deviceTime: string;
  location: LocationFix | null;
  /** the literal `SwR-102` wording, present exactly when there is no fix */
  locationNote: 'location unavailable' | null;
  /** `SwR-102`: "the level used recorded" */
  levelUsed: QualityLevel;
  longEdgePx: number | null;
  /** `SwR-102`: "the server receipt time on synchronisation, so clock drift is
   * visible rather than hidden" — null until the batch is acknowledged */
  serverReceiptTime: string | null;
}

export const LOCATION_UNAVAILABLE = 'location unavailable';

/**
 * ⚠ THIS FUNCTION CANNOT FAIL FOR WANT OF A LOCATION, and that is the
 * requirement rather than leniency: "where it is unavailable or withheld the
 * stamp shall record *location unavailable* and the capture SHALL PROCEED". A
 * capture that threw because the worker had denied location would lose
 * evidence to a permission prompt.
 */
/**
 * 🔴 HOW LONG A CAPTURE MAY WAIT FOR A LOCATION FIX. **Decision — owner,
 * 2026-10-24: 1000 ms**, chosen against measured evidence rather than taste.
 *
 * ⚠ THE REQUIREMENTS ALREADY BOUND THIS — the author first read them as not
 * doing so, and was wrong. `SwR-102` stamps the location *“where the device can
 * provide it **within the capture moment**”* — a CONDITIONAL, not an instruction
 * to wait — and directs that *“where it is unavailable or withheld the stamp
 * **shall** record *location unavailable* and the capture **shall** proceed”*.
 * `SwR-100` then puts the whole capture, *“**including** … stamping
 * (SwR-102)”*, under **2 seconds**. So an unbounded wait violates both; the
 * requirements needed no amendment, only obeying.
 *
 * ➕ WHY 1000 ms AND NOT A ROUND GUESS. On the Galaxy A35 5G, `S5` over
 * `n`=100 with location granted ran **91 captures at a ~265 ms median total**
 * and **9 at ~27.1 s** — a 1.07% spread across those nine, which is the
 * signature of a platform timeout, not of slow work. So the device usually has
 * a fresh fix and only periodically must acquire one. **A 1000 ms deadline
 * keeps the fix on roughly 91% of photographs and stamps the rest
 * *unavailable*, while leaving the measured ~265 ms pipeline most of its
 * 2000 ms budget.** *Shorter would discard fixes that were about to arrive;
 * longer would leave no room for the pipeline's own tail.*
 *
 * ✕ `getLastKnownPositionAsync` was considered and NOT used, though it takes
 * `maxAge` and `requiredAccuracy` and returns at once. A fix **taken** minutes
 * ago elsewhere is not one the device *“can provide within the capture
 * moment”*, and **wrong location evidence is worse than none** on a photograph
 * whose purpose is evidence. *Adopting it would be a reading of that clause,
 * not a performance tweak.*
 */
export const LOCATION_DEADLINE_MS = 1000;

export function stamp(
  deviceTimeIso: string,
  level: QualityLevel,
  fix: LocationFix | null,
): CaptureStamp {
  return {
    deviceTime: deviceTimeIso,
    location: fix,
    locationNote: fix ? null : LOCATION_UNAVAILABLE,
    levelUsed: level,
    longEdgePx: LONG_EDGE_PX[level],
    serverReceiptTime: null,
  };
}

/**
 * `SwR-102`: "Each capture shall also record the server receipt time on
 * synchronisation, so clock drift is visible rather than hidden."
 *
 * ⚠ Returns a NEW stamp. `SwR-123` makes stamps "immutable with" the response,
 * so the receipt time is added by producing the next version of the stamp
 * rather than by writing into the one already recorded.
 */
export function withServerReceipt(s: CaptureStamp, serverTimeIso: string): CaptureStamp {
  if (s.serverReceiptTime) throw new Error('the server receipt time is already recorded');
  return { ...s, serverReceiptTime: serverTimeIso };
}

/** The drift the pair exists to make visible, in milliseconds. */
export function clockDriftMs(s: CaptureStamp): number | null {
  if (!s.serverReceiptTime) return null;
  return Date.parse(s.serverReceiptTime) - Date.parse(s.deviceTime);
}

/**
 * What the platform layer is asked to do, derived entirely from the above so
 * the adapter makes no decisions of its own.
 */
export interface CapturePlan {
  level: QualityLevel;
  /** null means "native" — do not resize */
  longEdgePx: number | null;
  /** `SwR-102`: "Location shall be requested only at that moment, never
   * continuously" — so this is a one-shot request flag, not a subscription. */
  requestLocationOnce: true;
}

export function planCapture(layers: QualityLayers, workerRaise?: QualityLevel): CapturePlan {
  const { level } = resolveForCapture(layers, workerRaise);
  return { level, longEdgePx: LONG_EDGE_PX[level], requestLocationOnce: true };
}

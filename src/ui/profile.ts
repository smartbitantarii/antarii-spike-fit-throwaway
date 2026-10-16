/**
 * Step 1b, part 1 — the two `SyR-221` usability profiles.
 *
 * `SyR-221`, quoted because every number below is its and not ours:
 *   "**Standard** — touch targets ≥ 48 × 48 density-independent pixels,
 *   contrast ≥ 4.5 : 1 for normal text and ≥ 3 : 1 for large text and control
 *   outlines; **Field** — touch targets ≥ 64 × 64, contrast ≥ 7 : 1 and
 *   ≥ 4.5 : 1, status never carried by colour without a shape or word."
 *
 * ⚠ THE FLOORS ARE ASSERTED, NOT TRUSTED. The palette below is a set of
 * colours someone chose; the tests compute the WCAG 2.2 contrast ratio of
 * every pair that is actually used and fail if it misses the floor. That is
 * the point of putting the maths here rather than in a design note: a
 * hand-checked ratio is a claim, and `SyR-141`'s WCAG 2.2 AA conformance and
 * `SwR-053`'s publish gate both need a fact.
 *
 * ⚠ AND THIS FILE IMPORTS NOTHING. Not React, not React Native. The whole of
 * 1b's measurable content — the floors, the contrast, the density cost, the
 * switch — is decided here and tested on a development machine, exactly as
 * `src/platform/` keeps Expo in one place so build 1's logic could be tested
 * before a device existed. What is left for the device is rendering, which is
 * what condition 3 measures.
 */

/** Never below the Standard floor — `SwR-093`. Order matters, so it is explicit. */
export const PROFILES = ['standard', 'field'] as const;
export type Profile = (typeof PROFILES)[number];

/** A colour as `#rrggbb`. */
export type Hex = string;

export interface ContrastFloors {
  /** `SyR-221`: normal text */
  normalText: number;
  /** `SyR-221`: "large text and control outlines" — one floor, two subjects */
  largeTextAndOutline: number;
}

export interface ProfileTokens {
  profile: Profile;
  /** `SyR-221`: touch targets ≥ 48 × 48 / ≥ 64 × 64 dp */
  minTouchDp: number;
  contrast: ContrastFloors;
  /**
   * `SyR-221`, the Field profile only: "status never carried by colour without
   * a shape or word". Under Standard a colour alone is permitted by SyR-221 —
   * ⚠ but `SwR-053` forbids it anyway for a *rule outcome*: "colour or position
   * shall never be the only carrier of meaning in a rule outcome (a required or
   * invalid state is also announced in text)". So this flag is about what
   * SyR-221 demands of the profile, and SwR-053 is a floor underneath BOTH
   * profiles that no profile may undercut.
   */
  statusNeedsShapeOrWord: boolean;
  text: Hex;
  background: Hex;
  outline: Hex;
  /** text sizes in dp; "large text" is WCAG's ≥ 18.66dp bold or ≥ 24dp */
  labelDp: number;
  valueDp: number;
  /** vertical rhythm — what makes the Field profile cost screen space */
  rowGapDp: number;
}

/**
 * ⚠ SwR-053 IS A FLOOR UNDER BOTH PROFILES, NOT A FIELD-PROFILE FEATURE.
 * Read at source: "colour or position shall never be the only carrier of
 * meaning in a rule outcome (a required or invalid state is also announced in
 * text)". A reader could easily take SyR-221's Field clause to mean Standard
 * may use colour alone for a required or invalid state. It may not.
 */
export const RULE_OUTCOME_NEEDS_TEXT = true;

const STANDARD: ProfileTokens = {
  profile: 'standard',
  minTouchDp: 48,
  contrast: { normalText: 4.5, largeTextAndOutline: 3 },
  statusNeedsShapeOrWord: false,
  text: '#1a1a1a',
  background: '#ffffff',
  outline: '#767676',
  labelDp: 14,
  valueDp: 16,
  rowGapDp: 8,
};

const FIELD: ProfileTokens = {
  profile: 'field',
  minTouchDp: 64,
  contrast: { normalText: 7, largeTextAndOutline: 4.5 },
  statusNeedsShapeOrWord: true,
  text: '#1a1a1a',
  background: '#ffffff',
  // ⚠ Darker than Standard's on purpose: Standard's #767676 is 4.54:1, which
  // clears Standard's 3:1 outline floor comfortably and clears Field's 4.5:1
  // by 0.04 — a margin too thin to depend on. The tests would pass and the
  // next palette tweak would break it silently.
  outline: '#595959',
  labelDp: 16,
  valueDp: 18,
  rowGapDp: 12,
};

export const TOKENS: Readonly<Record<Profile, ProfileTokens>> = {
  standard: STANDARD,
  field: FIELD,
};

// ---------------------------------------------------------------------------
// WCAG 2.2 contrast, computed rather than asserted.
// ---------------------------------------------------------------------------

export function parseHex(hex: Hex): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error('not a #rrggbb colour: ' + hex);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance: the sRGB channel transfer, not a sloppy average. */
export function relativeLuminance(hex: Hex): number {
  const lin = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG 2.2 contrast ratio, 1..21. */
export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG's own "large text" threshold, in dp. 18pt / 14pt-bold at the 1.333
 * px-per-pt ratio is 24dp / 18.66dp, so anything at or above 24dp takes the
 * large-text floor. Nothing in the spike is bold-only, so the bold leg is
 * deliberately not implemented — stated rather than silently omitted.
 */
export const LARGE_TEXT_DP = 24;

export function floorFor(tokens: ProfileTokens, sizeDp: number): number {
  return sizeDp >= LARGE_TEXT_DP
    ? tokens.contrast.largeTextAndOutline
    : tokens.contrast.normalText;
}

// ---------------------------------------------------------------------------
// Status presentation — SyR-221's Field clause and SwR-053's floor.
// ---------------------------------------------------------------------------

export type StatusKind = 'required' | 'invalid' | 'valid';

export interface StatusPresentation {
  kind: StatusKind;
  colour: Hex;
  /** the shape half of "a shape or word" — null only where a word carries it */
  glyph: string | null;
  /** the word half; `SwR-053` requires text for a rule outcome in BOTH profiles */
  word: string;
}

/**
 * ⚠ Every status carries BOTH a glyph and a word, in both profiles. That is
 * stricter than either requirement alone and it is deliberate: `SyR-221`'s
 * Field clause wants "a shape OR a word", and `SwR-053` wants a required or
 * invalid state "also announced in text" regardless of profile. Satisfying
 * the stricter reading everywhere costs nothing and removes a per-profile
 * branch that would be easy to get wrong.
 */
export function statusPresentation(profile: Profile, kind: StatusKind): StatusPresentation {
  const t = TOKENS[profile];
  const palette: Record<StatusKind, Hex> =
    profile === 'field'
      ? { required: '#8b0000', invalid: '#8b0000', valid: '#005c2e' }
      : { required: '#b00020', invalid: '#b00020', valid: '#00701f' };
  const glyphs: Record<StatusKind, string> = {
    required: '*',
    invalid: '!',
    valid: '✓',
  };
  const words: Record<StatusKind, string> = {
    required: 'Required',
    invalid: 'Invalid',
    valid: 'Valid',
  };
  void t;
  return { kind, colour: palette[kind], glyph: glyphs[kind], word: words[kind] };
}

// ---------------------------------------------------------------------------
// SwR-093's switch.
// ---------------------------------------------------------------------------

/**
 * `SwR-093`: "The worker may switch profile on their own device at any time, in
 * either direction and never below the Standard floor; the switch is a device
 * preference, affects no captured data, and is not recorded on the instance."
 *
 * ⚠ Four separate claims, and the last two are the ones an implementation
 * breaks by accident — which is why this type holds the preference and NOTHING
 * else. It has no reference to answers and no reference to an instance, so
 * "affects no captured data" and "is not recorded on the instance" are true by
 * construction rather than by discipline. A test can only confirm that; the
 * shape is what guarantees it.
 */
export class ProfilePreference {
  private profile: Profile;
  private readonly log: Profile[];

  constructor(tenantDefault: Profile) {
    this.profile = tenantDefault;
    this.log = [tenantDefault];
  }

  current(): Profile {
    return this.profile;
  }

  /** Every profile the worker has selected on this device, in order. */
  history(): readonly Profile[] {
    return this.log;
  }

  /**
   * "in either direction" — so this is not a one-way upgrade, and a worker who
   * switches to Field can switch back. "never below the Standard floor" is
   * satisfied because Standard IS the floor and `Profile` admits nothing below
   * it; an unknown value is refused rather than silently clamped, because
   * clamping would hide a caller passing something SyR-221 does not define.
   */
  switchTo(next: Profile): void {
    if (!(PROFILES as readonly string[]).includes(next)) {
      throw new Error('not a SyR-221 profile, and the Standard floor forbids a guess: ' + next);
    }
    this.profile = next;
    this.log.push(next);
  }
}

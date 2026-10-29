/**
 * Step 1b, part 2 — the sixteen widget presentations, and what one costs.
 *
 * `M3` sizes 1b as "the spike form's field types × two profiles, plus the
 * switch" and settles the arithmetic: "the form uses eight of the palette's
 * twenty-one types, so this is **sixteen widget presentations rather than
 * forty-two**". The eight are declared in `../form/model.ts` as `FieldType`.
 *
 * ➕ AND IT IS MEANT TO PRODUCE A NUMBER, not just a layout. ADR-003 §4.8:
 * "the palette is the schedule… §4.5's accessibility axis is the first honest
 * measurement of what one widget costs." So this file computes the cost —
 * `heightDp` per presentation, and `fieldsPerScreen` over a real field list —
 * rather than leaving it to be eyeballed on a device. `SwR-093` says the
 * profile matters "since it changes how many fields fit on a screen", and that
 * sentence is only checkable if something computes it.
 *
 * Imports nothing but the form model. See `profile.ts` for why.
 */
import type { FieldType, FieldDef } from '../form/model.ts';
import { TOKENS, type Profile, type ProfileTokens } from './profile.ts';

/**
 * How many touch rows a control occupies, by type. ➕ These are presentation
 * judgements, not requirements — no requirement says a media field is three
 * rows tall — so they are labelled as the author's and gathered in ONE table
 * where the device run can correct them, rather than scattered through
 * components where a correction would have to be hunted.
 */
const CONTROL_ROWS: Readonly<Record<FieldType, number>> = {
  text: 1,
  number: 1,
  date: 1,
  'single-select': 1,
  // a trigger plus a row for the chosen options
  'multi-select': 2,
  checkbox: 1,
  // a capture control plus a thumbnail strip
  media: 3,
  'check-item': 1,
};

/** Line height as a multiple of the font size — the usual typographic default. */
const LINE_HEIGHT = 1.4;

export interface WidgetPresentation {
  type: FieldType;
  profile: Profile;
  /**
   * The touch target's own height, which is what `SyR-221`'s "≥ 48 × 48" and
   * "≥ 64 × 64" bind. For a multi-row control this is the height of ONE row:
   * the floor is per target, not per widget.
   */
  touchDp: number;
  controlRows: number;
  controlHeightDp: number;
  labelHeightDp: number;
  /** label + control + the gap below, which is what consumes the screen */
  heightDp: number;
  /** `SwR-053`: a rule outcome is announced in text in BOTH profiles */
  statusInText: boolean;
  /** `SyR-221`: the Field profile additionally forbids colour-only status */
  statusNeedsShapeOrWord: boolean;
}

export function present(type: FieldType, profile: Profile): WidgetPresentation {
  const t: ProfileTokens = TOKENS[profile];
  const rows = CONTROL_ROWS[type];
  const controlHeightDp = rows * t.minTouchDp;
  const labelHeightDp = Math.ceil(t.labelDp * LINE_HEIGHT);
  return {
    type,
    profile,
    touchDp: t.minTouchDp,
    controlRows: rows,
    controlHeightDp,
    labelHeightDp,
    heightDp: labelHeightDp + controlHeightDp + t.rowGapDp,
    statusInText: true,
    statusNeedsShapeOrWord: t.statusNeedsShapeOrWord,
  };
}

/** All sixteen, which is the artefact `M3` sized. */
export function allPresentations(): WidgetPresentation[] {
  const types = Object.keys(CONTROL_ROWS) as FieldType[];
  const out: WidgetPresentation[] = [];
  for (const p of ['standard', 'field'] as Profile[]) {
    for (const ty of types) out.push(present(ty, p));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The density cost — ADR-003 §4.8's "what one widget costs".
// ---------------------------------------------------------------------------

/**
 * ⚠ AN ASSUMED VIEWPORT, LABELLED, BECAUSE THE REAL ONE IS NOT MEASURED YET.
 * `SyR-210` names "a baseline device per supported platform" — an Android one
 * and "a mid-tier iPhone of about three years' vintage" — and neither has had
 * its usable height in dp recorded anywhere in the corpus. 360 × 640 dp is a
 * conventional small-phone figure and is used ONLY so the cost can be computed
 * before the devices are in hand. **Every number derived from it is provisional
 * and must be recomputed at the bench**; the RELATIONSHIPS the tests assert —
 * that Field fits strictly fewer fields, that its grid fallback triggers at a
 * wider width — hold for any viewport, which is why those are what is asserted.
 */
export const ASSUMED_VIEWPORT_DP = { width: 360, height: 640 };

/** Chrome the form content does not get: status bar, header, action bar. */
export const ASSUMED_CHROME_DP = 160;

export function usableHeightDp(viewportHeightDp: number): number {
  return Math.max(0, viewportHeightDp - ASSUMED_CHROME_DP);
}

/**
 * How many of a given field list fit on one screen without scrolling. This is
 * the figure `SwR-093`'s "it changes how many fields fit on a screen" asserts
 * and nothing had computed.
 */
export function fieldsPerScreen(
  fields: readonly FieldDef[],
  profile: Profile,
  viewportHeightDp: number = ASSUMED_VIEWPORT_DP.height,
): number {
  let used = 0;
  let n = 0;
  const budget = usableHeightDp(viewportHeightDp);
  for (const f of fields) {
    const h = present(f.type, profile).heightDp;
    if (used + h > budget) break;
    used += h;
    n++;
  }
  return n;
}

/** The whole list's height, for the scroll cost rather than the first screen. */
export function totalHeightDp(fields: readonly FieldDef[], profile: Profile): number {
  return fields.reduce((sum, f) => sum + present(f.type, profile).heightDp, 0);
}

// ---------------------------------------------------------------------------
// SyR-221's third clause — thumb reach. ⚠ Nothing else in the spike addressed
// this, and it is a requirement, not a nicety.
// ---------------------------------------------------------------------------

/**
 * `SyR-221`: "On a phone, the actions used most often during capture **shall**
 * be reachable by the thumb of the hand holding it, **in every profile**."
 *
 * ➕ THE FRACTION IS THE AUTHOR'S MODEL, LABELLED. No requirement states a
 * reach geometry, and inventing a precise one would be false precision: the
 * honest content here is that a zone exists, that it is anchored to the BOTTOM
 * of the screen, and that "in every profile" means the zone does not shrink
 * when the Field profile makes everything bigger. 0.55 is a conventional
 * one-handed reach figure and is the thing to replace with a measurement.
 *
 * ⚠ It deliberately models only the vertical axis. The real thumb arc is also
 * horizontal — the far top corner is the unreachable one — and a one-axis model
 * would wrongly pass a control in the far corner. That is recorded rather than
 * approximated, because condition 3 is run on a device where it can be seen.
 */
export const THUMB_REACH_FRACTION = 0.55;

export function thumbZoneTopDp(viewportHeightDp: number = ASSUMED_VIEWPORT_DP.height): number {
  return viewportHeightDp - viewportHeightDp * THUMB_REACH_FRACTION;
}

/** `yDp` is the control's own top edge, measured from the top of the screen. */
export function isWithinThumbReach(
  yDp: number,
  viewportHeightDp: number = ASSUMED_VIEWPORT_DP.height,
): boolean {
  return yDp >= thumbZoneTopDp(viewportHeightDp) && yDp <= viewportHeightDp;
}

/**
 * The actions `SyR-221` means by "used most often during capture". Named here
 * so the shell cannot quietly place one outside the zone and so a reviewer can
 * disagree with the LIST rather than with scattered layout code.
 */
export const PRIMARY_CAPTURE_ACTIONS = [
  'capture-media',
  'add-repeat',
  'next-section',
  'switch-profile',
] as const;
export type PrimaryCaptureAction = (typeof PRIMARY_CAPTURE_ACTIONS)[number];

// ---------------------------------------------------------------------------
// SwR-084's repeating-section fallback, at SwR-093's "correspondingly wider
// width".
// ---------------------------------------------------------------------------

export type RepeatingPresentation = 'grid' | 'cards' | 'panels';

/**
 * ➕ A grid cell needs room for a touch target AND the content beside it, so
 * the minimum column width is taken as twice the touch floor. That multiplier
 * is the author's judgement, labelled; what is NOT a judgement is that it
 * scales with `minTouchDp`, which is what makes Field's threshold wider.
 */
export function gridMinColumnDp(profile: Profile): number {
  return TOKENS[profile].minTouchDp * 2;
}

export function gridMinWidthDp(columns: number, profile: Profile): number {
  return columns * gridMinColumnDp(profile);
}

/**
 * `SwR-084`: "Where only one is set and it cannot fit the available width, the
 * software shall fall back to stacked cards rather than force sideways
 * scrolling; the designer may override that fallback."
 *
 * `SwR-093`: "Under the Field profile the repeating-section fallback of SwR-084
 * applies at a correspondingly wider width."
 *
 * ⚠ The override is honoured, and it is the clause most likely to be dropped:
 * a designer who has overridden the fallback gets the grid and the sideways
 * scrolling they asked for. Returning `cards` regardless would be "safer" and
 * would be wrong.
 */
export function repeatingPresentation(
  chosen: RepeatingPresentation,
  columns: number,
  profile: Profile,
  availableWidthDp: number = ASSUMED_VIEWPORT_DP.width,
  designerOverridesFallback: boolean = false,
): RepeatingPresentation {
  if (chosen !== 'grid') return chosen;
  if (designerOverridesFallback) return 'grid';
  return gridMinWidthDp(columns, profile) <= availableWidthDp ? 'grid' : 'cards';
}

// ------------------------------------- SC-06: what a screen reader is told
//
// 🔴 THE GAP THIS CLOSES, which is not the one the plan expected.
//
// `widgets.tsx` already announces required and invalid IN TEXT — `StatusLine`
// exists precisely so `SwR-053`'s "a rule outcome is announced in text" and
// `SyR-221` Field's "status never by colour alone" are honoured. ✅ That part
// was done.
//
// ✕ What was NOT done is BINDING that status to the control. The field's
// container is `accessible={false}` and the status lines are sibling `Text`
// nodes, so a worker moving between CONTROLS with TalkBack or VoiceOver hears
// `field.label` and nothing else — **the invalid status is a separate focus
// stop they may never land on**. A sighted worker sees the line; a screen
// reader user does not hear it.
//
// ➕ So the control's own label carries the state. ⚠ This is NOT duplication
// of the visible status line: they are two channels for two audiences, and
// removing either leaves one audience without the rule outcome.
//
// ⚠ AND IT IS STILL NOT CONDITION 3. Brief §5 row 3 asks for "TalkBack and
// VoiceOver" and "a manual audit of the spike form" ON A DEVICE. This makes
// the audit able to pass; it does not perform it. *Review finding `M5` was
// that 26 token tests had been read as condition 3 being "substantially
// done" — this is design-time preparation, and says so.*

/** The field state a screen-reader label needs, narrowed to what it reads. */
export interface AnnouncedState {
  required: boolean;
  valid: boolean;
  /** `SwR-051`'s translatable message, where a rule produced one. */
  message?: string | null;
}

/**
 * What TalkBack or VoiceOver says when the control itself takes focus.
 *
 * ➕ Order is deliberate: **label, then requiredness, then the failure, then
 * why.** A reader hears the identity first and the problem before the detail,
 * which is the order a sighted worker reads the same column in.
 */
export function accessibleFieldLabel(
  label: string,
  state: AnnouncedState,
): string {
  const parts: string[] = [label];
  if (state.required) parts.push('required');
  if (!state.valid) {
    parts.push('invalid');
    // ⚠ The message is appended only when the field is INVALID. A message on a
    // valid field is guidance, and reading "invalid" beside it would announce
    // a failure that has not happened.
    const m = state.message;
    if (typeof m === 'string' && m.trim().length > 0) parts.push(m.trim());
  }
  return parts.join(', ');
}

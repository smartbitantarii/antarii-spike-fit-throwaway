/**
 * Tests for the two `SyR-221` profiles and `SwR-093`'s switch — step 1b.
 * Run: node --test src/ui/profile.test.ts
 *
 * ⚠ The contrast tests COMPUTE the ratio rather than restating a figure
 * someone checked once. A palette is easy to change and a hand-checked ratio
 * does not survive the change; `SyR-141`'s WCAG 2.2 AA conformance and
 * `SwR-053`'s publish gate both need a fact, not a note.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES,
  TOKENS,
  ProfilePreference,
  contrastRatio,
  relativeLuminance,
  floorFor,
  statusPresentation,
  LARGE_TEXT_DP,
  type Profile,
  type StatusKind,
} from './profile.ts';

// ---------------------------------------------------------- the contrast maths

test('the contrast maths is right before anything is judged by it', () => {
  // WCAG's own extremes: black on white is exactly 21:1.
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  // Symmetric, since the ratio is defined on the lighter and darker of the two.
  assert.equal(contrastRatio('#1a1a1a', '#ffffff'), contrastRatio('#ffffff', '#1a1a1a'));
  // The sRGB transfer, not a linear average: 50% grey is NOT luminance 0.5.
  assert.ok(relativeLuminance('#808080') < 0.25, 'the channel transfer is not being applied');
  assert.throws(() => contrastRatio('#fff', '#ffffff'), /not a #rrggbb colour/);
});

// ------------------------------------------------- SyR-221's floors, both profiles

test('SyR-221: the touch floors are 48 and 64 dp, and Field is strictly larger', () => {
  assert.equal(TOKENS.standard.minTouchDp, 48);
  assert.equal(TOKENS.field.minTouchDp, 64);
  assert.ok(TOKENS.field.minTouchDp > TOKENS.standard.minTouchDp);
});

test('SyR-221: the contrast floors are 4.5/3 for Standard and 7/4.5 for Field', () => {
  assert.deepEqual(TOKENS.standard.contrast, { normalText: 4.5, largeTextAndOutline: 3 });
  assert.deepEqual(TOKENS.field.contrast, { normalText: 7, largeTextAndOutline: 4.5 });
  // Field is at or above Standard on both legs — "each at or above the
  // SyR-141 accessibility floor", and Field is the stricter profile.
  assert.ok(TOKENS.field.contrast.normalText > TOKENS.standard.contrast.normalText);
  assert.ok(
    TOKENS.field.contrast.largeTextAndOutline > TOKENS.standard.contrast.largeTextAndOutline,
  );
});

test('SyR-221: every colour pair actually used MEETS its own floor, computed', () => {
  for (const p of PROFILES) {
    const t = TOKENS[p];

    const label = contrastRatio(t.text, t.background);
    assert.ok(
      label >= floorFor(t, t.labelDp),
      `${p}: label ${t.labelDp}dp is ${label.toFixed(2)}:1, floor ${floorFor(t, t.labelDp)}`,
    );

    const value = contrastRatio(t.text, t.background);
    assert.ok(
      value >= floorFor(t, t.valueDp),
      `${p}: value ${t.valueDp}dp is ${value.toFixed(2)}:1, floor ${floorFor(t, t.valueDp)}`,
    );

    // "control outlines" take the large-text floor — SyR-221 binds the two
    // together in one clause, which is why `floorFor` is not consulted here.
    const outline = contrastRatio(t.outline, t.background);
    assert.ok(
      outline >= t.contrast.largeTextAndOutline,
      `${p}: outline is ${outline.toFixed(2)}:1, floor ${t.contrast.largeTextAndOutline}`,
    );

    // Status text is normal-size text, so it takes the normal-text floor.
    for (const k of ['required', 'invalid', 'valid'] as StatusKind[]) {
      const s = statusPresentation(p, k);
      const r = contrastRatio(s.colour, t.background);
      assert.ok(
        r >= t.contrast.normalText,
        `${p}/${k}: ${s.colour} is ${r.toFixed(2)}:1, floor ${t.contrast.normalText}`,
      );
    }
  }
});

test("the Field outline is not left on a hair's breadth above its floor", () => {
  // ⚠ This is why Field's outline differs from Standard's. #767676 is 4.54:1,
  // which clears Field's 4.5:1 by 0.04 — a margin no palette change would
  // survive, and a test that passes by 0.04 is not evidence of anything.
  const standardOutlineUnderFieldFloor = contrastRatio('#767676', '#ffffff');
  assert.ok(standardOutlineUnderFieldFloor < 4.6, 'the premise of this test has changed');
  const actual = contrastRatio(TOKENS.field.outline, TOKENS.field.background);
  assert.ok(
    actual >= TOKENS.field.contrast.largeTextAndOutline + 1,
    `Field outline is ${actual.toFixed(2)}:1 — too close to its 4.5:1 floor`,
  );
});

test("WCAG's large-text threshold is applied, not assumed away", () => {
  const t = TOKENS.standard;
  assert.equal(floorFor(t, LARGE_TEXT_DP), t.contrast.largeTextAndOutline);
  assert.equal(floorFor(t, LARGE_TEXT_DP - 1), t.contrast.normalText);
  // ⚠ Nothing in either profile is large text, so every text pair in this
  // spike is held to the NORMAL-text floor. Asserted so that a later size
  // bump past 24dp cannot quietly relax the requirement.
  assert.ok(t.valueDp < LARGE_TEXT_DP);
  assert.ok(TOKENS.field.valueDp < LARGE_TEXT_DP);
});

// ------------------------------------- status: shape or word, and SwR-053's floor

test('SyR-221 Field: status is never carried by colour alone', () => {
  for (const k of ['required', 'invalid', 'valid'] as StatusKind[]) {
    const s = statusPresentation('field', k);
    assert.ok(s.glyph || s.word, `field/${k} has neither a shape nor a word`);
  }
  assert.equal(TOKENS.field.statusNeedsShapeOrWord, true);
});

test('SwR-053 is a floor under BOTH profiles: a rule outcome is announced in text', () => {
  // ⚠ The easy misreading is that SyR-221's Field clause means Standard may
  // use colour alone. SwR-053 forbids it for a rule outcome in any profile:
  // "colour or position shall never be the only carrier of meaning in a rule
  // outcome (a required or invalid state is also announced in text)".
  for (const p of PROFILES) {
    for (const k of ['required', 'invalid'] as StatusKind[]) {
      const s = statusPresentation(p, k);
      assert.ok(s.word.length > 0, `${p}/${k} has no word, and SwR-053 requires text`);
    }
  }
  assert.equal(TOKENS.standard.statusNeedsShapeOrWord, false, "SyR-221 does not demand it of Standard");
});

// ------------------------------------------------------- SwR-093's switch

test('SwR-093: the worker switches in either direction, at any time', () => {
  const pref = new ProfilePreference('standard');
  assert.equal(pref.current(), 'standard', 'starts at the tenant default');
  pref.switchTo('field');
  assert.equal(pref.current(), 'field');
  pref.switchTo('standard');
  assert.equal(pref.current(), 'standard', 'in EITHER direction — not a one-way upgrade');
  assert.deepEqual(pref.history(), ['standard', 'field', 'standard']);
});

test('SwR-093: the tenant default is where it starts, either way round', () => {
  assert.equal(new ProfilePreference('field').current(), 'field');
  assert.equal(new ProfilePreference('standard').current(), 'standard');
});

test('SwR-093: never below the Standard floor — a guess is refused, not clamped', () => {
  const pref = new ProfilePreference('field');
  assert.throws(
    () => pref.switchTo('tiny' as Profile),
    /Standard floor/,
    'an undefined profile must be refused',
  );
  assert.equal(pref.current(), 'field', 'a refused switch changes nothing');
  // Standard IS the floor, so the type admits nothing below it.
  assert.deepEqual([...PROFILES], ['standard', 'field']);
});

test('SwR-093: the switch is a device preference — it cannot reach captured data', () => {
  // ⚠ Asserted STRUCTURALLY. "affects no captured data, and is not recorded on
  // the instance" are properties of the shape: ProfilePreference holds a
  // profile and a log of profiles, and has no reference to answers or to an
  // instance, so there is nothing for it to write to. A behavioural test could
  // only show that one path does not write; this shows that none can.
  const pref = new ProfilePreference('standard');
  pref.switchTo('field');
  const own = Object.getOwnPropertyNames(pref);
  assert.deepEqual(own.sort(), ['log', 'profile'], 'ProfilePreference grew a new field');
  for (const v of pref.history()) {
    assert.ok((PROFILES as readonly string[]).includes(v), 'the log holds profiles and nothing else');
  }
});

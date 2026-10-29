/**
 * Tests for the sixteen widget presentations — step 1b.
 * Run: node --test src/ui/presentation.test.ts
 *
 * ⚠ WHAT IS ASSERTED AND WHAT IS ONLY REPORTED. The absolute dp figures depend
 * on `ASSUMED_VIEWPORT_DP`, which is an assumption and labelled as one in
 * `presentation.ts`: `SyR-210`'s two baseline devices have never had their
 * usable height recorded anywhere in the corpus. So the tests assert the
 * RELATIONSHIPS, which hold at any viewport — Field costs strictly more per
 * widget, fits strictly fewer fields, and triggers `SwR-084`'s fallback at a
 * wider width — and the absolute numbers are printed for §8's record, where
 * they must be recomputed at the bench.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spikeForm, USED_TYPES, DENSE_FIELD_COUNT } from '../form/spike-form.ts';
import { TOKENS, PROFILES, type Profile } from './profile.ts';
import {
  accessibleFieldLabel,
  present,
  allPresentations,
  fieldsPerScreen,
  totalHeightDp,
  gridMinWidthDp,
  gridMinColumnDp,
  repeatingPresentation,
  usableHeightDp,
  ASSUMED_VIEWPORT_DP,
  thumbZoneTopDp,
  isWithinThumbReach,
  PRIMARY_CAPTURE_ACTIONS,
} from './presentation.ts';
import type { FieldType } from '../form/model.ts';

const dense = spikeForm.fields.filter((f) => f.section === 'dense');
const repeats = spikeForm.fields.filter((f) => f.section === 'repeats');

// --------------------------------------------- M3's arithmetic, held to its word

test("M3's count is exactly right: eight types × two profiles = sixteen", () => {
  assert.equal(USED_TYPES.length, 8, "M3 says the form uses eight of the palette's twenty-one");
  const all = allPresentations();
  assert.equal(all.length, 16, 'sixteen widget presentations rather than forty-two');
  // Every one of the eight appears in both profiles, and nothing else does.
  for (const p of PROFILES) {
    const inProfile = all.filter((a) => a.profile === p).map((a) => a.type).sort();
    assert.deepEqual(inProfile, [...USED_TYPES].sort(), `${p} does not cover the eight exactly`);
  }
});

test('the dense section really does cycle all eight types', () => {
  assert.equal(dense.length, DENSE_FIELD_COUNT);
  const seen = new Set(dense.map((f) => f.type));
  assert.equal(seen.size, 8, 'the density figure must be measured against a mix, not one type');
});

// ------------------------------------------------- SyR-221's floors, per widget

test('SyR-221: every one of the sixteen meets its profile touch floor', () => {
  for (const a of allPresentations()) {
    const floor = TOKENS[a.profile].minTouchDp;
    assert.ok(
      a.touchDp >= floor,
      `${a.profile}/${a.type}: touch target ${a.touchDp}dp is below the ${floor}dp floor`,
    );
    // A multi-row control's floor binds EACH row, not the widget total — so a
    // tall widget may not be used to excuse a short target inside it.
    assert.equal(a.controlHeightDp, a.controlRows * floor);
  }
});

// -------------------------------- the cost: ADR-003 §4.8's "what one widget costs"

test('§4.8: the Field profile costs strictly more for EVERY type, with no exception', () => {
  for (const ty of USED_TYPES) {
    const s = present(ty, 'standard');
    const f = present(ty, 'field');
    assert.ok(
      f.heightDp > s.heightDp,
      `${ty}: Field (${f.heightDp}dp) does not cost more than Standard (${s.heightDp}dp)`,
    );
  }
});

test('SwR-093: the Field profile fits strictly fewer fields on a screen', () => {
  const s = fieldsPerScreen(dense, 'standard');
  const f = fieldsPerScreen(dense, 'field');
  assert.ok(s > 0 && f > 0, 'neither profile fits anything — the viewport assumption is broken');
  assert.ok(
    f < s,
    `SwR-093 says the profile "changes how many fields fit on a screen": Standard ${s}, Field ${f}`,
  );
  // Holds at any viewport, which is the point of asserting the relationship.
  for (const h of [480, 640, 800, 1024]) {
    assert.ok(
      fieldsPerScreen(dense, 'field', h) < fieldsPerScreen(dense, 'standard', h),
      `at ${h}dp the relationship fails`,
    );
  }
});

test('a taller screen never fits fewer fields', () => {
  for (const p of PROFILES) {
    let last = -1;
    for (const h of [400, 500, 600, 700, 800, 900]) {
      const n = fieldsPerScreen(dense, p, h);
      assert.ok(n >= last, `${p}: ${h}dp fits ${n}, less than the shorter screen's ${last}`);
      last = n;
    }
  }
});

// --------------------------- SwR-084's fallback at SwR-093's wider width

test("SwR-093: SwR-084's fallback triggers at a correspondingly WIDER width under Field", () => {
  const cols = repeats.length;
  assert.ok(cols > 0, 'the spike form has no repeating section to grid');
  const s = gridMinWidthDp(cols, 'standard');
  const f = gridMinWidthDp(cols, 'field');
  assert.ok(f > s, `Field's grid threshold (${f}dp) must exceed Standard's (${s}dp)`);
  // It scales with the touch floor, which is WHY it is wider — not a constant
  // someone picked to make this test pass.
  assert.equal(gridMinColumnDp('standard'), TOKENS.standard.minTouchDp * 2);
  assert.equal(gridMinColumnDp('field'), TOKENS.field.minTouchDp * 2);
});

test('SwR-084: a grid that cannot fit falls back to stacked cards, not sideways scrolling', () => {
  const cols = repeats.length;
  const narrow = gridMinWidthDp(cols, 'standard') - 1;
  assert.equal(repeatingPresentation('grid', cols, 'standard', narrow), 'cards');
  const wide = gridMinWidthDp(cols, 'field');
  assert.equal(repeatingPresentation('grid', cols, 'field', wide), 'grid');
});

test('SwR-084: the designer MAY override the fallback, and the override is honoured', () => {
  // ⚠ The clause most likely to be dropped. Returning cards regardless would
  // look safer and would contradict "the designer may override that fallback".
  const cols = repeats.length;
  const tooNarrow = 1;
  assert.equal(repeatingPresentation('grid', cols, 'field', tooNarrow), 'cards');
  assert.equal(repeatingPresentation('grid', cols, 'field', tooNarrow, true), 'grid');
});

test('⚠ THE FINDING: on a baseline-width phone the two profiles disagree about the grid', () => {
  // This is 1b's substantive result rather than a floor check. At the assumed
  // 360dp width the spike form's three-column repeating section fits a grid
  // under Standard (288dp) and does NOT under Field (384dp), so the SAME form
  // presents its repeating section DIFFERENTLY depending on a preference the
  // worker can change at any time (SwR-093). Nothing in the corpus says that
  // out loud, and it follows from SwR-093's "correspondingly wider width"
  // meeting SwR-084's fallback on a phone-width screen.
  const cols = repeats.length;
  const w = ASSUMED_VIEWPORT_DP.width;
  assert.equal(repeatingPresentation('grid', cols, 'standard', w), 'grid');
  assert.equal(repeatingPresentation('grid', cols, 'field', w), 'cards');
  // ⚠ Provisional on the assumed width. What is NOT provisional is that a
  // width exists where the profiles disagree, since Field's threshold is
  // strictly wider — so the effect is real whatever the devices measure.
  assert.ok(gridMinWidthDp(cols, 'field') > gridMinWidthDp(cols, 'standard'));
});

test('SwR-084: cards and panels are returned untouched — the fallback is grid-only', () => {
  for (const p of PROFILES) {
    assert.equal(repeatingPresentation('cards', 3, p, 1), 'cards');
    assert.equal(repeatingPresentation('panels', 3, p, 1), 'panels');
  }
});

// ------------------------------------------------- SyR-221's thumb-reach clause

test('SyR-221: the thumb zone is anchored to the bottom and does not shrink per profile', () => {
  const h = 640;
  const top = thumbZoneTopDp(h);
  assert.ok(top > 0 && top < h, 'the zone must be a band, not the whole screen or none of it');
  assert.equal(isWithinThumbReach(h - 1, h), true, 'the bottom edge is reachable');
  assert.equal(isWithinThumbReach(0, h), false, 'the top of the screen is not');
  assert.equal(isWithinThumbReach(top, h), true, 'the boundary is inclusive');
  assert.equal(isWithinThumbReach(top - 1, h), false);
  // ⚠ "in every profile" — the zone is a property of the HAND, not of the
  // profile, so making controls bigger must not shrink the reachable band.
  // Nothing here takes a profile, which is how that is guaranteed.
  assert.equal(thumbZoneTopDp(h), top);
});

test('SyR-221: the actions that must be reachable are named, not left implied', () => {
  assert.ok(PRIMARY_CAPTURE_ACTIONS.length > 0);
  // SwR-093's switch is one of them: a worker who must leave capture to reach
  // it cannot "switch at any time" in any practical sense.
  assert.ok(
    (PRIMARY_CAPTURE_ACTIONS as readonly string[]).includes('switch-profile'),
    "SwR-093's switch must be thumb-reachable or it is not switchable during capture",
  );
});

// ------------------------------------------------------- the record for §8

test("the cost table, for §8's record — printed, not asserted", () => {
  const lines: string[] = [];
  lines.push('');
  lines.push('  1b — widget cost, per presentation (dp)');
  lines.push('  ⚠ PROVISIONAL: computed against an ASSUMED ' +
    ASSUMED_VIEWPORT_DP.width + '×' + ASSUMED_VIEWPORT_DP.height +
    'dp viewport, usable height ' + usableHeightDp(ASSUMED_VIEWPORT_DP.height) +
    'dp. SyR-210 devices not yet measured — recompute at the bench.');
  lines.push('  ' + 'type'.padEnd(15) + 'Standard'.padStart(10) + 'Field'.padStart(10) + 'cost'.padStart(10));
  for (const ty of USED_TYPES) {
    const s = present(ty as FieldType, 'standard').heightDp;
    const f = present(ty as FieldType, 'field').heightDp;
    const pct = Math.round(((f - s) / s) * 100);
    lines.push('  ' + ty.padEnd(15) + String(s).padStart(10) + String(f).padStart(10) + ('+' + pct + '%').padStart(10));
  }
  lines.push('');
  for (const p of PROFILES as readonly Profile[]) {
    lines.push(
      '  ' + p.padEnd(10) +
      ' first screen: ' + fieldsPerScreen(dense, p) + '/' + dense.length + ' dense fields' +
      ' · whole form: ' + totalHeightDp(spikeForm.fields, p) + 'dp' +
      ' · repeating grid needs ' + gridMinWidthDp(repeats.length, p) + 'dp',
    );
  }
  lines.push('');
  console.log(lines.join('\n'));

  // The one thing asserted here: the table was actually produced.
  assert.ok(lines.length > 10);
});

// ----------------------------------------- SC-06: the screen-reader label

test('SwR-053: a screen reader hears the rule outcome, not just the label', () => {
  // 🔴 The gap this closes: the visible StatusLine is a SIBLING node, so a
  // worker moving between controls never lands on it. The control's own
  // label has to carry the outcome.
  assert.equal(
    accessibleFieldLabel('Meter reading', { required: true, valid: false, message: 'must be 0 to 100' }),
    'Meter reading, required, invalid, must be 0 to 100',
  );
});

test('a valid field announces nothing it has not earned', () => {
  assert.equal(
    accessibleFieldLabel('Notes', { required: false, valid: true }),
    'Notes',
  );
  assert.equal(
    accessibleFieldLabel('Notes', { required: true, valid: true }),
    'Notes, required',
  );
});

test('⚠ a message on a VALID field is not announced as a failure', () => {
  // Guidance is not a rule outcome. Reading "invalid" beside it would
  // announce a failure that has not happened.
  assert.equal(
    accessibleFieldLabel('Serial', { required: false, valid: true, message: 'format: AB-1234' }),
    'Serial',
  );
});

test('an empty or whitespace message does not leave a dangling comma', () => {
  assert.equal(
    accessibleFieldLabel('Reading', { required: false, valid: false, message: '   ' }),
    'Reading, invalid',
  );
  assert.equal(
    accessibleFieldLabel('Reading', { required: false, valid: false, message: null }),
    'Reading, invalid',
  );
  assert.equal(
    accessibleFieldLabel('Reading', { required: false, valid: false }),
    'Reading, invalid',
  );
});

test('the order is identity, then requiredness, then failure, then why', () => {
  // A reader hears what it is before what is wrong with it — the order a
  // sighted worker reads the same column in.
  const s = accessibleFieldLabel('X', { required: true, valid: false, message: 'why' });
  const parts = s.split(', ');
  assert.deepEqual(parts, ['X', 'required', 'invalid', 'why']);
});

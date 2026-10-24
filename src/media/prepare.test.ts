/**
 * Tests for S5's compression and stamping, and for leg (iii)'s first subject.
 * Run: node --test src/media/prepare.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_LEVELS,
  LONG_EDGE_PX,
  FLOOR,
  SHIPPED_LAYERS,
  effectiveMaximum,
  effectiveDefault,
  resolveForCapture,
  planCapture,
  stamp,
  withServerReceipt,
  clockDriftMs,
  LOCATION_UNAVAILABLE,
  type QualityLayers,
  type QualityLevel,
  LOCATION_DEADLINE_MS,
} from './prepare.ts';
import { TARGET_MS } from '../harness/harness.ts';
import {
  mintOurSessionId,
  fromPlatform,
  legIiiFirstSubjectVerdict,
  NO_PLATFORM_SESSION_REASON,
} from './transfer-session.ts';

// --------------------------------------------- SwR-086's levels and N-C4's pixels

test('SwR-086: the closed list is exactly three levels, weakest first', () => {
  assert.deepEqual([...QUALITY_LEVELS], ['standard', 'high-detail', 'full']);
  assert.equal(FLOOR, 'standard', 'Standard is the floor');
});

test("N-C4's figures are the requirement's, not invented", () => {
  assert.equal(LONG_EDGE_PX.standard, 1600);
  assert.equal(LONG_EDGE_PX['high-detail'], 3000);
  // ⚠ `full` is null, not a large number: "what the device's camera natively
  // produces". A number here would silently downscale a native capture.
  assert.equal(LONG_EDGE_PX.full, null);
});

// ------------------------------------------------- the layered maximums

test('SwR-086: the shipped layers are the requirement\'s own', () => {
  assert.equal(SHIPPED_LAYERS.platformCeiling, 'full');
  assert.equal(SHIPPED_LAYERS.tenantMaximum, 'high-detail');
  assert.equal(SHIPPED_LAYERS.tenantDefault, 'standard');
  assert.equal(effectiveMaximum(SHIPPED_LAYERS), 'high-detail', 'the tenant maximum binds');
  assert.equal(effectiveDefault(SHIPPED_LAYERS), 'standard');
});

test('SwR-086: each layer is at or below the one above, and a higher one is CLAMPED', () => {
  // A field maximum above the tenant's is not a permission — the requirement
  // words every layer as "at or below" the one above it.
  const layers: QualityLayers = { ...SHIPPED_LAYERS, fieldMaximum: 'full' };
  assert.equal(effectiveMaximum(layers), 'high-detail', 'the field cannot exceed the tenant');

  // And a tenant maximum above the platform ceiling is clamped too.
  const tight: QualityLayers = {
    platformCeiling: 'standard',
    tenantMaximum: 'full',
    tenantDefault: 'standard',
  };
  assert.equal(effectiveMaximum(tight), 'standard');
});

test('SwR-086: a field maximum BELOW the tenant maximum is honoured', () => {
  const layers: QualityLayers = { ...SHIPPED_LAYERS, fieldMaximum: 'standard' };
  assert.equal(effectiveMaximum(layers), 'standard');
});

test('SwR-086: a field default above the effective maximum is clamped to it', () => {
  const layers: QualityLayers = {
    ...SHIPPED_LAYERS,
    fieldMaximum: 'standard',
    fieldDefault: 'full',
  };
  assert.equal(effectiveDefault(layers), 'standard');
});

test('SwR-086: the tenant default applies to a field that sets none', () => {
  const layers: QualityLayers = { ...SHIPPED_LAYERS, tenantDefault: 'high-detail' };
  assert.equal(effectiveDefault(layers), 'high-detail');
  assert.equal(
    effectiveDefault({ ...layers, fieldDefault: 'standard' }),
    'standard',
    "the field's own default wins where it sets one",
  );
});

test('SwR-086: Standard is the floor at EVERY layer, however the layers are set', () => {
  // Nothing below Standard exists in the list, so the floor is tested by
  // driving every layer to the weakest and checking the result is Standard
  // rather than something weaker leaking through.
  const atFloor: QualityLayers = {
    platformCeiling: 'standard',
    tenantMaximum: 'standard',
    fieldMaximum: 'standard',
    fieldDefault: 'standard',
    tenantDefault: 'standard',
  };
  assert.equal(effectiveMaximum(atFloor), 'standard');
  assert.equal(effectiveDefault(atFloor), 'standard');
});

// ------------------------------------------------- the worker's single-capture raise

test('SwR-086: the worker may raise a single capture, up to the field maximum', () => {
  const layers: QualityLayers = { ...SHIPPED_LAYERS, fieldMaximum: 'high-detail' };
  assert.deepEqual(resolveForCapture(layers), { level: 'standard', raised: false });
  assert.deepEqual(resolveForCapture(layers, 'high-detail'), {
    level: 'high-detail',
    raised: true,
  });
});

test('SwR-086: never above the field maximum', () => {
  const layers: QualityLayers = { ...SHIPPED_LAYERS, fieldMaximum: 'high-detail' };
  assert.throws(() => resolveForCapture(layers, 'full'), /never above the field maximum/);
});

test('SwR-086: a raise is one-directional — a request to LOWER is refused', () => {
  // ➕ The author's reading, labelled in the source: the requirement grants a
  // raise and is silent on a lowering, and a silent downgrade of evidence is
  // the worse failure given the floor's own reasoning.
  const layers: QualityLayers = { ...SHIPPED_LAYERS, tenantDefault: 'high-detail' };
  assert.throws(() => resolveForCapture(layers, 'standard'), /not to lower it/);
});

test('the raise is per capture: resolving again returns to the level in force', () => {
  const layers: QualityLayers = { ...SHIPPED_LAYERS, fieldMaximum: 'high-detail' };
  resolveForCapture(layers, 'high-detail');
  assert.equal(resolveForCapture(layers).level, 'standard', 'the raise must not persist');
});

// ------------------------------------------------------- SwR-102's stamp

test('SwR-102: the stamp carries the time, the level used, and the location', () => {
  const s = stamp('2026-10-16T09:00:00.000Z', 'high-detail', {
    latitude: 51.5,
    longitude: -0.1,
    accuracyMetres: 8,
  });
  assert.equal(s.deviceTime, '2026-10-16T09:00:00.000Z');
  assert.equal(s.levelUsed, 'high-detail', '"the level used recorded"');
  assert.equal(s.longEdgePx, 3000);
  assert.equal(s.location!.accuracyMetres, 8, 'the ACCURACY is stamped, not just the position');
  assert.equal(s.locationNote, null);
});

test('SwR-102: no location means "location unavailable" and the capture PROCEEDS', () => {
  // ⚠ The requirement is explicit that capture must not fail for want of a
  // fix. A capture that threw on a denied permission would lose evidence to a
  // permission prompt.
  const s = stamp('2026-10-16T09:00:00.000Z', 'standard', null);
  assert.equal(s.location, null);
  assert.equal(s.locationNote, LOCATION_UNAVAILABLE);
  assert.equal(s.locationNote, 'location unavailable', "the requirement's own words");
  assert.equal(s.levelUsed, 'standard', 'and the rest of the stamp is intact');
});

test('SwR-102: location is requested ONCE, not continuously', () => {
  const plan = planCapture(SHIPPED_LAYERS);
  assert.equal(plan.requestLocationOnce, true);
  assert.equal(plan.level, 'standard');
  assert.equal(plan.longEdgePx, 1600, 'the plan carries the pixels the adapter must resize to');
});

test('SwR-102: the server receipt time makes drift visible, and SwR-123 keeps the stamp immutable', () => {
  const s = stamp('2026-10-16T09:00:00.000Z', 'standard', null);
  assert.equal(s.serverReceiptTime, null, 'absent until synchronisation');
  assert.equal(clockDriftMs(s), null);

  const acked = withServerReceipt(s, '2026-10-16T09:00:04.500Z');
  assert.equal(acked.serverReceiptTime, '2026-10-16T09:00:04.500Z');
  assert.equal(clockDriftMs(acked), 4500, 'drift is visible rather than hidden');
  // SwR-123: "Stamps are part of the response and immutable with it" — so the
  // receipt produces a NEW stamp and the original is untouched.
  assert.equal(s.serverReceiptTime, null, 'the original stamp was mutated');
  assert.throws(() => withServerReceipt(acked, '2026-10-16T10:00:00.000Z'), /already recorded/);
});

test('a negative drift is reported as negative, not hidden', () => {
  // A device clock ahead of the server is drift too, and the point is that it
  // is visible. Clamping at zero would hide exactly half the cases.
  const s = withServerReceipt(
    stamp('2026-10-16T09:00:10.000Z', 'standard', null),
    '2026-10-16T09:00:00.000Z',
  );
  assert.equal(clockDriftMs(s), -10000);
});

// --------------------------------- leg (iii)'s first subject, answered honestly

test('LEG (iii): there is no platform transfer session identifier to be stable', () => {
  const ours = mintOurSessionId('a1b2c3d4e5f6', 1_760_000_000_000);
  assert.equal(ours.provenance, 'ours');
  assert.equal(ours.because, NO_PLATFORM_SESSION_REASON);

  const v = legIiiFirstSubjectVerdict(ours);
  // ⚠ NOT a pass. The cell asks about the PLATFORM's identifier; answering it
  // with one we minted would be the same class of error this initiative's
  // review caught twice — an unrelated fact excusing the thing under test.
  assert.equal(v.verdict, 'Not established');
  assert.match(v.reason, /no platform transfer session identifier exists/);
  assert.match(v.reason, /persisted multipart session/, 'the reason must say what DOES carry it');
});

test('the verdict becomes a pass only if a platform ever supplies one', () => {
  const p = fromPlatform('urlsession-abc', 'iOS returned its background session identifier');
  assert.equal(legIiiFirstSubjectVerdict(p).verdict, 'Passes');
});

test('our session id is minted once and is not a fresh value each call', () => {
  // The whole value is that it is the SAME identifier after the update, so a
  // generator that varied per call would silently defeat its own purpose.
  const a = mintOurSessionId('a1b2c3d4', 1000);
  const b = mintOurSessionId('a1b2c3d4', 1000);
  assert.equal(a.id, b.id, 'the same inputs must give the same id');
  assert.notEqual(mintOurSessionId('a1b2c3d5', 1000).id, a.id);
  assert.throws(() => mintOurSessionId('short', 1000), /entropy/);
});

test('SwR-102: a position with no accuracy keeps the position and shows the absence', () => {
  // ⚠ expo-location declares `accuracy: number | null`, and SwR-102 pairs
  // location with its accuracy without saying what a position without one is.
  // Dropping the fix would discard a real position, so it is kept and the
  // absence is visible. Recorded as an open point, not decided here.
  const s = stamp('2026-10-16T09:00:00.000Z', 'standard', {
    latitude: 51.5,
    longitude: -0.1,
    accuracyMetres: null,
  });
  assert.equal(s.location!.latitude, 51.5, 'the position must not be discarded');
  assert.equal(s.location!.accuracyMetres, null);
  assert.equal(s.locationNote, null, 'this is NOT "location unavailable" — there is a location');
});

test('SwR-102’s location deadline fits inside the budget SwR-100 gives the capture', () => {
  /**
   * 🔴 THE POINT IS THE RELATIONSHIP BETWEEN TWO CONSTANTS, NOT EITHER NUMBER.
   * `SwR-100` puts the capture, *“including … stamping (SwR-102)”*, under 2 s,
   * and the location wait sits inside that. So the deadline is checked against
   * the budget it has to live in — a deadline at or above it could not be met
   * by any pipeline, however fast, and asserting `=== 1000` would only restate
   * the constant rather than test anything.
   *
   * ➕ The 500 ms floor comes from the measurement: the pipeline's median on
   * the Galaxy A35 5G was ~265 ms and its slowest sampled iteration ~1248 ms,
   * so a deadline leaving less than half a second would make the budget
   * unreachable in practice while still being arithmetically “inside” it.
   */
  assert.ok(
    LOCATION_DEADLINE_MS > 0,
    'a non-positive deadline would stamp every photograph location unavailable',
  );
  assert.ok(
    LOCATION_DEADLINE_MS <= TARGET_MS.S5 - 500,
    'the deadline (' + LOCATION_DEADLINE_MS + ' ms) must leave at least 500 ms of S5’s ' +
      TARGET_MS.S5 + ' ms budget for the pipeline itself',
  );
});

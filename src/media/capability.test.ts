/**
 * Tests for the condition-4 probe judgements.
 *
 * ⚠ ONLY THE PURE HALF IS TESTED, and that is honest rather than convenient:
 * `probeVideo` drives the platform's recorder and cannot run off a device.
 * **The judgement is where a probe gets a verdict wrong**, so it is the half
 * worth testing — and it lives here precisely so that it can be.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  judgeSignatureStroke,
  judgeVideoAsset,
  NOT_PROBED_TODAY,
} from './capability.ts';

/** A stroke that actually moves, as a real finger would. */
function stroke(n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: 10 + i * 3, y: 20 + (i % 7) * 4 }));
}

// ----------------------------------------------------------------- signature

test('a real stroke establishes the route', () => {
  const r = judgeSignatureStroke(stroke(40));
  assert.equal(r.verdict, 'route-exists');
  assert.match(r.detail, /40 points/);
});

test('🔴 no points at all is the ONLY signature outcome that fails the axis', () => {
  // `PanResponder` delivering nothing is the framework offering no route,
  // which is what SB-009 says fails condition 4. Everything else is the
  // operator or the hardware, and neither fails it.
  assert.equal(judgeSignatureStroke([]).verdict, 'no-route');
});

test('⚠ a tap is NOT a signature, and must not pass as one', () => {
  // A probe that passed on two points would report a capability from a stray
  // touch. *The minimum exists so the verdict means something.*
  assert.equal(judgeSignatureStroke(stroke(2)).verdict, 'cancelled');
  assert.equal(judgeSignatureStroke(stroke(11)).verdict, 'cancelled');
  assert.equal(judgeSignatureStroke(stroke(12)).verdict, 'route-exists');
});

test('⚠ a finger held still is refused even with many points', () => {
  // Many points inside an 8x8 box is a resting finger and a ticking clock.
  // A count alone would pass it, which is why the bounding box is checked too.
  const still = Array.from({ length: 60 }, () => ({ x: 100, y: 100 }));
  const r = judgeSignatureStroke(still);
  assert.equal(r.verdict, 'cancelled');
  assert.match(r.detail, /did not move/);
});

// --------------------------------------------------------------------- video

test('🔴 a STILL must not pass as video — `duration` is the discriminator', () => {
  // The same launchCameraAsync call serves photographs, so a route that handed
  // back an image would otherwise pass condition 4's video leg. expo-image-
  // picker gives `duration` as null on an image asset.
  const still = { uri: 'file:///x.jpg', duration: null, width: 4000, height: 3000 };
  const r = judgeVideoAsset(still);
  assert.equal(r.verdict, 'no-route');
  assert.match(r.detail, /a still, not a recording/);
});

test('a recording with a duration establishes the route', () => {
  const clip = { uri: 'file:///x.mp4', duration: 3200, width: 1920, height: 1080 };
  const r = judgeVideoAsset(clip);
  assert.equal(r.verdict, 'route-exists');
  assert.match(r.detail, /duration=3200ms/);
  assert.match(r.detail, /1920x1080/);
});

test('a zero-length recording is the operator, not the framework', () => {
  const r = judgeVideoAsset({ uri: 'file:///x.mp4', duration: 0 });
  assert.equal(r.verdict, 'cancelled');
});

test('no asset and no uri both fail as no-route', () => {
  assert.equal(judgeVideoAsset(null).verdict, 'no-route');
  assert.equal(judgeVideoAsset(undefined).verdict, 'no-route');
  assert.equal(judgeVideoAsset({ uri: null, duration: 5 }).verdict, 'no-route');
});

// ------------------------------------------------------------- the record

test('every probe result says what it did NOT establish', () => {
  // ⚠ The whole hazard of a capability probe: a "route exists" read as
  // covering SwR-086's compression or SwR-102's stamping banks a pass nobody
  // earned. So the disclaimer travels IN the result, not in a comment.
  const results = [
    judgeSignatureStroke(stroke(40)),
    judgeSignatureStroke([]),
    judgeVideoAsset({ uri: 'file:///x.mp4', duration: 1000 }),
    judgeVideoAsset(null),
  ];
  for (const r of results) {
    assert.ok(r.notProven.length > 0, 'notProven must never be empty');
  }
  assert.match(results[0]!.notProven, /SwR-102/);
  assert.match(results[2]!.notProven, /SwR-086/);
});

test('what is NOT probed today is enumerated rather than left silent', () => {
  // ✕ SB-009 means a missing NFC probe is not a condition-4 failure — but it
  // is not a pass either, and silence in a record reads as a pass.
  assert.deepEqual(
    NOT_PROBED_TODAY.map((n) => n.capability),
    ['barcode and QR, offline', 'NFC'],
  );
  for (const n of NOT_PROBED_TODAY) {
    assert.ok(n.reason.length > 20, 'each exclusion carries a real reason');
  }
  assert.match(NOT_PROBED_TODAY[1]!.reason, /O2/);
});

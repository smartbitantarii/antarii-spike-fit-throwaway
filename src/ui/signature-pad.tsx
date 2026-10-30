/**
 * `SC-03` — `SyR-089`'s **signature capture**, as a capability probe.
 *
 * ➕ **NO NEW NATIVE DEPENDENCY, AND THAT IS THE POINT RATHER THAN A SAVING.**
 * The obvious move is a drawing library. ⚠ But the capability question is
 * whether the framework can capture freehand touch at all, and React Native's
 * own `PanResponder` either delivers a stroke or it does not — **the points
 * ARE the answer.** *And a probe that adds no native package cannot repeat
 * `F-12`, where adding one left the handset unable to start.*
 *
 * ✕ **NOTHING IS RENDERED OF THE STROKE, deliberately.** Drawing the line
 * needs `react-native-svg` or a canvas, which is a dependency bought for a
 * *product* concern — `judgeSignatureStroke` reads the points, not a picture.
 * The pad shows a **count and a bounding box** instead, which is exactly what
 * the verdict is computed from, so what the operator sees is what the record
 * will say.
 *
 * ⚠ **WHAT THIS DOES NOT ESTABLISH** is carried in the probe's own
 * `notProven`: image rendering, `SwR-102` stamping, storage as encrypted
 * media, and legal sufficiency. *A pad that captures a stroke is not a
 * signature the law recognises, and the record must not imply it is.*
 */

import React from 'react';
import { PanResponder, Text, View } from 'react-native';

import { judgeSignatureStroke, type ProbeResult } from '../media/capability.ts';
import { TOKENS, type Profile } from './profile.ts';

export function SignaturePad(props: {
  profile: Profile;
  onResult: (r: ProbeResult) => void;
  /**
   * 🔴 iOS LET THE PAGE SCROLL INSTEAD OF DRAWING (round 1, 2026-10-30): the
   * pad sits in a `ScrollView`, the native scroll took the touch, and
   * `onPanResponderTerminate` then discarded the stroke. The parent switches
   * its scrolling off while this is `true`.
   */
  onActiveChange?: (active: boolean) => void;
}): React.JSX.Element {
  const t = TOKENS[props.profile];
  /**
   * 🔴 A REF, NOT STATE, AND THE REASON IS THE WHOLE RELIABILITY OF THE PROBE.
   *
   * `PanResponder`'s handlers are created once and captured in a closure. A
   * `useState` array would be read at the value it held when the responder was
   * built, so **every move would append to an empty array and the stroke would
   * be one point long** — reported as *"a tap, not a stroke"*, a false
   * negative on the capability.
   *
   * ⚠ *This is the same stale-closure hazard that sent `openTimings: null` in
   * every record for five days, and the lesson is applied here on purpose.*
   */
  const points = React.useRef<Array<{ x: number; y: number }>>([]);
  const [shown, setShown] = React.useState({ n: 0, w: 0, h: 0 });

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        // ⚠ `onStartShouldSetPanResponder` as well as the move variant: without
        // the start handler the pad never claims the gesture and the points
        // never arrive at all.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // ➕ Refuse to hand the stroke to the enclosing scroll view.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          props.onActiveChange?.(true);
          points.current = [
            { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY },
          ];
          setShown({ n: 1, w: 0, h: 0 });
        },
        onPanResponderMove: (e) => {
          // ➕ `locationX/Y` rather than `pageX/Y`: coordinates relative to the
          // pad, so the bounding box means "how far the finger moved inside
          // the pad" rather than where the pad sits on screen.
          points.current.push({
            x: e.nativeEvent.locationX,
            y: e.nativeEvent.locationY,
          });
          const p = points.current;
          let minX = p[0]!.x, maxX = p[0]!.x, minY = p[0]!.y, maxY = p[0]!.y;
          for (const q of p) {
            if (q.x < minX) minX = q.x;
            if (q.x > maxX) maxX = q.x;
            if (q.y < minY) minY = q.y;
            if (q.y > maxY) maxY = q.y;
          }
          setShown({
            n: p.length,
            w: Math.round(maxX - minX),
            h: Math.round(maxY - minY),
          });
        },
        onPanResponderRelease: () => {
          props.onActiveChange?.(false);
          // The judgement is the pure function's, never this component's.
          props.onResult(judgeSignatureStroke(points.current));
        },
        // ⚠ A terminated gesture is NOT a release. The OS took the touch —
        // a notification, a call — and judging the partial stroke would record
        // a verdict about the framework from an interruption.
        onPanResponderTerminate: () => {
          props.onActiveChange?.(false);
          points.current = [];
          setShown({ n: 0, w: 0, h: 0 });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View
      {...responder.panHandlers}
      // The pad is the control, so it is one focus stop that says what it is.
      accessible
      accessibilityRole="button"
      accessibilityLabel={
        'Signature pad. Draw with one finger. ' +
        (shown.n === 0 ? 'No stroke yet.' : `${shown.n} points captured.`)
      }
      style={{
        // Generous, because a signature needs room and because `SyR-221`'s
        // touch floor is a MINIMUM rather than a target.
        minHeight: t.minTouchDp * 4,
        borderWidth: 2,
        borderColor: t.outline,
        borderRadius: 4,
        justifyContent: 'center',
        paddingHorizontal: 8,
      }}
    >
      <Text style={{ fontSize: t.labelDp, color: t.text }}>
        {shown.n === 0
          ? 'Sign here with one finger'
          : `${shown.n} points, ${shown.w}x${shown.h} box — lift to judge`}
      </Text>
    </View>
  );
}

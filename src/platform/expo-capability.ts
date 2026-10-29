/**
 * Condition 4 — the platform half of the capability probes.
 *
 * 🔴 THIS MODULE IMPORTS THE PLATFORM AND HOLDS NO JUDGEMENT. Every verdict
 * comes from `src/media/capability.ts`, which imports nothing and is tested on
 * a development machine — `expo-media.ts`'s boundary, applied here because the
 * first draft ignored it and the test could not load at all.
 */

import * as ImagePicker from 'expo-image-picker';

import { judgeVideoAsset, type ProbeResult } from '../media/capability.ts';

/**
 * `SyR-089`'s **video capture** — pressed, not judged, here.
 *
 * ➕ **NO NEW NATIVE DEPENDENCY.** `expo-image-picker` is already in the tree
 * for the photograph path, and its own types give
 * `MediaType = 'images' | 'videos' | 'livePhotos'` — *read out of
 * `ImagePicker.types.d.ts` in the installed package rather than recalled,
 * because the option name changed across SDK versions and the deprecated
 * `MediaTypeOptions` enum is still exported beside it.*
 */
export async function probeVideo(): Promise<ProbeResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return {
        capability: 'video capture',
        verdict: 'refused',
        // Reported in the platform's own words, never paraphrased — the same
        // rule the store's open failures follow.
        detail: `camera permission not granted (status=${perm.status})`,
        notProven: 'nothing — the route was never reached',
      };
    }
    const shot = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      quality: 1,
    });
    if (shot.canceled) {
      return {
        capability: 'video capture',
        verdict: 'cancelled',
        detail: 'the operator cancelled the recorder',
        notProven: 'nothing — the route was never completed',
      };
    }
    return judgeVideoAsset(shot.assets?.[0]);
  } catch (err) {
    // ⚠ A throw from the picker is the framework offering no working route,
    // which is what condition 4 fails on — so it is a verdict, not a crash.
    return {
      capability: 'video capture',
      verdict: 'no-route',
      detail: err instanceof Error ? err.message : String(err),
      notProven: 'nothing — the route threw',
    };
  }
}

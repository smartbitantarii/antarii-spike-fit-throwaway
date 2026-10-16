/**
 * #24, the platform half — the capture path (S5) and the part uploader.
 *
 * ⚠ ONE OF TWO MODULES THAT IMPORT EXPO, both in `src/platform/`. The
 * boundary was originally "`expo-adapters.ts` is the ONLY module that imports
 * Expo"; it is now the DIRECTORY, and the change is recorded rather than made
 * quietly. The boundary exists so axis 5 leg (iv)'s causes stay attributable —
 * a failure inside `src/platform/` is the package or our flags, a failure
 * behind it is the prototype — and a directory serves that as well as a file
 * while keeping the store adapters and the media adapters separately
 * readable.
 *
 * ⚠ EVERYTHING HERE EXECUTES DECISIONS MADE ELSEWHERE. The quality level, the
 * long edge, the stamp's shape and the one-shot location rule are decided in
 * `src/media/prepare.ts`, which imports nothing and is tested on a development
 * machine. None of `SwR-086`'s layering logic appears in this file, by design.
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator } from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import { stamp, type CapturePlan, type CaptureStamp, type LocationFix } from '../media/prepare.ts';
import { mintOurSessionId, type TransferSessionInfo } from '../media/transfer-session.ts';
import type { PartReceipt, PlatformUpload, StagingFile } from '../media/media.ts';

/**
 * 🔴 LEG (iii)'s FIRST SUBJECT, ANSWERED BY READING THE LIBRARY.
 *
 * `expo-file-system` 58.0.9 exposes NO transfer session identifier: its
 * `UploadTask` declares `state`, `uploadAsync`, `addListener`, `release` and
 * `cancel`, and a search for any identifier across the module's typings
 * returns nothing. Its own documentation of `sessionType` says the JS task
 * "is not restored if the app is terminated or relaunched" — which is exactly
 * what an application update does.
 *
 * So there is nothing from the platform to be stable, and this mints one of
 * OUR OWN with `provenance: 'ours'`. ⚠ Not dressed up as a pass:
 * `legIiiFirstSubjectVerdict` reads that provenance and returns *Not
 * established*, because an identifier we minted is stable across an update by
 * construction and proves nothing about the platform.
 */
export function newTransferSession(): TransferSessionInfo {
  const bytes = Crypto.getRandomValues(new Uint8Array(16));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return mintOurSessionId(hex, Date.now());
}

/**
 * `SwR-102`: location "shall be requested only at that moment, never
 * continuously", and "where it is unavailable or withheld the stamp shall
 * record *location unavailable* and the capture shall proceed".
 *
 * ⚠ Hence every failure path returns null rather than throwing. A denied
 * permission, a timeout or a platform error must not cost us the photograph.
 */
async function locationWithinTheMoment(): Promise<LocationFix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getCurrentPositionAsync({});
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      // Nullable in expo-location's own typings; `prepare.ts` records why.
      accuracyMetres: pos.coords.accuracy,
    };
  } catch {
    return null;
  }
}

export interface CaptureResult {
  /** the compressed, ready-to-display image */
  uri: string;
  stamp: CaptureStamp;
  /** what the shutter handed back, before compression */
  nativeWidth: number;
  nativeHeight: number;
}

/**
 * S5's work, in S5's order. M7 §2 starts S5 when "the shutter returns an image
 * to the application" and stops it when "the thumbnail is visible in the form,
 * AFTER compression and stamping" — so the start belongs at the moment the
 * picker resolves, which is what `onShutter` is for, and the stop belongs on
 * the thumbnail's own load event in the shell.
 *
 * ⚠ Returns null when the worker cancels. A cancel is not a failure and must
 * not be timed as one.
 */
export async function captureAndPrepare(
  plan: CapturePlan,
  onShutter?: () => void,
): Promise<CaptureResult | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('the camera permission was refused');

  const shot = await ImagePicker.launchCameraAsync({ quality: 1 });
  if (shot.canceled || !shot.assets || shot.assets.length === 0) return null;
  const asset = shot.assets[0]!;

  // The shutter has returned an image: S5's clock starts here, BEFORE the
  // compression and stamping the figure has to absorb.
  if (onShutter) onShutter();

  // Requested concurrently because `SwR-102` binds the fix to "the capture
  // moment": serialising them would push the location later than the moment
  // it is supposed to describe.
  const [uri, fix] = await Promise.all([
    compressToLongEdge(asset.uri, asset.width, asset.height, plan.longEdgePx),
    locationWithinTheMoment(),
  ]);

  return {
    uri,
    stamp: stamp(new Date().toISOString(), plan.level, fix),
    nativeWidth: asset.width,
    nativeHeight: asset.height,
  };
}

/**
 * ⚠ `N-C4`'s figure is the LONG EDGE, so which dimension is constrained
 * depends on the orientation of what the camera returned. `resize` preserves
 * the ratio when given one dimension, so the correct call passes `width` for a
 * landscape image and `height` for a portrait one. Passing `width` always —
 * the obvious reading of the API — would under-size every portrait
 * photograph, and on a phone portrait is the normal case.
 *
 * ➕ An image already at or below the target is left alone: resizing it up
 * would invent detail that was never captured.
 */
async function compressToLongEdge(
  uri: string,
  width: number,
  height: number,
  longEdgePx: number | null,
): Promise<string> {
  if (longEdgePx === null) return uri; // `full` — what the camera natively produces
  if (Math.max(width, height) <= longEdgePx) return uri;

  const ctx = ImageManipulator.manipulate(uri);
  const resized =
    width >= height ? ctx.resize({ width: longEdgePx }) : ctx.resize({ height: longEdgePx });
  const ref = await resized.renderAsync();
  const out = await ref.saveAsync();
  return out.uri;
}

/**
 * The device uploading a part DIRECTLY to the object store, which is
 * ADR-003 §5.3.3's shape: "the device uploads parts to it directly".
 *
 * ⚠ The multipart session is held here, as in the leg (ii) and leg (iii)
 * integration checks, because `PlatformUpload.send` deliberately carries only
 * a file and a grant. The upload id comes from the PERSISTED session, so a
 * build that resumes after an update finishes the upload the previous build
 * opened.
 */
export class ExpoPartUpload implements PlatformUpload {
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly key: string;
  private readonly uploadId: string;

  constructor(endpoint: string, bucket: string, key: string, uploadId: string) {
    this.endpoint = endpoint;
    this.bucket = bucket;
    this.key = key;
    this.uploadId = uploadId;
  }

  async send(file: StagingFile, grant: string): Promise<PartReceipt> {
    // Derived from the part, never from a counter: on a resume the first part
    // of the second run is not part 1, and a counter would overwrite one
    // part's bytes with another's and complete to the wrong object.
    const idx = Number(file.path.split('.part')[1]);
    if (!Number.isInteger(idx)) throw new Error('cannot derive a part index from ' + file.path);

    const url =
      this.endpoint +
      '/' +
      this.bucket +
      '/' +
      this.key +
      '?partNumber=' +
      (idx + 1) +
      '&uploadId=' +
      this.uploadId;

    /**
     * 🔴 `uploadType` IS DELIBERATELY NOT SET, AND THE TRAP IS WORTH NAMING.
     * `expo-file-system`'s `UploadType.MULTIPART` means **multipart/form-data**
     * — an HTTP form encoding — and has NOTHING to do with S3's multipart
     * upload, despite the identical word. Setting it would wrap every S3 part
     * in form boundaries and headers, so each part would be stored with
     * framing bytes around it and the completed object would be corrupt while
     * every status code stayed 200.
     *
     * The default is `UploadType.BINARY_CONTENT`, which sends the file as the
     * raw request body — what S3 requires — so the correct call is to leave it
     * alone. ➕ Omitted rather than set explicitly because the option is an
     * `enum`, and importing an enum value into a codebase Node runs with
     * strip-only TypeScript is a needless dependency on a compiled artefact.
     */
    const task = new File(file.path).createUploadTask(url, {
      httpMethod: 'PUT',
      headers: { 'x-antarii-grant': grant },
    });
    const result = await task.uploadAsync();
    if (result.status !== 200) {
      throw new Error('part ' + (idx + 1) + ' was refused with ' + result.status);
    }
    // HTTP header names are case-insensitive and this is a plain record, so
    // both spellings are tried rather than assuming the platform lower-cases.
    const etag = result.headers.etag ?? result.headers.ETag;
    if (!etag) throw new Error('no ETag returned for part ' + (idx + 1));
    return { etag };
  }
}

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
import { Asset } from 'expo-asset';
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

  return prepareFromImage(asset.uri, asset.width, asset.height, plan);
}

/**
 * 🔴 THE ONE PIPELINE BOTH PATHS USE, AND THAT IS THE POINT.
 *
 * `S5` measures *“compression (`SwR-086`) and stamping (`SwR-102`)”*. If the
 * fixture path did its own compressing, the figure would describe a pipeline
 * the application does not run — a measurement of the measuring apparatus.
 * Extracting this was the first step of adding the fixture, not an afterthought.
 */
async function prepareFromImage(
  uri: string,
  width: number,
  height: number,
  plan: CapturePlan,
): Promise<CaptureResult> {
  // Requested concurrently because `SwR-102` binds the fix to "the capture
  // moment": serialising them would push the location later than the moment
  // it is supposed to describe.
  const [out, fix] = await Promise.all([
    compressToLongEdge(uri, width, height, plan.longEdgePx),
    locationWithinTheMoment(),
  ]);

  return {
    uri: out,
    stamp: stamp(new Date().toISOString(), plan.level, fix),
    nativeWidth: width,
    nativeHeight: height,
  };
}

/**
 * `S5`'s source: a fixed fixture rather than the camera.
 *
 * ➕ M7 §4a's reason, verbatim: *“a live capture varies by lighting and
 * sensor warm-up, so it measures the camera rather than compression and
 * stamping, which is what `SwR-086`/`SwR-102` bind”*. The camera itself is
 * exercised once in condition 4's capability check, where it belongs.
 *
 * ⚠ THE ASSET IS RESOLVED BEFORE THE CLOCK STARTS. `loadAsync` may copy the
 * bundled file out on first use, and that cost belongs to neither the shutter
 * nor the compression — including it would inflate the first iteration and
 * nothing else, which is precisely the shape a discarded warm-up is supposed
 * to absorb rather than a cost we introduce ourselves.
 */
export async function captureFromFixture(
  plan: CapturePlan,
  onShutter?: () => void,
): Promise<CaptureResult> {
  const [asset] = await Asset.loadAsync(require('../../assets/s5-fixture.jpg'));
  if (!asset?.localUri) throw new Error('the S5 fixture could not be resolved to a local file');

  // Everything above is setup. THIS is the shutter returning an image.
  if (onShutter) onShutter();

  return prepareFromImage(
    asset.localUri,
    asset.width ?? FIXTURE_WIDTH,
    asset.height ?? FIXTURE_HEIGHT,
    plan,
  );
}

/**
 * The fixture's own dimensions, as a fallback if the asset does not report
 * them. ⚠ They are 4000 × 3000 because `SwR-086`'s Standard level is
 * `N-C4`'s **1600 px long edge** — a fixture near that size would make the
 * resize do almost no work and `S5` would measure almost nothing.
 */
export const FIXTURE_WIDTH = 4000;
export const FIXTURE_HEIGHT = 3000;

/**
 * M7 §3 step 4: *“delete the attachment; confirm the staging file is gone”*.
 *
 * ⚠ THE READING IS LABELLED. At capture time the only file the pipeline has
 * produced is the compressed output, so that is what is deleted and checked.
 * The staging files ADR-003 §5.3.3 names are created by the UPLOAD path, and
 * leg (ii) already asserts none survives there — this reset cannot check a
 * file that this sequence never creates.
 */
export async function discardCapture(uri: string): Promise<boolean> {
  const f = new File(uri);
  if (f.exists) f.delete();
  return !new File(uri).exists;
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

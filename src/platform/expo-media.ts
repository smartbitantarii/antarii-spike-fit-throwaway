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

import {
  LOCATION_DEADLINE_MS,
  stamp,
  type CapturePlan,
  type CaptureStamp,
  type LocationFix,
} from '../media/prepare.ts';
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
 *
 * 🔴 AND THE WAIT IS BOUNDED, WHICH IT WAS NOT. `getCurrentPositionAsync`
 * **requests a fresh fix** — the library contrasts it with
 * `getLastKnownPositionAsync`, *“faster … as it doesn't request for the current
 * location”* — and `LocationOptions` offers **no timeout**, so there is no way
 * to bound it through the call. Unbounded, it stalled `S5` at a **27.1 s p95
 * against a 2 s target**. The deadline is imposed here instead, and
 * `prepare.ts` records why the number is what it is.
 */
async function locationWithinTheMoment(): Promise<LocationFix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;

    const pos = await withinTheMoment(Location.getCurrentPositionAsync({}));
    if (!pos) return null;

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

/**
 * Resolves with the fix, or with `null` once `LOCATION_DEADLINE_MS` has passed.
 *
 * ⚠ THE ABANDONED REQUEST IS NOT CANCELLED, because `expo-location` offers no
 * way to cancel one. It is left to settle into handlers that do nothing — which
 * is why `then` is given BOTH arms rather than a bare `then`: a rejection
 * arriving twenty-six seconds later with no handler would surface as an
 * unhandled rejection against whatever the application was doing by then, in a
 * place bearing no relation to the capture that caused it.
 *
 * ➕ Resolving an already-resolved promise is a no-op, so the late arrival is
 * harmless rather than merely unlikely.
 */
function withinTheMoment<T>(pending: Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), LOCATION_DEADLINE_MS);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
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
 * ⚠ THE ASSET IS RESOLVED BEFORE THE CLOCK STARTS, AND ONLY ONCE. Resolving it
 * copies the bundled file out of the APK on first use, and that cost belongs to
 * neither the shutter nor the compression — including it would inflate the
 * first iteration and nothing else, which is precisely the shape a discarded
 * warm-up is supposed to absorb rather than a cost we introduce ourselves.
 * ➕ Memoising it means the cost is not merely outside the clock but absent
 * from every iteration after the first, so no reader has to take the clock
 * boundary on trust.
 */
export async function captureFromFixture(
  plan: CapturePlan,
  onShutter?: () => void,
): Promise<CaptureResult> {
  const file = await resolveFixtureOnce();

  // Everything above is setup. THIS is the shutter returning an image.
  if (onShutter) onShutter();

  return prepareFromImage(file.uri, file.width, file.height, plan);
}

interface FixtureFile {
  uri: string;
  width: number;
  height: number;
}

/**
 * 🔴 RESOLVED ONCE, AND NOT THE WAY THE DOCUMENTATION SHOWS — BECAUSE THE
 * DOCUMENTED WAY IS BROKEN IN A RELEASE ANDROID BUILD.
 *
 * `expo-asset`'s own example is `const [{ localUri }] =
 * await Asset.loadAsync(require('./assets/x.png'))`, and that is what this
 * function used to be. On the device it failed on the WARM-UP ITERATION with
 * *“Could not load the image: assets_s5fixture → Loading bitmap failed”*.
 *
 * ⚠ THE CAUSE, read in `expo-asset` 58.0.16's `Asset.fromModule`: Metro bundles
 * a required image into a release APK as an Android DRAWABLE RESOURCE, and the
 * library then does this —
 *
 *     // For images backward compatibility,
 *     // keeps localUri the same as uri for React Native's Image that
 *     // works fine with drawable resource names.
 *     if (Platform.OS === 'android' && !uri.includes(':') && (meta.width || meta.height)) {
 *       asset.localUri = asset.uri;   // = 'assets_s5fixture'
 *       asset.downloaded = true;      // so downloadAsync() returns immediately
 *     }
 *
 * — so `localUri` is the bare resource name and NO FILE IS EVER PRODUCED.
 * React Native's `<Image>` understands a drawable name, which is what the
 * shortcut is for; `ImageManipulator` takes a uri and does not.
 *
 * ➕ THE FIX ASKS FOR THE COPY THE SHORTCUT SKIPPED. `AssetModule.kt` already
 * handles a name with no scheme — *“if (!uriString.contains(\":\")) return
 * openAssetResourceStream(context, uriString)”* — and `findResourceId` looks it
 * up in `res/raw` then `res/drawable`. The native side could always copy this
 * out; only the JS shortcut stopped it being asked. Clearing the two public
 * fields asks it, and the asset's real md5 means the copy happens once.
 *
 * ⚠ THIS IS A WORKAROUND AROUND A LIBRARY'S INTERNAL SHORTCUT, and it is
 * recorded as one rather than hidden: it writes two documented public fields of
 * someone else's object. The alternative considered was giving the fixture a
 * non-image extension so the branch's `(meta.width || meta.height)` test never
 * fires — architecturally cleaner, but it rests on an UNVERIFIED assumption
 * about where the Gradle asset step files a custom extension, where this route
 * was read end to end in both the JavaScript and the Kotlin.
 *
 * ✕ AND IT IS INVISIBLE IN DEVELOPMENT. In Expo Go the other branch runs, the
 * uri is an http URL and the download really happens. No amount of development
 * testing would have found this; one release APK on one real device did.
 */
let fixture: FixtureFile | null = null;

async function resolveFixtureOnce(): Promise<FixtureFile> {
  if (fixture) return fixture;

  const asset = Asset.fromModule(require('../../assets/s5-fixture.jpg'));

  /**
   * ⚠ THE TEST IS FOR A USABLE URI, NOT A PRESENT ONE. The guard this
   * replaces was `if (!asset.localUri) throw`, and it PASSED — the resource
   * name is a perfectly truthy string that simply is not a path. A truthy
   * value is not evidence of a usable value. A uri has a scheme; a drawable
   * resource name has no colon in it at all.
   */
  if (!asset.localUri?.includes(':')) {
    asset.localUri = null;
    asset.downloaded = false;
    await asset.downloadAsync();
  }

  if (!asset.localUri?.includes(':')) {
    throw new Error('the S5 fixture did not resolve to a file uri: ' + String(asset.localUri));
  }

  /**
   * ➕ CHECKED RATHER THAN TRUSTED. Metro records an image's real dimensions,
   * so if the fixture is ever regenerated at a different size the constants
   * below would quietly describe the wrong image and `S5` would measure a
   * different amount of work under the same name. Better to disagree loudly.
   */
  const width = asset.width ?? FIXTURE_WIDTH;
  const height = asset.height ?? FIXTURE_HEIGHT;
  if (width !== FIXTURE_WIDTH || height !== FIXTURE_HEIGHT) {
    throw new Error(
      'the S5 fixture is ' + width + '×' + height + ', not the recorded ' +
        FIXTURE_WIDTH + '×' + FIXTURE_HEIGHT,
    );
  }

  fixture = { uri: asset.localUri, width, height };
  return fixture;
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

/**
 * Building §3a's fill on the device.
 *
 * ⚠ THE THIRD MODULE IN `src/platform/`, and the boundary's reason still holds:
 * everything that imports Expo lives here so axis 5 leg (iv)'s causes stay
 * attributable. The decisions — what the targets are, what an instance
 * contains, what the split means — are in `src/store/fill.ts`, which imports
 * nothing and is tested on a development machine.
 *
 * 🔴 IT MEASURES RATHER THAN PREDICTS, AND THAT IS THE WHOLE DESIGN. §3a's
 * record side must reach *"about a quarter of the budget"*; SQLite's page usage
 * for a given row shape is not something to guess, so the builder writes a
 * batch, asks the database how big it now is, and repeats. *A fill that
 * computed its own size would be a fill nobody had checked.*
 *
 * ➕ WHICH ALSO MAKES IT RESUMABLE FOR FREE. It starts by measuring, so an
 * interrupted build continues from wherever it stopped — and at this size an
 * interruption is likely rather than hypothetical.
 */
import { File, Directory, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';

import type { EncryptedStore } from '../store/store.ts';
import type { Job } from '../form/worklist.ts';
import {
  MEDIA_TARGET_BYTES,
  RECORD_TARGET_BYTES,
  fillState,
  instanceRows,
  type FillState,
} from '../store/fill.ts';

/**
 * Where the fill's media goes: the same directory the real pipeline seals parts
 * into, so the bytes land on the same filesystem under the same backup rules.
 *
 * ⚠ These are NOT sealed parts, and the record says so. Encrypting 1.1 GiB
 * would add nothing the measurement reads — what condition 1 is affected by is
 * **bytes occupying the device**, not their content — and it would add many
 * minutes to a build that is already long.
 */
function fillMediaDir(): Directory {
  const d = new Directory(Paths.document, 'media');
  if (!d.exists) d.create();
  return d;
}

const FILL_PREFIX = 'fill-';

/**
 * The media side only: walks the directory. ⚠ Gets slower as the directory
 * fills, which is why the build does not call it per file.
 */
function measureMedia(): { mediaBytes: number; mediaFiles: number } {
  let mediaBytes = 0;
  let mediaFiles = 0;
  for (const entry of fillMediaDir().list()) {
    if (entry instanceof File && entry.name.startsWith(FILL_PREFIX)) {
      mediaBytes += entry.size ?? 0;
      mediaFiles += 1;
    }
  }
  return { mediaBytes, mediaFiles };
}

/**
 * 🔴 THE CHEAP MEASUREMENT, AND THE DISTINCTION IS NOT FUSSINESS.
 * `PRAGMA page_count` reads the database header — constant time, whatever the
 * table holds. `COUNT(*)` over `answers` is a **full scan**, and by the end of
 * this fill that table holds hundreds of thousands of rows.
 *
 * ⚠ THE FIRST VERSION CALLED BOTH AFTER EVERY BATCH, which is **O(n²) across
 * the build**: each of ~200 batches would scan an ever-larger table, turning a
 * ten-minute build into an hours-long one. *The bug was in the measuring, not
 * in the thing measured — which is the kind this project has been bitten by
 * before.*
 *
 * ➕ So the loop measures SIZE often and COUNTS once at the end, and the
 * progress line carries running totals in between.
 */
async function measureSizeOnly(store: EncryptedStore, known: {
  jobs: number; instances: number; answers: number;
}): Promise<FillState> {
  const recordBytes = await store.sizeBytes();
  const media = measureMedia();
  return fillState({ recordBytes, ...media, ...known });
}

/** The full measurement, counts included. Called at the ends, not in the loops. */
export async function measureFill(store: EncryptedStore): Promise<FillState> {
  const [recordBytes, counts] = await Promise.all([store.sizeBytes(), store.counts()]);
  const media = measureMedia();
  return fillState({
    recordBytes,
    ...media,
    jobs: counts.jobs,
    instances: counts.instances,
    answers: counts.answers,
  });
}

export interface FillProgress {
  phase: 'worklist' | 'records' | 'media' | 'done';
  state: FillState;
}

/**
 * ➕ A BATCH SIZE, NOT A ROW AT A TIME. Each batch is one transaction, so this
 * is also how much work an interruption can lose. 50 instances is about 1,050
 * rows — small enough to lose without regret, large enough that the per-commit
 * cost of SQLCipher re-encrypting and fsyncing is amortised.
 */
const INSTANCES_PER_BATCH = 50;

/**
 * Builds the fill to §3a's targets, reporting progress as it goes.
 *
 * ⚠ `onProgress` is awaited-around rather than fired and forgotten: the UI must
 * get a chance to paint, or a build of this length looks like a hang. The yield
 * is what makes the progress line move at all.
 */
export async function buildFill(
  store: EncryptedStore,
  jobs: readonly Job[],
  onProgress: (p: FillProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<FillState> {
  let state = await measureFill(store);

  // --- §3a's worklist, first: "every job scheduled within 7 days ahead plus
  // every job with an in-progress or returned instance regardless of date".
  if (state.jobs < jobs.length) {
    onProgress({ phase: 'worklist', state });
    await store.putJobs(jobs);
    state = await measureFill(store);
  }

  // --- then the record side, to about a quarter of the budget.
  /**
   * 🔴 A CEILING AND A NO-PROGRESS CHECK, BOTH ADDED AFTER THIS LOOP WROTE
   * 22.30 GB AGAINST A 512 MiB TARGET.
   *
   * `sizeBytes()` now refuses to return a meaningless measurement, which fixes
   * the cause. **These two fix the SHAPE of the mistake**, which is that a loop
   * bounded only by a measurement will run forever if the measurement is wrong
   * — and the next wrong measurement will not be this one.
   *
   * ⚠ The ceiling is generous (three times the target) so it never fires on an
   * honest fill; it exists to bound a dishonest one. The no-progress check is
   * the sharper of the two: a batch that does not move the number means the
   * number is not measuring the thing being written.
   */
  const CEILING_BYTES = RECORD_TARGET_BYTES * 3;
  let batches = 0;
  let instance = state.instances;
  let answers = state.answers;
  while (state.recordBytes < RECORD_TARGET_BYTES && !shouldStop()) {
    const before = state.recordBytes;
    const rows: Array<{ record: string; field: string; value: string }> = [];
    for (let i = 0; i < INSTANCES_PER_BATCH; i++) {
      const record = 'fill-instance-' + instance;
      for (const r of instanceRows(instance)) {
        rows.push({ record, field: r.field, value: r.value });
      }
      instance += 1;
    }
    await store.putAnswers(rows);
    answers += rows.length;
    // ⚠ Size from a header read, counts carried forward — see `measureSizeOnly`.
    state = await measureSizeOnly(store, { jobs: state.jobs, instances: instance, answers });
    batches += 1;

    if (state.recordBytes <= before) {
      throw new Error(
        'the fill wrote ' + rows.length + ' rows and the database did not grow (' +
          before + ' → ' + state.recordBytes + ' bytes). The size measurement is not ' +
          'tracking what is being written, so the fill is stopping rather than ' +
          'writing until the device is full.',
      );
    }
    if (state.recordBytes > CEILING_BYTES) {
      throw new Error(
        'the fill passed ' + CEILING_BYTES + ' bytes against a ' + RECORD_TARGET_BYTES +
          ' byte target after ' + batches + ' batches — stopping, because a fill ' +
          'that overshoots this far is not measuring itself correctly.',
      );
    }

    onProgress({ phase: 'records', state });
    await yieldToUi();
  }
  if (!shouldStop()) state = await measureFill(store);

  // --- then media, to reach 80 %.
  if (state.mediaBytes < MEDIA_TARGET_BYTES && !shouldStop()) {
    /**
     * 🔴 THE FIXTURE'S OWN BYTES, COPIED, AND THE REASON IS NOT CONVENIENCE.
     * Media must be **incompressible** or a filesystem that compresses would
     * make 1.1 GiB of fill occupy less than 1.1 GiB — and §3a's whole point is
     * that the device is *at* 80 % of its budget. A real photographic JPEG is
     * already incompressible; generating 1.1 GiB of random bytes in JavaScript
     * instead would take far longer and buy nothing.
     *
     * ⚠ Read ONCE, outside the loop. Re-reading per file would make the build
     * measure the asset pipeline.
     */
    const [asset] = await Asset.loadAsync(require('../../assets/s5-fixture.jpg'));
    const src = asset?.localUri && asset.localUri.includes(':') ? asset.localUri : null;
    if (!src) throw new Error('the fill could not resolve the fixture to copy');
    const bytes = await new File(src).bytes();
    if (bytes.length === 0) throw new Error('the fixture read back empty');

    const dir = fillMediaDir();
    let n = state.mediaFiles;
    // The same ceiling, for the same reason: the media side counts rather than
    // measures between checks, and a count that is wrong is no safer.
    const MEDIA_CEILING = MEDIA_TARGET_BYTES * 3;
    while (state.mediaBytes < MEDIA_TARGET_BYTES && state.mediaBytes < MEDIA_CEILING && !shouldStop()) {
      const out = new File(dir, FILL_PREFIX + n + '.jpg');
      if (out.exists) out.delete();
      out.create();
      await out.write(bytes);
      n += 1;
      // Measured every 10 files rather than every file: `list()` walks the
      // directory, which gets slower as the directory fills.
      state = { ...state, mediaBytes: state.mediaBytes + bytes.length, mediaFiles: n };
      if (n % 10 === 0) {
        onProgress({ phase: 'media', state });
        await yieldToUi();
      }
    }
    state = await measureFill(store);
  }

  onProgress({ phase: 'done', state });
  return state;
}

/**
 * Removes the fill. ⚠ Only what the fill itself wrote: `fill-` media files and
 * `fill-instance-` records. *A blanket wipe would take the operator's device
 * label and the real captures with it.*
 */
export async function clearFill(store: EncryptedStore): Promise<FillState> {
  for (const entry of fillMediaDir().list()) {
    if (entry instanceof File && entry.name.startsWith(FILL_PREFIX)) entry.delete();
  }
  await store.deleteFillRecords();
  return measureFill(store);
}

/**
 * Lets React paint between batches.
 *
 * ⚠ `setTimeout(0)` rather than a microtask: a resolved promise would run
 * before the renderer gets the thread, so the progress line would not move and
 * a forty-minute build would be indistinguishable from a frozen app.
 */
function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

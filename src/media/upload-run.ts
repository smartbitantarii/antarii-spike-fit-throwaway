/**
 * Round 3 — driving legs (ii) and (iii) ON A PHONE.
 *
 * ⚠ WHY THIS FILE EXISTS. `MediaUploader` and the persisted session were
 * verified off-device against a real S3, but nothing in the application called
 * them, so neither leg could run on a handset (Tracker, 2026-10-16). This is the
 * smallest thing that does: three operations and their verdicts. It imports no
 * Expo, so the verdict rules are tested on a development machine and the
 * platform half stays in `src/platform/expo-upload-run.ts`.
 *
 * ➕ The verdicts live here rather than in `App.tsx` because a spike verdict
 * nobody tested is a verdict nobody can defend.
 *
 * ✕ WHAT THIS DOES NOT DO: background transfer. Parts go up while the app is
 * open. Leg (i) is the background question, and it runs last.
 */
import {
  MediaUploader,
  type Crypto,
  type Fs,
  type Grants,
  type PartReceipt,
  type PartRef,
  type PlatformUpload,
  type StagingFile,
} from './media.ts';
import { planFromDescriptor, type EncryptedMediaDescriptor } from './chunking.ts';
import type { MediaSession, PartRecord, SessionStore } from './session.ts';
import {
  legIiiFirstSubjectVerdict,
  NO_PLATFORM_SESSION_REASON,
  type TransferSessionInfo,
} from './transfer-session.ts';
import type { SqliteLike } from '../store/store.ts';

/** Fixed, so the build after the update can find what the build before it left. */
export const LEG_III_MEDIA_ID = 'spike-leg-iii';
/** Stops part-way, so there is something in flight when the update lands. */
export const LEG_III_STOP_AFTER_PARTS = 2;

export interface UploadProbe {
  capability: string;
  verdict: 'route-exists' | 'no-route' | 'not-established';
  detail: string;
  notProven: string;
}

/** The object store, reached directly from the device (§5.3.3). */
export interface ObjectEndpoint {
  initiate(key: string): Promise<string>;
  complete(key: string, uploadId: string, manifest: readonly PartRecord[]): Promise<void>;
  /** the completed object's size, which is what a phone can check cheaply */
  objectSize(key: string): Promise<number>;
}

/**
 * The descriptor must cross the update as well as the part list: it is what
 * says how the sealed parts were cut. Held in the encrypted store with them.
 */
export class SqliteDescriptorStore {
  private readonly db: SqliteLike;

  constructor(db: SqliteLike) {
    this.db = db;
  }

  async init(): Promise<void> {
    await this.db.execAsync(
      'CREATE TABLE IF NOT EXISTS media_descriptors (mediaId TEXT PRIMARY KEY, descriptor TEXT NOT NULL)',
    );
  }

  async save(d: EncryptedMediaDescriptor): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO media_descriptors (mediaId, descriptor) VALUES (?, ?)',
      [d.mediaId, JSON.stringify(d)],
    );
  }

  async load(mediaId: string): Promise<EncryptedMediaDescriptor | null> {
    const rows = await this.db.getAllAsync(
      'SELECT descriptor FROM media_descriptors WHERE mediaId = ?',
      [mediaId],
    );
    return rows.length === 0
      ? null
      : (JSON.parse(String(rows[0]!.descriptor)) as EncryptedMediaDescriptor);
  }

  async clear(mediaId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM media_descriptors WHERE mediaId = ?', [mediaId]);
  }
}

export interface DescriptorStore {
  save(d: EncryptedMediaDescriptor): Promise<void>;
  load(mediaId: string): Promise<EncryptedMediaDescriptor | null>;
  clear(mediaId: string): Promise<void>;
}

export interface UploadRunDeps {
  buildId: string;
  sessions: SessionStore;
  descriptors: DescriptorStore;
  endpoint: ObjectEndpoint;
  fs: Fs;
  grants: Grants;
  cryptoFor(descriptor: EncryptedMediaDescriptor): Crypto;
  platformFor(key: string, uploadId: string): PlatformUpload;
  /** how many plaintext staging files are on disk right now */
  stagingCount(): Promise<number>;
  /** makes a test file, seals it and deletes the plaintext */
  seal(mediaId: string): Promise<EncryptedMediaDescriptor>;
  /** removes the sealed parts once the media is finished with */
  discard(descriptor: EncryptedMediaDescriptor): Promise<void>;
  newSession(): TransferSessionInfo;
}

/**
 * Sees each hand-off, which is the only moment two plaintext copies could
 * coexist, and keeps the error `MediaUploader` turns into `failedAtPart`:
 * on a phone that message is the only clue there is.
 */
class Witness implements PlatformUpload {
  maxStaged = 0;
  lastError: string | null = null;
  private readonly inner: PlatformUpload;
  private readonly count: () => Promise<number>;

  constructor(inner: PlatformUpload, count: () => Promise<number>) {
    this.inner = inner;
    this.count = count;
  }

  async send(file: StagingFile, grant: string): Promise<PartReceipt | void> {
    this.maxStaged = Math.max(this.maxStaged, await this.count());
    try {
      return await this.inner.send(file, grant);
    } catch (err) {
      this.lastError = String(err);
      throw err;
    }
  }
}

const keyFor = (mediaId: string): string => mediaId + '.bin';

const LEG_II = 'axis 5 leg (ii): one staged part at a time';
const LEG_II_NOT_PROVEN =
  'upload while the app is backgrounded (leg (i)); that the OS honours the cache directory as ' +
  'excluded from backup, which is asserted by location only';
const LEG_III = 'axis 5 leg (iii): the part list survives an app update';
const LEG_III_NOT_PROVEN =
  'a transfer carried by the platform across the update: parts here go up while the app is open';
const LEG_III_ID = 'axis 5 leg (iii): platform transfer session identifier';

function failed(capability: string, notProven: string, err: unknown): UploadProbe {
  return { capability, verdict: 'no-route', detail: 'threw: ' + String(err), notProven };
}

/**
 * Leg (ii), in one tap: a refused hand-off first (the staging file must go on
 * FAILURE too, the half that gets forgotten), then a whole upload.
 */
export async function probeLegII(deps: UploadRunDeps, mediaId: string): Promise<UploadProbe> {
  try {
    const descriptor = await deps.seal(mediaId);
    const parts = planFromDescriptor(descriptor);
    const key = keyFor(mediaId);

    const refused = new Witness(deps.platformFor(key, 'no-such-upload'), deps.stagingCount);
    const failing = new MediaUploader(deps.cryptoFor(descriptor), deps.fs, refused, deps.grants);
    const bad = await failing.upload(mediaId, parts.slice(0, 1));
    const cleanedAfterFailure = bad.failedAtPart === 0 && (await failing.noStagingSurvives(bad));

    const uploadId = await deps.endpoint.initiate(key);
    const session: MediaSession = {
      mediaId,
      transferSessionId: deps.newSession().id,
      uploadId,
      parts: [],
      createdByBuild: deps.buildId,
      lastTouchedByBuild: deps.buildId,
    };
    await deps.sessions.save(session);

    const witness = new Witness(deps.platformFor(key, uploadId), deps.stagingCount);
    const uploader = new MediaUploader(
      deps.cryptoFor(descriptor),
      deps.fs,
      witness,
      deps.grants,
      deps.sessions,
    );
    const outcome = await uploader.upload(mediaId, parts, session);
    const cleaned = await uploader.noStagingSurvives(outcome);

    let size = -1;
    if (outcome.failedAtPart === null) {
      await deps.endpoint.complete(key, uploadId, session.parts);
      size = await deps.endpoint.objectSize(key);
    }
    await deps.sessions.clear(mediaId);
    await deps.discard(descriptor);

    const pass =
      cleanedAfterFailure &&
      outcome.failedAtPart === null &&
      cleaned &&
      witness.maxStaged === 1 &&
      size === descriptor.totalBytes;

    return {
      capability: LEG_II,
      verdict: pass ? 'route-exists' : 'no-route',
      detail:
        `${outcome.partsSent} of ${parts.length} parts sent, at most ${witness.maxStaged} staged at ` +
        `once, none left after success: ${cleaned}, none left after a refused part: ` +
        `${cleanedAfterFailure}, object ${size} of ${descriptor.totalBytes} bytes` +
        (witness.lastError ? `, failed with ${witness.lastError}` : ''),
      notProven: LEG_II_NOT_PROVEN,
    };
  } catch (err) {
    return failed(LEG_II, LEG_II_NOT_PROVEN, err);
  }
}

/**
 * Leg (iii), before the update: leaves an upload in flight. ⚠ Deliberately not a
 * verdict. Nothing has been shown until the next build finishes the job.
 */
export async function startLegIII(deps: UploadRunDeps): Promise<UploadProbe> {
  try {
    const existing = await deps.sessions.load(LEG_III_MEDIA_ID);
    if (existing) {
      return {
        capability: LEG_III,
        verdict: 'not-established',
        detail:
          `an upload is already in flight from build ${existing.createdByBuild}, ` +
          `${existing.parts.length} parts sent. Update the app, then resume`,
        notProven: LEG_III_NOT_PROVEN,
      };
    }
    const descriptor = await deps.seal(LEG_III_MEDIA_ID);
    await deps.descriptors.save(descriptor);
    const parts = planFromDescriptor(descriptor);
    const key = keyFor(LEG_III_MEDIA_ID);
    const uploadId = await deps.endpoint.initiate(key);
    const session: MediaSession = {
      mediaId: LEG_III_MEDIA_ID,
      transferSessionId: deps.newSession().id,
      uploadId,
      parts: [],
      createdByBuild: deps.buildId,
      lastTouchedByBuild: deps.buildId,
    };
    await deps.sessions.save(session);

    const witness = new Witness(deps.platformFor(key, uploadId), deps.stagingCount);
    const uploader = new MediaUploader(
      deps.cryptoFor(descriptor),
      deps.fs,
      witness,
      deps.grants,
      deps.sessions,
    );
    const outcome = await uploader.upload(
      LEG_III_MEDIA_ID,
      parts.slice(0, LEG_III_STOP_AFTER_PARTS),
      session,
    );
    return {
      capability: LEG_III,
      verdict: 'not-established',
      detail:
        `in flight under build ${deps.buildId}: ${session.parts.length} of ${parts.length} parts ` +
        'accepted. Install the next build over this one, then resume' +
        (witness.lastError ? `. Failed with ${witness.lastError}` : ''),
      notProven: LEG_III_NOT_PROVEN + `; failedAtPart ${outcome.failedAtPart}`,
    };
  } catch (err) {
    return failed(LEG_III, LEG_III_NOT_PROVEN, err);
  }
}

/**
 * Leg (iii), after the update. Returns two verdicts because the leg asks two
 * things, and the identifier half cannot pass on an identifier we minted.
 *
 * 🔴 REFUSED UNDER THE BUILD THAT STARTED IT. Resuming with no update in
 * between would finish the upload and look exactly like a pass.
 */
export async function resumeLegIII(deps: UploadRunDeps): Promise<UploadProbe[]> {
  try {
    const session = await deps.sessions.load(LEG_III_MEDIA_ID);
    const descriptor = await deps.descriptors.load(LEG_III_MEDIA_ID);
    if (!session || !descriptor) {
      return [
        {
          capability: LEG_III,
          verdict: 'not-established',
          detail: `nothing to resume: session ${session !== null}, descriptor ${descriptor !== null}`,
          notProven: LEG_III_NOT_PROVEN,
        },
      ];
    }
    if (session.createdByBuild === deps.buildId) {
      return [
        {
          capability: LEG_III,
          verdict: 'not-established',
          detail: `still on build ${deps.buildId}, which started this upload: no update has happened`,
          notProven: LEG_III_NOT_PROVEN,
        },
      ];
    }

    const parts: readonly PartRef[] = planFromDescriptor(descriptor);
    const key = keyFor(LEG_III_MEDIA_ID);
    const carried = session.parts.length;
    const witness = new Witness(deps.platformFor(key, session.uploadId), deps.stagingCount);
    const uploader = new MediaUploader(
      deps.cryptoFor(descriptor),
      deps.fs,
      witness,
      deps.grants,
      deps.sessions,
    );
    const outcome = await uploader.upload(LEG_III_MEDIA_ID, parts, session);

    let size = -1;
    if (outcome.failedAtPart === null) {
      await deps.endpoint.complete(key, session.uploadId, session.parts);
      size = await deps.endpoint.objectSize(key);
    }
    const pass =
      carried > 0 &&
      outcome.failedAtPart === null &&
      outcome.partsSent === parts.length - carried &&
      size === descriptor.totalBytes;
    if (pass) {
      await deps.sessions.clear(LEG_III_MEDIA_ID);
      await deps.descriptors.clear(LEG_III_MEDIA_ID);
      await deps.discard(descriptor);
    }

    const id = legIiiFirstSubjectVerdict({
      id: session.transferSessionId,
      provenance: session.transferSessionId.startsWith('ours-') ? 'ours' : 'platform',
      because: NO_PLATFORM_SESSION_REASON,
    });

    return [
      {
        capability: LEG_III,
        verdict: pass ? 'route-exists' : 'no-route',
        detail:
          `started by build ${session.createdByBuild}, finished by ${deps.buildId}: ${carried} parts ` +
          `carried over and not re-sent, ${outcome.partsSent} sent, object ${size} of ` +
          `${descriptor.totalBytes} bytes` +
          (witness.lastError ? `, failed with ${witness.lastError}` : ''),
        notProven: LEG_III_NOT_PROVEN,
      },
      {
        capability: LEG_III_ID,
        verdict: 'not-established',
        detail: id.verdict + ': ' + id.reason,
        notProven: 'whether any platform identifier would survive an update',
      },
    ];
  } catch (err) {
    return [failed(LEG_III, LEG_III_NOT_PROVEN, err)];
  }
}

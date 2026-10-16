/**
 * Version N+1, part 1 — the persisted multipart session.
 *
 * ⚠ THIS EXISTS BECAUSE LEG (iii) COULD NOT RUN WITHOUT IT, AND NOTHING HAD
 * BUILT IT. The run plan's verdict table is specific about what leg (iii)
 * observes:
 *
 *   "(iii) An application update with transfers in flight — the platform
 *   transfer session identifier stable across it, and **the persisted
 *   multipart part list intact**. SwR-112 depends on this; ADR-003 §7.1 calls
 *   it unverified and load-bearing."
 *
 * Build 1's media path kept the part list **in a local variable inside
 * `upload()`**. Nothing was persisted, so after an application update there
 * was no part list to be intact and no session identifier to be stable:
 * **leg (iii) had nothing to measure.** That is a gap in build 1, found while
 * preparing N+1, not a difference between the two versions.
 *
 * ➕ AND THAT IS THE POINT ABOUT N+1. The run plan says "N+1 need differ from
 * N in nothing but its version, since what is tested is the update, not the
 * change" — so this file belongs to BOTH builds. N and N+1 are the same code
 * at two versions; what differs is `BUILD_ID`.
 *
 * ✕ ONE HALF OF LEG (iii) IS NOT VERIFIABLE HERE AND IS NOT CLAIMED. The
 * **platform** transfer session identifier is iOS's background `URLSession`
 * identifier or Android's work request id — a DEVICE fact. This module
 * persists whatever the platform adapter reports and proves the stored value
 * survives a restart under a new build; whether the PLATFORM hands back the
 * same session after an update is what the device run answers.
 */
import type { SqliteLike } from '../store/store.ts';

/** One part that has been accepted by the endpoint. */
export interface PartRecord {
  index: number;
  /** the endpoint's receipt — an S3 ETag */
  etag: string;
}

export interface MediaSession {
  mediaId: string;
  /**
   * ⚠ The platform's transfer session identifier — leg (iii)'s first subject.
   * Reported by the platform, never invented here, because a value we made up
   * would be stable across an update by construction and would prove nothing.
   */
  transferSessionId: string;
  /** the endpoint's multipart upload id */
  uploadId: string;
  /** leg (iii)'s second subject: the persisted multipart part list */
  parts: PartRecord[];
  /** the build that opened the session */
  createdByBuild: string;
  /** the build that last wrote it — so the record SHOWS the update happened */
  lastTouchedByBuild: string;
}

export interface SessionStore {
  save(session: MediaSession): Promise<void>;
  load(mediaId: string): Promise<MediaSession | null>;
  clear(mediaId: string): Promise<void>;
}

export const SESSION_TABLE = 'media_sessions';

/**
 * `CREATE TABLE IF NOT EXISTS`, which is what makes an install-over work with
 * no migration step. ⚠ Worth saying out loud rather than leaving implicit:
 * leg (iii) is about data surviving an update, so the schema must be created
 * idempotently or the update itself would be what destroyed the evidence.
 */
export const SESSION_SCHEMA =
  'CREATE TABLE IF NOT EXISTS ' +
  SESSION_TABLE +
  ' (mediaId TEXT PRIMARY KEY, transferSessionId TEXT NOT NULL, uploadId TEXT NOT NULL,' +
  ' parts TEXT NOT NULL, createdByBuild TEXT NOT NULL, lastTouchedByBuild TEXT NOT NULL)';

/**
 * Held in the ENCRYPTED store, not in a preference file. An upload id plus a
 * part list is a live capability against tenant media, and ADR-003 §5.3.3's
 * discipline is that media material is encrypted at rest; putting the session
 * somewhere cheaper would put a usable handle to it in the clear.
 */
export class SqliteSessionStore implements SessionStore {
  private readonly db: SqliteLike;
  private readonly buildId: string;

  constructor(db: SqliteLike, buildId: string) {
    this.db = db;
    this.buildId = buildId;
  }

  async init(): Promise<void> {
    await this.db.execAsync(SESSION_SCHEMA);
  }

  async save(session: MediaSession): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO ' +
        SESSION_TABLE +
        ' (mediaId, transferSessionId, uploadId, parts, createdByBuild, lastTouchedByBuild)' +
        ' VALUES (?, ?, ?, ?, ?, ?)',
      [
        session.mediaId,
        session.transferSessionId,
        session.uploadId,
        JSON.stringify(session.parts),
        session.createdByBuild,
        // ⚠ Stamped with the build doing the WRITING, not with the session's
        // own field, so a resume under N+1 is visible in the row afterwards.
        this.buildId,
      ],
    );
  }

  async load(mediaId: string): Promise<MediaSession | null> {
    const rows = await this.db.getAllAsync(
      'SELECT mediaId, transferSessionId, uploadId, parts, createdByBuild, lastTouchedByBuild' +
        ' FROM ' +
        SESSION_TABLE +
        ' WHERE mediaId = ?',
      [mediaId],
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    let parts: PartRecord[];
    try {
      parts = JSON.parse(String(r.parts)) as PartRecord[];
    } catch {
      // ⚠ Refuse rather than resume from a half-read list. Resuming with a
      // part list we could not parse would skip parts that were never
      // uploaded and complete an upload that is missing bytes — a silent
      // corruption, and exactly the failure leg (iii) is looking for.
      throw new Error('the persisted part list for ' + mediaId + ' could not be read');
    }
    return {
      mediaId: String(r.mediaId),
      transferSessionId: String(r.transferSessionId),
      uploadId: String(r.uploadId),
      parts,
      createdByBuild: String(r.createdByBuild),
      lastTouchedByBuild: String(r.lastTouchedByBuild),
    };
  }

  async clear(mediaId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM ' + SESSION_TABLE + ' WHERE mediaId = ?', [mediaId]);
  }
}

/** The parts still to send, given what the persisted list says is done. */
export function remainingIndexes(
  all: readonly number[],
  session: MediaSession | null,
): number[] {
  if (!session) return [...all];
  const done = new Set(session.parts.map((p) => p.index));
  return all.filter((i) => !done.has(i));
}

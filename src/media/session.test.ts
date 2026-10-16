/**
 * Leg (iii) — an application update with transfers in flight.
 * Run: node --test src/media/session.test.ts
 *
 * What the verdict table asks for: "the platform transfer session identifier
 * stable across it, and the persisted multipart part list intact".
 *
 * ⚠ WHAT AN UPDATE IS, HERE. Installing N+1 over N replaces the code and
 * leaves the encrypted store in place. So the off-device equivalent is: write
 * a session with one `SessionStore` stamped `N`, discard every object, and
 * read it back through a NEW `SessionStore` stamped `N+1` over the SAME
 * database. The persisted row is the only thing that crosses, which is
 * exactly the condition on a device.
 *
 * ✕ AND WHAT THIS CANNOT SHOW. The *platform* transfer session identifier is
 * iOS's background `URLSession` identifier or Android's work request id.
 * These tests prove the stored value survives and is used; whether the
 * PLATFORM returns the same session after an update is a device fact and is
 * leg (iii)'s other half.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SqliteSessionStore,
  remainingIndexes,
  SESSION_TABLE,
  type MediaSession,
} from './session.ts';
import type { SqliteLike } from '../store/store.ts';
import { MediaUploader, type PartRef, type StagingFile, type PartReceipt } from './media.ts';

/**
 * A database that OUTLIVES the code using it — which is the whole point. The
 * row map is created once per test and handed to two different stores, the
 * way the device's file outlives the replaced application.
 */
function persistentDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const db: SqliteLike = {
    async execAsync() {},
    async runAsync(sql, params) {
      if (sql.startsWith('DELETE')) {
        rows.delete(String(params[0]));
        return;
      }
      rows.set(String(params[0]), {
        mediaId: params[0],
        transferSessionId: params[1],
        uploadId: params[2],
        parts: params[3],
        createdByBuild: params[4],
        lastTouchedByBuild: params[5],
      });
    },
    async getAllAsync(sql, params) {
      assert.ok(sql.includes(SESSION_TABLE), 'the session store queried the wrong table');
      const r = rows.get(String(params[0]));
      return r ? [r] : [];
    },
    async closeAsync() {},
  };
  return { db, rows };
}

function session(over: Partial<MediaSession> = {}): MediaSession {
  return {
    mediaId: 'media-1',
    transferSessionId: 'platform-session-abc',
    uploadId: 'upload-xyz',
    parts: [],
    createdByBuild: 'N',
    lastTouchedByBuild: 'N',
    ...over,
  };
}

// ------------------------------------------------------- the round trip

test('a session round-trips, and an absent one reads as null rather than throwing', async () => {
  const { db } = persistentDb();
  const store = new SqliteSessionStore(db, 'N');
  assert.equal(await store.load('media-1'), null, 'nothing stored yet');
  const s = session({ parts: [{ index: 0, etag: '"aaa"' }] });
  await store.save(s);
  const back = await store.load('media-1');
  assert.deepEqual(back, s);
});

test('the part list survives as a LIST, not as a count', async () => {
  const { db } = persistentDb();
  const store = new SqliteSessionStore(db, 'N');
  const parts = [
    { index: 0, etag: '"aaa"' },
    { index: 1, etag: '"bbb"' },
  ];
  await store.save(session({ parts }));
  const back = await store.load('media-1');
  // ⚠ The ETags matter as much as the indexes: completing a multipart upload
  // needs the receipt for every part, so a surviving COUNT would be useless.
  assert.deepEqual(back!.parts, parts);
});

// -------------------------------------------- leg (iii)'s two subjects

test('LEG (iii): the transfer session identifier and the part list survive the update', async () => {
  const { db } = persistentDb();

  // ---- build N: open the session and get two parts away ----
  const underN = new SqliteSessionStore(db, 'N');
  await underN.init();
  const original = session({
    transferSessionId: 'platform-session-abc',
    uploadId: 'upload-xyz',
    parts: [
      { index: 0, etag: '"aaa"' },
      { index: 1, etag: '"bbb"' },
    ],
  });
  await underN.save(original);

  // ---- the update: every object is discarded, the database is not ----
  const underNPlus1 = new SqliteSessionStore(db, 'N+1');
  const after = await underNPlus1.load('media-1');
  assert.ok(after, 'the session did not survive the update at all');

  assert.equal(
    after.transferSessionId,
    original.transferSessionId,
    'the transfer session identifier changed across the update',
  );
  assert.equal(after.uploadId, original.uploadId, 'the multipart upload id changed');
  assert.deepEqual(after.parts, original.parts, 'the persisted part list is not intact');

  // ⚠ And the record must SHOW the update happened. Without this the result
  // is indistinguishable from the update never having run.
  assert.equal(after.createdByBuild, 'N', 'the session should still say N opened it');
  await underNPlus1.save(after);
  const stamped = await underNPlus1.load('media-1');
  assert.equal(stamped!.lastTouchedByBuild, 'N+1', 'N+1 did not stamp its own write');
  assert.equal(stamped!.createdByBuild, 'N', 'the opening build must not be overwritten');
});

test('LEG (iii): a resume SKIPS the parts the list says are done', async () => {
  const sent: number[] = [];
  const staged: string[] = [];
  const deleted: string[] = [];

  const crypto = {
    async decryptPart(mediaId: string, part: PartRef): Promise<StagingFile> {
      const path = `/tmp/${mediaId}.part${part.index}`;
      staged.push(path);
      return { path, bytes: part.length };
    },
  };
  const fs = {
    async delete(p: string) {
      deleted.push(p);
    },
    async exists(p: string) {
      return staged.includes(p) && !deleted.includes(p);
    },
    async excludeFromBackup() {},
  };
  const platform = {
    async send(file: StagingFile): Promise<PartReceipt> {
      const i = Number(file.path.split('.part')[1]);
      sent.push(i);
      return { etag: `"etag-${i}"` };
    },
  };
  const grants = { async mint() { return 'g'; } };

  const { db } = persistentDb();
  const sessions = new SqliteSessionStore(db, 'N+1');
  const resumed = session({ parts: [{ index: 0, etag: '"aaa"' }, { index: 1, etag: '"bbb"' }] });

  const uploader = new MediaUploader(crypto, fs, platform, grants, sessions);
  const parts: PartRef[] = [
    { index: 0, offset: 0, length: 10 },
    { index: 1, offset: 10, length: 10 },
    { index: 2, offset: 20, length: 10 },
  ];
  const outcome = await uploader.upload('media-1', parts, resumed);

  assert.deepEqual(sent, [2], 'only the unfinished part should have been sent');
  assert.equal(outcome.partsSent, 1, 'partsSent counts this run, not the whole upload');
  assert.equal(outcome.failedAtPart, null);
  // ⚠ And the skipped parts were never DECRYPTED either — a resume that
  // decrypted them would put plaintext on disk for no reason, which is the
  // thing §5.3.3 exists to prevent.
  assert.deepEqual(staged, ['/tmp/media-1.part2'], 'a skipped part was staged');
  assert.equal(await uploader.noStagingSurvives(outcome), true);

  // The list now holds all three, in order, with every receipt.
  const final = await sessions.load('media-1');
  assert.deepEqual(final!.parts.map((p) => p.index), [0, 1, 2]);
  assert.equal(final!.parts[2]!.etag, '"etag-2"');
});

test('a part list that cannot be read is REFUSED, not resumed from', async () => {
  const { db, rows } = persistentDb();
  const store = new SqliteSessionStore(db, 'N');
  await store.save(session());
  rows.get('media-1')!.parts = '{not json';
  // ⚠ Resuming from an unreadable list would skip parts that were never
  // uploaded and then complete an upload missing those bytes — a silent
  // corruption, and the exact failure leg (iii) is looking for.
  await assert.rejects(() => store.load('media-1'), /could not be read/);
});

test('clearing a session removes it, so a finished upload leaves no resumable handle', async () => {
  const { db } = persistentDb();
  const store = new SqliteSessionStore(db, 'N');
  await store.save(session());
  await store.clear('media-1');
  assert.equal(await store.load('media-1'), null);
});

// ------------------------------------------------------- the helper

test('remainingIndexes: no session means everything remains', () => {
  assert.deepEqual(remainingIndexes([0, 1, 2], null), [0, 1, 2]);
  assert.deepEqual(
    remainingIndexes([0, 1, 2], session({ parts: [{ index: 1, etag: 'x' }] })),
    [0, 2],
    'order is preserved and only the done part is dropped',
  );
  assert.deepEqual(
    remainingIndexes([0], session({ parts: [{ index: 0, etag: 'x' }] })),
    [],
    'a finished upload has nothing remaining',
  );
});

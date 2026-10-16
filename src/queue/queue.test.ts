/**
 * Tests for the queue and the media path.
 * Run: node --test src/queue/queue.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Queue, RECOVERY_WINDOW_MS, REFERENCE_PERIOD_MS } from './queue.ts';
import { MediaUploader, type PartRef, type StagingFile } from '../media/media.ts';

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

// ---------------------------------------------------------------- the queue

test('SwR-097: a record is never safely delivered before durable confirmation', () => {
  const c = clock();
  const q = new Queue(c.now);
  q.save('r1');
  assert.equal(q.isSafelyDelivered('r1'), false, 'pending');
  const b = q.nextBatch()!;
  assert.equal(q.isSafelyDelivered('r1'), false, 'sent, awaiting confirmation');
  q.markReceived(b.batch);
  assert.equal(q.isSafelyDelivered('r1'), false, 'RECEIVED is not delivered — SwR-109 calls them distinct');
  q.confirmDurable(b.batch);
  assert.equal(q.isSafelyDelivered('r1'), true, 'only durable confirmation counts');
});

test('SwR-097 keeps pending and awaiting-confirmation separate, with media bytes', () => {
  const q = new Queue(clock().now);
  q.save('r1', 1000);
  q.save('r2', 250);
  let t = q.totals();
  assert.equal(t.pendingCount, 2);
  assert.equal(t.pendingMediaBytes, 1250);
  assert.equal(t.awaitingConfirmationCount, 0);

  const b = q.nextBatch()!;
  t = q.totals();
  assert.equal(t.pendingCount, 1, 'the sent record leaves pending');
  assert.equal(t.awaitingConfirmationCount, 1);
  assert.equal(t.awaitingConfirmationMediaBytes + t.pendingMediaBytes, 1250, 'bytes are conserved, never double-counted');
  q.confirmDurable(b.batch);
  t = q.totals();
  assert.equal(t.awaitingConfirmationCount, 0);
});

test('ADR-003 §5.5.3: each save replaces the pending batch with a fuller one', () => {
  const q = new Queue(clock().now);
  q.save('r1', 100);
  q.save('r1', 400);
  q.save('r1', 900);
  assert.equal(q.totals().pendingCount, 1, 'one record, one pending batch — not three');
  assert.equal(q.totals().pendingMediaBytes, 900, 'the latest save is what goes');
  assert.equal(q.get('r1')!.revision, 3);
  const b = q.nextBatch()!;
  assert.match(b.batch, /r3$/, 'the batch carries the revision it represents');
  assert.equal(q.nextBatch(), null, 'nothing else is queued for that record');
});

test('ADR-004 §6.4: a resent batch confirmed twice is idempotent', () => {
  const c = clock();
  const q = new Queue(c.now);
  q.save('r1');
  const b = q.nextBatch()!;
  q.confirmDurable(b.batch);
  const first = q.get('r1')!.confirmedAt;
  c.advance(60_000);
  q.confirmDurable(b.batch); // the resend the queue's own state makes inevitable
  assert.equal(q.get('r1')!.confirmedAt, first, 'the recovery window must not be reset by a duplicate');
});

test('SwR-109: removal waits for the window AND the reference period', () => {
  const c = clock();
  const q = new Queue(c.now);
  q.save('r1', 10);
  q.confirmDurable(q.nextBatch()!.batch);

  assert.equal(q.isRemovable('r1'), false, 'immediately after confirmation');
  c.advance(RECOVERY_WINDOW_MS);
  assert.equal(q.isRemovable('r1'), false, 'past the 15-minute window but not the 30 days');
  c.advance(REFERENCE_PERIOD_MS);
  assert.equal(q.isRemovable('r1'), true, 'the LATER of the two, which SwR-109 says in terms');
});

test('SwR-109: an outstanding re-offer blocks removal however old the item is', () => {
  const c = clock();
  const q = new Queue(c.now);
  q.save('r1');
  q.confirmDurable(q.nextBatch()!.batch);
  c.advance(REFERENCE_PERIOD_MS * 2);
  q.setReOffer('r1', true);
  assert.equal(q.isRemovable('r1'), false, 'the announced re-offer is not settled');
  q.setReOffer('r1', false);
  assert.equal(q.isRemovable('r1'), true);
});

test('SwR-125: the removable list is ordered by size and shows what each frees', () => {
  const c = clock();
  const q = new Queue(c.now);
  for (const [id, bytes] of [['a', 10], ['b', 5000], ['c', 300]] as const) {
    q.save(id, bytes);
    q.confirmDurable(q.nextBatch()!.batch);
  }
  c.advance(REFERENCE_PERIOD_MS + RECOVERY_WINDOW_MS);
  assert.deepEqual(q.removableBySize(), [
    { record: 'b', frees: 5000 },
    { record: 'c', frees: 300 },
    { record: 'a', frees: 10 },
  ]);
});

// ------------------------------------------------------------ the media path

function fakes(failOnPart: number | null = null) {
  const files = new Set<string>();
  const sent: Array<{ path: string; grant: string }> = [];
  const grantsMinted: string[] = [];
  const uploader = new MediaUploader(
    {
      async decryptPart(mediaId, part) {
        const f: StagingFile = { path: `/staging/${mediaId}.${part.index}`, bytes: part.length };
        files.add(f.path);
        return f;
      },
    },
    {
      async delete(p) { files.delete(p); },
      async exists(p) { return files.has(p); },
      async excludeFromBackup() { /* recorded by the platform in the real build */ },
    },
    {
      async send(file, grant) {
        if (failOnPart !== null && file.path.endsWith(`.${failOnPart}`)) throw new Error('upload failed');
        sent.push({ path: file.path, grant });
      },
    },
    {
      async mint(mediaId, part) {
        const g = `grant:${mediaId}:${part}`;
        grantsMinted.push(g);
        return g;
      },
    },
  );
  return { uploader, files, sent, grantsMinted };
}

const parts: PartRef[] = [
  { index: 0, offset: 0, length: 100 },
  { index: 1, offset: 100, length: 100 },
  { index: 2, offset: 200, length: 50 },
];

test('§5.3.3: one part at a time, and no staging file survives completion', async () => {
  const { uploader, files, sent } = fakes();
  const out = await uploader.upload('m1', parts);
  assert.equal(out.partsSent, 3);
  assert.equal(out.failedAtPart, null);
  assert.equal(files.size, 0, 'every staging file deleted');
  assert.equal(await uploader.noStagingSurvives(out), true);
  assert.deepEqual(sent.map((s) => s.path), ['/staging/m1.0', '/staging/m1.1', '/staging/m1.2']);
});

test('§5.3.3: the staging file is deleted ON FAILURE too — the half that gets forgotten', async () => {
  const { uploader, files } = fakes(1);
  const out = await uploader.upload('m1', parts);
  assert.equal(out.failedAtPart, 1);
  assert.equal(out.partsSent, 1, 'part 0 went, part 1 failed, part 2 never started');
  assert.equal(files.size, 0, 'no plaintext left behind by the failure');
  assert.equal(await uploader.noStagingSurvives(out), true);
});

test('§5.3.3: a grant is minted per hand-off, so none outlives its moment', async () => {
  const { uploader, sent, grantsMinted } = fakes();
  await uploader.upload('m1', parts);
  assert.equal(grantsMinted.length, 3, 'one grant per part, not one per upload');
  assert.equal(new Set(sent.map((s) => s.grant)).size, 3, 'no grant is reused across parts');
});

test('only one part is ever staged at a time', async () => {
  let maxConcurrent = 0;
  const live = new Set<string>();
  const uploader = new MediaUploader(
    {
      async decryptPart(mediaId, part) {
        const f = { path: `/s/${part.index}`, bytes: part.length };
        live.add(f.path);
        maxConcurrent = Math.max(maxConcurrent, live.size);
        return f;
      },
    },
    { async delete(p) { live.delete(p); }, async exists() { return false; }, async excludeFromBackup() {} },
    { async send() {} },
    { async mint() { return 'g'; } },
  );
  await uploader.upload('m1', parts);
  assert.equal(maxConcurrent, 1, 'two plaintext copies on disk is what §5.3.3 exists to prevent');
});

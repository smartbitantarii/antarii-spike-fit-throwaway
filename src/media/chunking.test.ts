/**
 * Tests for the part boundaries fixed at encryption time — #25.
 * Run: node --test src/media/chunking.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  S3_MIN_PART_BYTES,
  S3_MAX_PARTS,
  DEFAULT_CHUNK_BYTES,
  planChunks,
  planFromDescriptor,
  aadFor,
  sealedPartName,
  stagingPartName,
  type EncryptedMediaDescriptor,
} from './chunking.ts';

const MiB = 1024 * 1024;

test("S3's minimum is the figure the bench measured, not a remembered one", () => {
  assert.equal(S3_MIN_PART_BYTES, 5 * MiB);
  assert.equal(DEFAULT_CHUNK_BYTES, S3_MIN_PART_BYTES, 'the default sits exactly on the floor');
  assert.equal(S3_MAX_PARTS, 10_000);
});

// ------------------------------------------------------------- the plan

test('every part is the chunk size except the last, which is the remainder', () => {
  const parts = planChunks(12 * MiB, 5 * MiB);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[0], { index: 0, offset: 0, length: 5 * MiB });
  assert.deepEqual(parts[1], { index: 1, offset: 5 * MiB, length: 5 * MiB });
  assert.deepEqual(parts[2], { index: 2, offset: 10 * MiB, length: 2 * MiB });
});

test('the parts cover the media exactly — no gap, no overlap, no overrun', () => {
  for (const total of [1, 4096, 5 * MiB, 5 * MiB + 1, 12 * MiB, 50 * MiB - 7]) {
    const parts = planChunks(total, 5 * MiB);
    let covered = 0;
    for (let i = 0; i < parts.length; i++) {
      assert.equal(parts[i]!.index, i, 'indexes must be dense and in order');
      assert.equal(parts[i]!.offset, covered, 'a gap or overlap at part ' + i);
      assert.ok(parts[i]!.length > 0, 'a zero-length part at ' + i);
      covered += parts[i]!.length;
    }
    assert.equal(covered, total, 'the plan does not cover ' + total + ' bytes exactly');
  }
});

test('an exact multiple produces no empty trailing part', () => {
  const parts = planChunks(10 * MiB, 5 * MiB);
  assert.equal(parts.length, 2, 'a third zero-length part would be sealed and uploaded for nothing');
  assert.equal(parts[1]!.length, 5 * MiB);
});

// ------------------------------- the rule that makes media un-uploadable later

test("a chunk size below S3's minimum is REFUSED when it would make more than one part", () => {
  // ⚠ This is the whole point of the file. Sealing with a small chunk size
  // succeeds, and the failure appears much later at the COMPLETE step, after a
  // slow upload has already run.
  assert.throws(
    () => planChunks(12 * MiB, 1 * MiB),
    /un-uploadable/,
    'a small chunk size must be refused at encryption time, not discovered at upload time',
  );
});

test('a SINGLE part below the minimum is allowed, because it is the last part', () => {
  // S3's rule exempts the last part, and with one part it IS the last — so a
  // 40 kB photograph is a legal single-part upload. Refusing it would reject
  // the common case to satisfy a rule that does not apply to it.
  const parts = planChunks(40_000, 5 * MiB);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0], { index: 0, offset: 0, length: 40_000 });
});

test("a chunk size that would exceed S3's part limit is refused", () => {
  assert.throws(() => planChunks(10_001 * (5 * MiB), 5 * MiB), /over S3's limit/);
});

test('nonsense lengths are refused rather than producing a silent empty plan', () => {
  assert.throws(() => planChunks(0, 5 * MiB), /positive whole number/);
  assert.throws(() => planChunks(-1, 5 * MiB), /positive whole number/);
  assert.throws(() => planChunks(1.5, 5 * MiB), /positive whole number/);
  assert.throws(() => planChunks(5 * MiB, 0), /positive whole number/);
});

// ------------------------- the descriptor, and the bug it exists to prevent

test('the plan for sealed media comes from ITS descriptor, not the current default', () => {
  // 🔴 If the default ever changes, media sealed under the old value must
  // still be split on the old boundaries. An 8 MiB-chunked item must plan as
  // 8 MiB even while the default is 5.
  const d: EncryptedMediaDescriptor = {
    mediaId: 'm1',
    totalBytes: 20 * MiB,
    chunkBytes: 8 * MiB,
    ivLength: 12,
    tagLength: 16,
    partCount: 3,
  };
  const parts = planFromDescriptor(d);
  assert.equal(parts.length, 3);
  assert.equal(parts[0]!.length, 8 * MiB, 'the descriptor\'s chunk size must win');
  assert.equal(parts[2]!.length, 4 * MiB);
  assert.notEqual(d.chunkBytes, DEFAULT_CHUNK_BYTES, 'the premise of this test has gone');
});

test('a descriptor that disagrees with its own figures is refused', () => {
  const d: EncryptedMediaDescriptor = {
    mediaId: 'm1',
    totalBytes: 12 * MiB,
    chunkBytes: 5 * MiB,
    ivLength: 12,
    tagLength: 16,
    partCount: 2, // wrong: 12/5 is three parts
  };
  assert.throws(() => planFromDescriptor(d), /claims 2 parts but its own figures give 3/);
});

// --------------------------------------------- the AAD binding

test('the AAD binds a part to its media item AND its index', () => {
  assert.notEqual(aadFor('m1', 0), aadFor('m1', 1), 'two parts of one item must differ');
  assert.notEqual(aadFor('m1', 0), aadFor('m2', 0), 'the same index of two items must differ');
  assert.equal(aadFor('m1', 0), aadFor('m1', 0), 'and it must be reproducible on decrypt');
});

test('the AAD refuses inputs that would weaken the binding', () => {
  assert.throws(() => aadFor('', 0), /empty media id/);
  assert.throws(() => aadFor('m1', -1), /non-negative/);
  assert.throws(() => aadFor('m1', 1.5), /whole number/);
});

// --------------------------------------------- the names the uploader depends on

test('the staging name carries .partN, which the uploader derives the part number from', () => {
  // ⚠ Not cosmetic. ExpoPartUpload and the integration tests parse the index
  // out of this path, because a counter would be wrong on a resume.
  assert.equal(stagingPartName('m1', 2), 'm1.part2');
  assert.equal(Number('m1.part2'.split('.part')[1]), 2, 'the derivation the uploader performs');
  assert.equal(Number(stagingPartName('m1', 0).split('.part')[1]), 0);
});

test('a sealed part name is distinct from its staging name', () => {
  // They coexist during an upload: the sealed part is the durable artefact and
  // the staging file is the transient plaintext, and confusing the two would
  // mean deleting the wrong one.
  assert.notEqual(sealedPartName('m1', 2), stagingPartName('m1', 2));
  assert.match(sealedPartName('m1', 2), /\.sealed$/);
});

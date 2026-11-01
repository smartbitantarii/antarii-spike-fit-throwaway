/**
 * Round 3's verdict rules. Run: node --test src/media/upload-run.test.ts
 *
 * The bytes are proven in `media.s3.test.ts` against a real S3. This file proves
 * only what those tests cannot: that the phone-facing verdicts say the right
 * thing, and in particular that nothing here can report a false pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEG_III_MEDIA_ID,
  LEG_III_STOP_AFTER_PARTS,
  probeLegII,
  resumeLegIII,
  startLegIII,
  type UploadRunDeps,
} from './upload-run.ts';
import { mintOurSessionId } from './transfer-session.ts';
import type { EncryptedMediaDescriptor } from './chunking.ts';
import type { PartRef, StagingFile } from './media.ts';
import type { MediaSession } from './session.ts';

const MIB = 1024 * 1024;
const descriptorFor = (mediaId: string): EncryptedMediaDescriptor => ({
  mediaId,
  totalBytes: 16 * MIB,
  chunkBytes: 5 * MIB,
  ivLength: 12,
  tagLength: 16,
  partCount: 4,
});

interface Rig {
  deps: UploadRunDeps;
  sent: number[];
  staged: Set<string>;
  sessions: Map<string, string>;
  descriptors: Map<string, string>;
  discarded: string[];
  completed: string[];
}

function rig(overrides: {
  buildId?: string;
  size?: number;
  leaveStaged?: boolean;
  leaveStagedOnFailure?: boolean;
  /** a second copy on disk during each hand-off, breaking the bound */
  doubleStaged?: boolean;
  shared?: Pick<Rig, 'sessions' | 'descriptors'>;
} = {}): Rig {
  const sessions = overrides.shared?.sessions ?? new Map<string, string>();
  const descriptors = overrides.shared?.descriptors ?? new Map<string, string>();
  const staged = new Set<string>();
  const sent: number[] = [];
  const discarded: string[] = [];
  const completed: string[] = [];
  const buildId = overrides.buildId ?? 'N';

  const deps: UploadRunDeps = {
    buildId,
    sessions: {
      async save(s) { sessions.set(s.mediaId, JSON.stringify({ ...s, lastTouchedByBuild: buildId })); },
      async load(id) {
        const v = sessions.get(id);
        return v ? (JSON.parse(v) as MediaSession) : null;
      },
      async clear(id) { sessions.delete(id); },
    },
    descriptors: {
      async save(d) { descriptors.set(d.mediaId, JSON.stringify(d)); },
      async load(id) {
        const v = descriptors.get(id);
        return v ? (JSON.parse(v) as EncryptedMediaDescriptor) : null;
      },
      async clear(id) { descriptors.delete(id); },
    },
    endpoint: {
      async initiate() { return 'upload-1'; },
      async complete(key, _id, manifest) { completed.push(key + ':' + manifest.length); },
      async objectSize() { return overrides.size ?? 16 * MIB; },
    },
    fs: {
      async delete(p) {
        const failure = !p.includes('real');
        if (overrides.leaveStaged && !failure) return;
        if (overrides.leaveStagedOnFailure && failure) return;
        staged.delete(p);
      },
      async exists(p) { return staged.has(p); },
      async excludeFromBackup() {},
    },
    grants: { async mint() { return 'grant'; } },
    cryptoFor: () => ({
      async decryptPart(mediaId: string, part: PartRef): Promise<StagingFile> {
        const path = `${mediaId}.${sendingReal ? 'real' : 'refused'}.part${part.index}`;
        staged.add(path);
        return { path, bytes: part.length };
      },
    }),
    platformFor: (_key, uploadId) => ({
      async send(file) {
        if (uploadId === 'no-such-upload') throw new Error('part 1 was refused with 404');
        sent.push(Number(file.path.split('.part')[1]));
        return { etag: '"e' + sent.length + '"' };
      },
    }),
    stagingCount: async () => staged.size + (overrides.doubleStaged ? 1 : 0),
    seal: async (id) => descriptorFor(id),
    discard: async (d) => { discarded.push(d.mediaId); },
    newSession: () => mintOurSessionId('00112233445566778899aabbccddeeff', 1),
  };

  // The refused run comes first and uses its own upload id.
  let sendingReal = false;
  const platformFor = deps.platformFor;
  deps.platformFor = (key, uploadId) => {
    sendingReal = uploadId !== 'no-such-upload';
    return platformFor(key, uploadId);
  };

  return { deps, sent, staged, sessions, descriptors, discarded, completed };
}

test('leg (ii): a clean run is a route, and it cleans up after itself', async () => {
  const r = rig();
  const p = await probeLegII(r.deps, 'm1');
  assert.equal(p.verdict, 'route-exists', p.detail);
  assert.deepEqual(r.sent, [0, 1, 2, 3]);
  assert.equal(r.staged.size, 0);
  assert.deepEqual(r.discarded, ['m1']);
  assert.equal(r.sessions.size, 0);
});

test('🔴 leg (ii): two plaintext copies at once breaks the bound', async () => {
  const p = await probeLegII(rig({ doubleStaged: true }).deps, 'm1');
  assert.equal(p.verdict, 'no-route');
  assert.match(p.detail, /at most 2 staged/);
});

test('🔴 leg (ii): a staging file left after success breaks the bound', async () => {
  assert.equal((await probeLegII(rig({ leaveStaged: true }).deps, 'm1')).verdict, 'no-route');
});

test('🔴 leg (ii): a staging file left after a refused part breaks the bound', async () => {
  assert.equal((await probeLegII(rig({ leaveStagedOnFailure: true }).deps, 'm1')).verdict, 'no-route');
});

test('🔴 leg (ii): a short object is not a pass, however clean the staging was', async () => {
  assert.equal((await probeLegII(rig({ size: 123 }).deps, 'm1')).verdict, 'no-route');
});

test('leg (iii): starting is never a verdict, and it stops part-way', async () => {
  const r = rig();
  const p = await startLegIII(r.deps);
  assert.equal(p.verdict, 'not-established');
  assert.equal(r.sent.length, LEG_III_STOP_AFTER_PARTS);
  assert.equal(r.staged.size, 0);
});

test('leg (iii): a second start does not open a second upload', async () => {
  const r = rig();
  await startLegIII(r.deps);
  const p = await startLegIII(r.deps);
  assert.match(p.detail, /already in flight/);
  assert.equal(r.sent.length, LEG_III_STOP_AFTER_PARTS);
});

test('🔴 leg (iii): resuming with no update in between cannot pass', async () => {
  const r = rig();
  await startLegIII(r.deps);
  const [p] = await resumeLegIII(r.deps);
  assert.equal(p!.verdict, 'not-established');
  assert.match(p!.detail, /no update has happened/);
  assert.equal(r.sent.length, LEG_III_STOP_AFTER_PARTS);
});

test('leg (iii): the next build finishes the job and re-sends nothing', async () => {
  const before = rig();
  await startLegIII(before.deps);
  const after = rig({
    buildId: 'N+1',
    shared: { sessions: before.sessions, descriptors: before.descriptors },
  });
  const [p, id] = await resumeLegIII(after.deps);
  assert.equal(p!.verdict, 'route-exists', p!.detail);
  assert.deepEqual(after.sent, [2, 3], 'parts carried across the update were sent again');
  assert.deepEqual(after.completed, [LEG_III_MEDIA_ID + '.bin:4']);
  assert.equal(after.sessions.size, 0);
  assert.equal(after.descriptors.size, 0);
  // ✕ An identifier we minted must not pass the question about the platform's.
  assert.equal(id!.verdict, 'not-established');
});

test('🔴 leg (iii): a short object keeps the evidence and does not pass', async () => {
  const before = rig();
  await startLegIII(before.deps);
  const after = rig({
    buildId: 'N+1',
    size: 5,
    shared: { sessions: before.sessions, descriptors: before.descriptors },
  });
  const [p] = await resumeLegIII(after.deps);
  assert.equal(p!.verdict, 'no-route');
  assert.equal(after.sessions.size, 1);
});

test('leg (iii): nothing to resume is reported as that, not as a failure', async () => {
  const [p] = await resumeLegIII(rig({ buildId: 'N+1' }).deps);
  assert.equal(p!.verdict, 'not-established');
  assert.match(p!.detail, /nothing to resume/);
});

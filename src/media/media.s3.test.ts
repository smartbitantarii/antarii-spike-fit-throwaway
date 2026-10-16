/**
 * Leg (ii) of axis 5, against a REAL S3 multipart API.
 *
 * ⚠ WHY THIS FILE EXISTS. The four media tests in `queue.test.ts` drive
 * `MediaUploader` against FAKES: a fake platform that records hand-offs, a
 * fake crypto that invents staging files, a fake fs that keeps a Set. They
 * prove the ORDER of operations — one part at a time, deleted on completion
 * and on failure, a grant minted per hand-off — and nothing about whether the
 * resulting bytes are a valid multipart upload. That is the gap recorded as
 * leg (ii) being unverified.
 *
 * This file closes it: real AES-256-CTR encryption, real staging files on a
 * real filesystem, and a real sequential multipart upload to the s3mock
 * container in `antarii-dev-env/spike-1a`. The decisive assertion is that the
 * object S3 reassembles is BYTE-IDENTICAL to the plaintext, which no fake can
 * tell you — it proves the per-part decryption seek, the part ordering and
 * the completion manifest are all right together.
 *
 * SKIPPED, loudly, when the endpoint is not reachable, so `npm test` still
 * passes on a machine with no Docker. It is named `.s3.test.ts` so
 * `node --test` picks it up with everything else rather than hiding behind a
 * separate script nobody runs.
 *
 * ✕ ONE PART OF §5.3.3 IS STILL NOT VERIFIED HERE, deliberately and on the
 * record: `excludeFromBackup` has no meaning on a development machine. iOS
 * backup exclusion and Android's no-backup directory are DEVICE facts, and
 * this file asserts only that the call is made before the hand-off, in the
 * right order. Proving the effect needs leg (iv) on hardware.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createCipheriv, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, readdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MediaUploader,
  type PartRef,
  type StagingFile,
  type Crypto,
  type Fs,
  type PlatformUpload,
  type Grants,
} from './media.ts';

const ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9090';
const BUCKET = process.env.S3_BUCKET ?? 'antarii-spike-media';
/**
 * ⚠ The grant comes from the `1a` STUB, not from this file. The run plan's
 * §4 table is explicit: *"Without a grant issuer, leg (ii)'s staging-part path
 * cannot run at all"* — so a locally minted token would leave the leg resting
 * on a fake exactly where the plan names a real dependency.
 */
const STUBS = process.env.STUBS_ENDPOINT ?? 'http://localhost:8080';

/**
 * ⚠ 5 MiB is NOT a round number chosen for looks. s3mock 5.2.3 enforces S3's
 * real rule — every part but the last must be at least 5 MB — and rejects the
 * COMPLETE with `EntityTooSmall`, having happily accepted each small part with
 * a 200 and an ETag. Found by running it, not by reading about it: a toy part
 * size passes every PUT and fails only at the end.
 *
 * It also makes the "one at a time" claim mean something. Peak plaintext on
 * disk is ONE part, so this run stages 5 MiB at a time rather than 10 MiB at
 * once — which is the whole point of §5.3.3's wording.
 */
const PART = 5 * 1024 * 1024;
/** CTR seeks in 16-byte blocks, so every part offset is block-aligned. */
const BLOCK = 16;

function counterAt(iv: Buffer, blockOffset: number): Buffer {
  const mask = (1n << 128n) - 1n;
  const n = (BigInt('0x' + iv.toString('hex')) + BigInt(blockOffset)) & mask;
  return Buffer.from(n.toString(16).padStart(32, '0'), 'hex');
}

/** Real per-part decryption: seek into the ciphertext, decrypt that range only. */
class RangeCrypto implements Crypto {
  private readonly cipherPath: string;
  private readonly key: Buffer;
  private readonly iv: Buffer;
  private readonly stagingDir: string;

  constructor(cipherPath: string, key: Buffer, iv: Buffer, stagingDir: string) {
    this.cipherPath = cipherPath;
    this.key = key;
    this.iv = iv;
    this.stagingDir = stagingDir;
  }

  async decryptPart(mediaId: string, part: PartRef): Promise<StagingFile> {
    assert.equal(part.offset % BLOCK, 0, 'part offset must be CTR-block aligned');
    const fh = await open(this.cipherPath, 'r');
    try {
      const buf = Buffer.alloc(part.length);
      const { bytesRead } = await fh.read(buf, 0, part.length, part.offset);
      assert.equal(bytesRead, part.length, 'ciphertext shorter than the part claims');
      const d = createDecipheriv('aes-256-ctr', this.key, counterAt(this.iv, part.offset / BLOCK));
      const plain = Buffer.concat([d.update(buf), d.final()]);
      const path = join(this.stagingDir, mediaId + '.part' + part.index);
      await writeFile(path, plain);
      return { path, bytes: plain.length };
    } finally {
      await fh.close();
    }
  }
}

class NodeFs implements Fs {
  readonly excluded: string[] = [];
  async delete(path: string): Promise<void> {
    await rm(path, { force: true });
  }
  async exists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }
  async excludeFromBackup(path: string): Promise<void> {
    // ✕ No device semantics here; see the header. Recorded for ordering only.
    this.excluded.push(path);
  }
}

/**
 * A grant good for one hand-off, obtained from the `1a` grant-issuing stub —
 * the real issuer ADR-003 §5.3.3 presumes, which is single-use AND
 * time-bounded, so a replay is refused even inside the TTL.
 */
class StubGrants implements Grants {
  readonly minted: string[] = [];
  async mint(mediaId: string, part: number): Promise<string> {
    const r = await fetch(STUBS + '/grant?mediaId=' + encodeURIComponent(mediaId) + '&part=' + part);
    assert.equal(r.status, 200, 'the grant stub refused to issue');
    const body = (await r.json()) as { token: string; mediaId: string; part: number };
    assert.equal(body.mediaId, mediaId, 'the grant is for a different media item');
    assert.equal(body.part, part, 'the grant is for a different part');
    this.minted.push(body.token);
    return body.token;
  }
}

async function redeem(token: string): Promise<number> {
  const r = await fetch(STUBS + '/grant/redeem?token=' + encodeURIComponent(token));
  return r.status;
}

function tagOf(xml: string, tag: string): string {
  const m = xml.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>'));
  assert.ok(m, 'expected <' + tag + '> in: ' + xml.slice(0, 400));
  return m[1];
}

/**
 * The platform's background uploader, for real. It owns the multipart session
 * — the upload id and the accumulating ETag manifest — exactly as a real one
 * would; `MediaUploader` owns only "one part at a time", which is the division
 * the interface in `media.ts` already draws.
 */
class S3MultipartPlatform implements PlatformUpload {
  private readonly key: string;
  private readonly stagingDir: string;
  private uploadId: string | null = null;
  private next = 1;
  readonly etags: string[] = [];
  readonly grantsSeen: string[] = [];
  /** staging files present at each hand-off — the "one at a time" witness */
  readonly stagedAtSend: number[] = [];

  constructor(key: string, stagingDir: string) {
    this.key = key;
    this.stagingDir = stagingDir;
  }

  private url(q: string): string {
    return ENDPOINT + '/' + BUCKET + '/' + this.key + q;
  }

  async initiate(): Promise<void> {
    const r = await fetch(this.url('?uploads'), { method: 'POST' });
    assert.equal(r.status, 200, 'initiate multipart');
    this.uploadId = tagOf(await r.text(), 'UploadId');
  }

  async send(file: StagingFile, grant: string): Promise<void> {
    assert.ok(this.uploadId, 'send before initiate');
    // Observed INSIDE the hand-off, which is the only moment at which two
    // plaintext copies could coexist.
    this.stagedAtSend.push((await readdir(this.stagingDir)).length);
    this.grantsSeen.push(grant);

    // The hand-off REDEEMS the grant at the real issuer. This is what makes
    // "does not outlive the moment it was created" an observed fact rather
    // than a comment: the token is spent here, and the replay assertion after
    // the run shows the issuer will not honour it a second time.
    assert.equal(await redeem(grant), 200, 'the issuer refused a grant at its one hand-off');

    const body = await readFile(file.path);
    assert.equal(body.length, file.bytes, 'staged size disagrees with the hand-off');
    const n = this.next++;
    const r = await fetch(this.url('?partNumber=' + n + '&uploadId=' + this.uploadId), {
      method: 'PUT',
      body,
      // The grant travels WITH the request and is never stored on this object,
      // so there is nothing here that could outlive the call.
      headers: { 'x-antarii-grant': grant },
    });
    assert.equal(r.status, 200, 'PUT part ' + n);
    const etag = r.headers.get('etag');
    assert.ok(etag, 'no ETag on part ' + n);
    this.etags.push(etag);
  }

  async complete(): Promise<void> {
    const parts = this.etags
      .map((e, i) => '<Part><PartNumber>' + (i + 1) + '</PartNumber><ETag>' + e + '</ETag></Part>')
      .join('');
    const r = await fetch(this.url('?uploadId=' + this.uploadId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: '<CompleteMultipartUpload>' + parts + '</CompleteMultipartUpload>',
    });
    const text = await r.text();
    assert.equal(r.status, 200, 'complete multipart: ' + text.slice(0, 400));
    assert.ok(!text.includes('<Error>'), 'complete returned an error body: ' + text.slice(0, 400));
  }

  async fetchObject(): Promise<Buffer> {
    const r = await fetch(this.url(''));
    assert.equal(r.status, 200, 'GET the completed object');
    return Buffer.from(await r.arrayBuffer());
  }
}

async function up(url: string, method: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method, signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

/** BOTH halves of `1a` are required: the bucket and the grant issuer. */
const live =
  (await up(ENDPOINT + '/' + BUCKET, 'HEAD')) && (await up(STUBS + '/healthz', 'GET'));
const whyNot =
  'the 1a server side is not up — needs the bucket at ' + ENDPOINT + '/' + BUCKET +
  ' and the grant stub at ' + STUBS +
  '. Bring both up with: cd antarii-dev-env/spike-1a && docker compose up -d --build';

test(
  'leg (ii): a REAL sequential multipart upload reassembles byte-identically, staging one part at a time',
  { skip: live ? false : whyNot },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'antarii-leg2-'));
    const stagingDir = await mkdtemp(join(tmpdir(), 'antarii-staging-'));
    try {
      // ---- a real encrypted media file: two full parts and a tail ----
      const plain = randomBytes(2 * PART + 4096);
      const key = randomBytes(32);
      const iv = randomBytes(16);
      const c = createCipheriv('aes-256-ctr', key, iv);
      const cipherPath = join(dir, 'media.enc');
      await writeFile(cipherPath, Buffer.concat([c.update(plain), c.final()]));

      const parts: PartRef[] = [
        { index: 0, offset: 0, length: PART },
        { index: 1, offset: PART, length: PART },
        { index: 2, offset: 2 * PART, length: 4096 },
      ];

      const crypto = new RangeCrypto(cipherPath, key, iv, stagingDir);
      const fs = new NodeFs();
      const grants = new StubGrants();
      const platform = new S3MultipartPlatform('leg2/media-1.bin', stagingDir);
      await platform.initiate();

      const uploader = new MediaUploader(crypto, fs, platform, grants);
      const outcome = await uploader.upload('media-1', parts);

      assert.equal(outcome.failedAtPart, null, 'no part should have failed');
      assert.equal(outcome.partsSent, 3);

      await platform.complete();

      // ---- THE decisive assertion: S3's reassembly equals the plaintext ----
      const got = await platform.fetchObject();
      assert.equal(got.length, plain.length, 'reassembled length');
      assert.equal(
        createHash('sha256').update(got).digest('hex'),
        createHash('sha256').update(plain).digest('hex'),
        'the object S3 reassembled is not the plaintext — per-part decrypt, ordering or manifest is wrong',
      );

      // ---- §5.3.3's own clauses, now against real files ----
      assert.deepEqual(
        platform.stagedAtSend,
        [1, 1, 1],
        'more than one plaintext part was on disk at a hand-off',
      );
      assert.equal(await uploader.noStagingSurvives(outcome), true, 'a staging file survived');
      assert.deepEqual(await readdir(stagingDir), [], 'the staging directory is not empty');

      assert.equal(new Set(platform.grantsSeen).size, 3, 'a grant was reused across hand-offs');
      assert.deepEqual(
        platform.grantsSeen,
        grants.minted,
        'a grant reached the platform that was not minted for it',
      );
      assert.deepEqual(
        fs.excluded,
        outcome.staged,
        'a part was handed over without being excluded from backup first',
      );

      // §5.3.3's "nothing carrying a credential that outlives the moment it
      // was created", asserted at the ISSUER: every grant is now spent, and
      // the issuer refuses each one a second time.
      for (const g of grants.minted) {
        assert.equal(await redeem(g), 403, 'a spent grant was honoured again — it outlived its moment');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(stagingDir, { recursive: true, force: true });
    }
  },
);

test(
  'leg (ii): a part rejected by the REAL endpoint still leaves no plaintext behind',
  { skip: live ? false : whyNot },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'antarii-leg2f-'));
    const stagingDir = await mkdtemp(join(tmpdir(), 'antarii-stagingf-'));
    try {
      const plain = randomBytes(2 * PART);
      const key = randomBytes(32);
      const iv = randomBytes(16);
      const c = createCipheriv('aes-256-ctr', key, iv);
      const cipherPath = join(dir, 'media.enc');
      await writeFile(cipherPath, Buffer.concat([c.update(plain), c.final()]));

      const crypto = new RangeCrypto(cipherPath, key, iv, stagingDir);
      const fs = new NodeFs();
      // Never initiated, so the endpoint rejects the PUT: a real failure from a
      // real server rather than a fake that throws on command.
      const platform = new S3MultipartPlatform('leg2/doomed.bin', stagingDir);
      (platform as unknown as { uploadId: string }).uploadId = 'not-a-real-upload-id';

      const uploader = new MediaUploader(crypto, fs, platform, new StubGrants());
      const outcome = await uploader.upload('media-2', [
        { index: 0, offset: 0, length: PART },
        { index: 1, offset: PART, length: PART },
      ]);

      assert.equal(outcome.failedAtPart, 0, 'the first part should have failed');
      assert.equal(outcome.partsSent, 0);
      // The half that gets forgotten — and here it is 5 MiB of plaintext.
      assert.equal(await uploader.noStagingSurvives(outcome), true, 'plaintext survived a real failure');
      assert.deepEqual(
        await readdir(stagingDir),
        [],
        'the staging directory is not empty after a failure',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(stagingDir, { recursive: true, force: true });
    }
  },
);

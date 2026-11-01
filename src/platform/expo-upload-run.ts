/**
 * Round 3, the platform half of `src/media/upload-run.ts`.
 *
 * The object store is the `1a` S3 container on the development machine: the
 * same host as the collector, on port 9090.
 */
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';

import type { SqliteLike } from '../store/store.ts';
import { SqliteSessionStore } from '../media/session.ts';
import type { Grants } from '../media/media.ts';
import {
  SqliteDescriptorStore,
  type ObjectEndpoint,
  type UploadRunDeps,
} from '../media/upload-run.ts';
import {
  ExpoFs,
  ExpoMediaCrypto,
  sealMediaInParts,
  stagingDir,
} from './expo-media-crypto.ts';
import { ExpoPartUpload, newTransferSession } from './expo-media.ts';

const BUCKET = 'antarii-spike-media';
const S3_PORT = 9090;
/** 16 MiB at 5 MiB a part is four parts, so an upload can stop half way. */
const TEST_FILE_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * ⚠ `fetch` has no default timeout, and on a phone a stalled connection would
 * look like a frozen button. `media.s3.test.ts` learned this the hard way.
 */
async function fetchOrFail(url: string, init: RequestInit = {}): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: abort.signal });
  } catch (err) {
    throw new Error('request to ' + url + ' failed: ' + String(err));
  } finally {
    clearTimeout(timer);
  }
}

class S3Endpoint implements ObjectEndpoint {
  private readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  private url(key: string, query: string): string {
    return this.base + '/' + BUCKET + '/' + key + query;
  }

  async initiate(key: string): Promise<string> {
    const r = await fetchOrFail(this.url(key, '?uploads'), { method: 'POST' });
    const xml = await r.text();
    const m = xml.match(/<UploadId>([^<]*)<\/UploadId>/);
    if (r.status !== 200 || !m) throw new Error('initiate answered ' + r.status);
    return m[1]!;
  }

  async complete(
    key: string,
    uploadId: string,
    manifest: readonly { index: number; etag: string }[],
  ): Promise<void> {
    const parts = [...manifest]
      .sort((a, b) => a.index - b.index)
      .map((p) => `<Part><PartNumber>${p.index + 1}</PartNumber><ETag>${p.etag}</ETag></Part>`)
      .join('');
    const r = await fetchOrFail(this.url(key, '?uploadId=' + uploadId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: '<CompleteMultipartUpload>' + parts + '</CompleteMultipartUpload>',
    });
    const text = await r.text();
    if (r.status !== 200 || text.includes('<Error>')) {
      throw new Error('complete answered ' + r.status + ': ' + text.slice(0, 200));
    }
  }

  async objectSize(key: string): Promise<number> {
    const r = await fetchOrFail(this.url(key, ''), { method: 'HEAD' });
    if (r.status !== 200) throw new Error('HEAD answered ' + r.status);
    return Number(r.headers.get('content-length'));
  }
}

class StubGrants implements Grants {
  private readonly collector: string;

  constructor(collector: string) {
    this.collector = collector;
  }

  async mint(mediaId: string, part: number): Promise<string> {
    const r = await fetchOrFail(
      this.collector + '/grant?mediaId=' + encodeURIComponent(mediaId) + '&part=' + part,
    );
    if (r.status !== 200) throw new Error('the grant stub answered ' + r.status);
    return ((await r.json()) as { token: string }).token;
  }
}

/** A throwaway file. The bytes do not matter here; the path they take does. */
async function writeTestFile(mediaId: string): Promise<string> {
  const block = Crypto.getRandomValues(new Uint8Array(64 * 1024));
  const bytes = new Uint8Array(TEST_FILE_BYTES);
  for (let at = 0; at < bytes.length; at += block.length) {
    bytes.set(block.subarray(0, Math.min(block.length, bytes.length - at)), at);
  }
  const f = new File(Paths.cache, mediaId + '.src');
  if (f.exists) f.delete();
  f.create();
  await f.write(bytes);
  return f.uri;
}

export async function uploadRunDeps(
  db: SqliteLike,
  collector: string,
  buildId: string,
): Promise<UploadRunDeps> {
  const sessions = new SqliteSessionStore(db, buildId);
  await sessions.init();
  const descriptors = new SqliteDescriptorStore(db);
  await descriptors.init();

  // ⚠ A collector address with no port leaves the replace with nothing to do,
  // so the failure names the address rather than reaching for port 80.
  const s3 = collector.replace(/\/+$/, '').replace(/:\d+$/, ':' + S3_PORT);
  const base = collector.replace(/\/+$/, '');

  return {
    buildId,
    sessions,
    descriptors,
    endpoint: new S3Endpoint(s3),
    fs: new ExpoFs(),
    grants: new StubGrants(base),
    cryptoFor: (d) => new ExpoMediaCrypto(d),
    platformFor: (key, uploadId) => new ExpoPartUpload(s3, BUCKET, key, uploadId),
    stagingCount: async () => stagingDir().list().length,
    seal: async (mediaId) => sealMediaInParts(await writeTestFile(mediaId), mediaId),
    discard: async (d) => new ExpoMediaCrypto(d).deleteSealed(),
    newSession: newTransferSession,
  };
}

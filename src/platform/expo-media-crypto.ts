/**
 * #25 — media encrypted at rest on the device, with AES-GCM per part.
 *
 * ADR-003 §5.3's chosen **option A**: "the store is encrypted as a whole and
 * **media files** under the same hierarchy; the key-encryption key is bound to
 * this application on this device". So media are encrypted **files**, not rows
 * in the database — which is why this exists rather than media being written
 * into SQLCipher.
 *
 * 🔴 A CORRECTION IS RECORDED HERE BECAUSE IT CHANGED THE PLAN. This work was
 * briefly blocked on a claim that *"`expo-crypto` provides no AES and nothing
 * in the stack encrypts on the device"*. **That was false** — it came from
 * reading `expo-crypto/build/Crypto.d.ts` and treating one file as the whole
 * module, when the AES surface lives in `build/aes/`. `expo-crypto` is a
 * first-party, already-pinned module and it does AES-GCM. No new dependency
 * and no technology decision were needed.
 *
 * ✕ WHAT IS NOT MODELLED, STATED PLAINLY. §5.3.5's key **hierarchy** — one
 * key-encryption key wrapping per-item data-encryption keys — is **not** built
 * here. `expo-crypto` offers no key-derivation function (digests and
 * randomness only), and deriving one by hand would be inventing cryptography.
 * The spike therefore holds **two sibling keys** in the keystore under
 * identical protection flags: the store's and the media's. That satisfies
 * "bound to this application on this device" and does **not** satisfy "under
 * the same hierarchy" in the strict sense. It is a spike limitation, not a
 * design proposal.
 */
import * as SecureStore from 'expo-secure-store';
import {
  AESEncryptionKey,
  AESSealedData,
  aesEncryptAsync,
  aesDecryptAsync,
  type GCMTagByteLength,
} from 'expo-crypto';
import { File, Directory, Paths } from 'expo-file-system';

import type { Crypto, Fs, PartRef, StagingFile } from '../media/media.ts';
import {
  planChunks,
  planFromDescriptor,
  aadFor,
  sealedPartName,
  stagingPartName,
  DEFAULT_CHUNK_BYTES,
  type EncryptedMediaDescriptor,
} from '../media/chunking.ts';

const MEDIA_KEY_ITEM = 'antarii.spike.mediakey';

/**
 * ⚠ The same flags as the store's key, for the same reason: `SwR`-level
 * device-binding depends on `WHEN_UNLOCKED_THIS_DEVICE_ONLY` making the item
 * non-migratable, and §5.3.1's state table rests on it. Stated in one place so
 * a leg (iv) failure is attributable without reading the app.
 */
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** The media key, minted once and then read from the keystore. */
export async function mediaKey(): Promise<AESEncryptionKey> {
  const existing = await SecureStore.getItemAsync(MEDIA_KEY_ITEM, KEY_OPTIONS);
  if (existing) return AESEncryptionKey.import(existing, 'hex');
  const fresh = await AESEncryptionKey.generate(256);
  await SecureStore.setItemAsync(MEDIA_KEY_ITEM, await fresh.encoded('hex'), KEY_OPTIONS);
  return fresh;
}

/** Where sealed parts live: durable, and encrypted, so a backup of it is safe. */
function sealedDir(): Directory {
  const d = new Directory(Paths.document, 'media');
  if (!d.exists) d.create();
  return d;
}

/**
 * Where staging plaintext lives.
 *
 * 🔴 THE CACHE DIRECTORY *IS* THE BACKUP EXCLUSION. §5.3.3 requires the
 * staging file "excluded from backup", and `expo-file-system` exposes no
 * backup-exclusion call. `Paths.cache` is documented as "a place to store
 * files that can be deleted by the system when the device runs low on
 * storage" — the OS-purgeable cache, which is outside the backup set on both
 * platforms. So the requirement is met **by location rather than by an API
 * call**, and `ExpoFs.excludeFromBackup` below asserts the location instead of
 * pretending to do something.
 *
 * ⚠ That it is genuinely outside the backup set is an ECOSYSTEM claim against
 * a May 2026 cutoff and is leg (iv)'s business to confirm on hardware.
 */
function stagingDir(): Directory {
  const d = new Directory(Paths.cache, 'staging');
  if (!d.exists) d.create();
  return d;
}

/**
 * Seals a captured file into per-part GCM blobs and returns the descriptor the
 * uploader must later plan from.
 *
 * ⚠ Each chunk is read with `File.slice(...).arrayBuffer()`, so the **whole
 * media file is never loaded at once** — only one chunk at a time, which is
 * the same discipline §5.3.3 imposes on the upload side.
 */
export async function sealMediaInParts(
  sourceUri: string,
  mediaId: string,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
): Promise<EncryptedMediaDescriptor> {
  const source = new File(sourceUri);
  const totalBytes = source.size;
  if (totalBytes === null || totalBytes <= 0) {
    throw new Error('the captured file at ' + sourceUri + ' has no readable size');
  }

  // Refuses a chunk size that would seal cleanly and become un-uploadable.
  const parts = planChunks(totalBytes, chunkBytes);
  const key = await mediaKey();
  const dir = sealedDir();

  let ivLength: number | null = null;
  let tagLength: number | null = null;

  for (const part of parts) {
    const slice = await source.slice(part.offset, part.offset + part.length).arrayBuffer();
    const sealed = await aesEncryptAsync(new Uint8Array(slice), key, {
      // Binds the part to this media item and this index: a substituted part
      // fails authentication rather than decrypting into the wrong place.
      additionalData: aadFor(mediaId, part.index),
    });

    // ⚠ READ, not assumed. `fromCombined` needs both lengths to split the blob
    // again, and a wrong value yields a decrypt failure indistinguishable from
    // corruption. GCM's usual nonce is 12 bytes and the default tag 16, but
    // these come off the sealed data itself.
    const iv = (await sealed.iv()).length;
    const tag = (await sealed.tag()).length;
    if (ivLength === null) {
      ivLength = iv;
      tagLength = tag;
    } else if (iv !== ivLength || tag !== tagLength) {
      throw new Error('the IV or tag length varied between parts, so one descriptor cannot describe them');
    }

    const out = new File(dir, sealedPartName(mediaId, part.index));
    if (out.exists) out.delete();
    out.create();
    await out.write(await sealed.combined('bytes'));
  }

  /**
   * ⚠ The plaintext capture is deleted once every part is sealed, and not
   * before. §5.3.3's whole point is that plaintext does not survive outside
   * the encrypted store; deleting it earlier would risk losing the capture if
   * sealing failed halfway.
   */
  source.delete();

  return {
    mediaId,
    totalBytes,
    chunkBytes,
    ivLength: ivLength!,
    tagLength: tagLength!,
    partCount: parts.length,
  };
}

/**
 * The device's `Crypto`: decrypts exactly one part into a staging file.
 *
 * ⚠ It takes a DESCRIPTOR, not a chunk size. Media sealed under an older
 * default must be split on the boundaries it was sealed with, which is what
 * `planFromDescriptor` guarantees and what a constant would silently break.
 */
export class ExpoMediaCrypto implements Crypto {
  private readonly descriptor: EncryptedMediaDescriptor;

  constructor(descriptor: EncryptedMediaDescriptor) {
    // Validates the descriptor against its own figures before anything trusts it.
    planFromDescriptor(descriptor);
    this.descriptor = descriptor;
  }

  async decryptPart(mediaId: string, part: PartRef): Promise<StagingFile> {
    if (mediaId !== this.descriptor.mediaId) {
      throw new Error('this crypto describes ' + this.descriptor.mediaId + ', not ' + mediaId);
    }

    const sealedFile = new File(sealedDir(), sealedPartName(mediaId, part.index));
    if (!sealedFile.exists) throw new Error('no sealed part ' + part.index + ' for ' + mediaId);

    const sealed = AESSealedData.fromCombined(await sealedFile.bytes(), {
      ivLength: this.descriptor.ivLength,
      // ⚠ The cast is narrowing, not inventing. `expo-crypto` types this as
      // `GCMTagByteLength` (a union of the permitted byte lengths) while the
      // descriptor stores a plain number — because the value was READ off the
      // sealed data rather than chosen, so it is whatever the platform used.
      tagLength: this.descriptor.tagLength as GCMTagByteLength,
    });

    const plain = await aesDecryptAsync(sealed, await mediaKey(), {
      output: 'bytes',
      // The same binding used when sealing; a mismatch fails authentication.
      additionalData: aadFor(mediaId, part.index),
    });

    if (plain.length !== part.length) {
      throw new Error(
        'part ' + part.index + ' decrypted to ' + plain.length + ' bytes, not the planned ' + part.length,
      );
    }

    const out = new File(stagingDir(), stagingPartName(mediaId, part.index));
    if (out.exists) out.delete();
    out.create();
    await out.write(plain);
    return { path: out.uri, bytes: plain.length };
  }

  /** Once an upload completes, the sealed parts are what remains of the media. */
  async deleteSealed(): Promise<void> {
    for (const part of planFromDescriptor(this.descriptor)) {
      const f = new File(sealedDir(), sealedPartName(this.descriptor.mediaId, part.index));
      if (f.exists) f.delete();
    }
  }
}

/**
 * The device's `Fs` for the uploader.
 *
 * ⚠ `excludeFromBackup` ASSERTS rather than acts, and that is the honest shape:
 * the exclusion is achieved by staging inside the OS cache directory, and there
 * is no API to call. A no-op that silently returned would let a future change
 * stage somewhere backed up without anything noticing.
 */
export class ExpoFs implements Fs {
  async delete(path: string): Promise<void> {
    const f = new File(path);
    if (f.exists) f.delete();
  }

  async exists(path: string): Promise<boolean> {
    return new File(path).exists;
  }

  async excludeFromBackup(path: string): Promise<void> {
    const cache = Paths.cache.uri;
    if (!path.startsWith(cache)) {
      throw new Error(
        'a staging file must live under the cache directory, which is how §5.3.3\'s backup ' +
          'exclusion is achieved — ' + path + ' is outside ' + cache,
      );
    }
  }
}

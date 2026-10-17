/**
 * #25 — the part boundaries, fixed at ENCRYPTION time.
 *
 * ⚠ WHY THIS FILE HAS TO EXIST, AND WHY IT IS THE PART THAT MATTERS.
 * `expo-crypto`'s AES is **GCM**, and GCM's authentication tag covers the
 * whole message — so a GCM ciphertext **cannot be decrypted from an offset**.
 * There is no "seek to byte 5,242,880 and decrypt from there".
 *
 * ADR-003 §5.3.3 requires "one multipart part at a time decrypted into a
 * staging file", so each part must be **its own sealed blob**, with its own IV
 * and its own tag. Which means:
 *
 *   🔴 **The part size is decided when the media is ENCRYPTED, not when it is
 *   uploaded**, because sealed blobs cannot be re-chunked afterwards.
 *
 * And that collides with a fact established by running s3mock: **S3 refuses
 * every part under 5 MB at the COMPLETE step**, having accepted each one with
 * a 200 on the way in. So a chunk size chosen at capture that is too small
 * makes the media **un-uploadable later**, and the failure surfaces at the end
 * of a slow upload rather than at the start.
 *
 * ➕ One benefit falls out of per-part sealing: **each part is independently
 * authenticated**, so a corrupted part is *detected*. A CTR-mode seek — what
 * the integration test's double does — would decrypt corruption into plausible
 * garbage without complaint.
 *
 * Imports only the part shape. No platform calls; see `expo-media-crypto.ts`.
 */
import type { PartRef } from './media.ts';

/**
 * S3's own rule, and it is **verified rather than quoted**: `adobe/s3mock`
 * 5.2.3 accepted three small parts with 200 and an ETag each, then failed the
 * complete with `EntityTooSmall` and created no object.
 */
export const S3_MIN_PART_BYTES = 5 * 1024 * 1024;

/** S3's part-number ceiling. A chunk size too small runs into this as well. */
export const S3_MAX_PARTS = 10_000;

/**
 * ➕ **THE AUTHOR'S RECOMMENDATION, ON THE OWNER'S GO AHEAD 2026-10-17, AND
 * NOTHING IN THE CORPUS SETS IT.** 5 MiB is S3's own floor, so every part but
 * the last is valid by construction and no larger buffer than necessary passes
 * through JavaScript.
 *
 * ⚠ It is not free: each part is read, sealed and later decrypted as a ~5 MiB
 * buffer, which is a memory and timing cost landing on **condition 1's S5
 * figure** and **§3b's footprint**. That is for the bench to measure, not for
 * this comment to predict.
 */
export const DEFAULT_CHUNK_BYTES = S3_MIN_PART_BYTES;

/**
 * What is "recorded alongside the media" so the uploader uses exactly the
 * boundaries the encryption used.
 *
 * ⚠ `ivLength` and `tagLength` are recorded rather than assumed. GCM's usual
 * nonce is 12 bytes and `expo-crypto`'s default tag is 16, but
 * `AESSealedData.fromCombined` needs both to split a combined blob, and
 * getting either wrong yields a decrypt failure that looks like corruption.
 * The encrypting code reads them off the sealed data it just produced, so this
 * descriptor carries measured values, not folklore.
 */
export interface EncryptedMediaDescriptor {
  mediaId: string;
  /** plaintext length, which is what the part plan is computed from */
  totalBytes: number;
  /** the chunk size in force when this media was sealed */
  chunkBytes: number;
  ivLength: number;
  tagLength: number;
  partCount: number;
}

/**
 * The part plan. Every part is exactly `chunkBytes` except the last, which is
 * whatever remains — which is precisely the shape S3's minimum permits.
 */
export function planChunks(totalBytes: number, chunkBytes: number): PartRef[] {
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) {
    throw new Error('media length must be a positive whole number of bytes');
  }
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error('chunk size must be a positive whole number of bytes');
  }

  const count = Math.ceil(totalBytes / chunkBytes);

  /**
   * ⚠ The single-part case is exempt, and deliberately so. S3's rule is that
   * every part "except the last" meets the minimum; with one part it IS the
   * last, so a 40 kB photograph is a legal single-part upload. Rejecting it
   * would refuse the common case to satisfy a rule that does not apply.
   */
  if (count > 1 && chunkBytes < S3_MIN_PART_BYTES) {
    throw new Error(
      'a chunk size of ' +
        chunkBytes +
        ' bytes would produce ' +
        count +
        ' parts, and S3 refuses any part below ' +
        S3_MIN_PART_BYTES +
        ' bytes except the last — the media would seal cleanly and become un-uploadable',
    );
  }
  if (count > S3_MAX_PARTS) {
    throw new Error(
      'a chunk size of ' + chunkBytes + ' bytes would need ' + count + ' parts, over S3\'s limit of ' + S3_MAX_PARTS,
    );
  }

  const parts: PartRef[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * chunkBytes;
    parts.push({ index: i, offset, length: Math.min(chunkBytes, totalBytes - offset) });
  }
  return parts;
}

/**
 * The plan for already-sealed media, taken from its descriptor rather than
 * from whatever the current default happens to be.
 *
 * 🔴 THIS IS THE FUNCTION THAT PREVENTS THE REAL BUG. If `DEFAULT_CHUNK_BYTES`
 * ever changes, media sealed under the old value must still be read with the
 * old boundaries. Computing the plan from the descriptor makes that automatic;
 * computing it from the constant would silently mis-split every older item.
 */
export function planFromDescriptor(d: EncryptedMediaDescriptor): PartRef[] {
  const parts = planChunks(d.totalBytes, d.chunkBytes);
  if (parts.length !== d.partCount) {
    throw new Error(
      'the descriptor claims ' + d.partCount + ' parts but its own figures give ' + parts.length,
    );
  }
  return parts;
}

/**
 * The additional authenticated data for one part.
 *
 * ➕ **NOT REQUIRED BY ANY REQUIREMENT, AND WORTH IT.** GCM authenticates the
 * ciphertext, which stops a part being *altered* — it does not stop a part
 * being **substituted** for a different part, or for a part of a different
 * media item sealed under the same key. Binding the media id and the part
 * index into the AAD makes such a swap fail authentication instead of
 * decrypting cleanly into the wrong place.
 *
 * ⚠ The same value must be supplied on decrypt, which is why it is a function
 * in the shared module rather than a string written out at each call site.
 */
export function aadFor(mediaId: string, partIndex: number): string {
  if (!mediaId) throw new Error('a part cannot be bound to an empty media id');
  if (!Number.isInteger(partIndex) || partIndex < 0) {
    throw new Error('a part index must be a non-negative whole number');
  }
  return 'antarii/media/' + mediaId + '/part/' + partIndex;
}

/** The on-disk name of one sealed part. */
export function sealedPartName(mediaId: string, partIndex: number): string {
  return mediaId + '.part' + partIndex + '.sealed';
}

/**
 * The staging file's name. ⚠ It carries `.partN` because the uploader derives
 * the S3 part number from the path — on a resume the second run's first part
 * is not part 1, so a counter would complete the upload to the wrong object.
 * Changing this name breaks that derivation, which is why it lives here beside
 * the thing that depends on it.
 */
export function stagingPartName(mediaId: string, partIndex: number): string {
  return mediaId + '.part' + partIndex;
}

/**
 * Build 1, thing 4 — the media path. This is leg (ii) of axis 5.
 *
 * ADR-003 §5.3.3, which every rule below comes from:
 *   media is stored ENCRYPTED; at upload, ONE MULTIPART PART AT A TIME is
 *   decrypted into a STAGING FILE, handed to the platform, and DELETED ON
 *   COMPLETION OR FAILURE, excluded from backup; and "nothing is handed to
 *   the platform carrying a credential that outlives the moment it was
 *   created".
 *
 * The platform and crypto are injected, so this is testable before a device
 * exists — and so the same logic runs against either platform's uploader.
 */

export interface PartRef {
  index: number;
  /** byte range of this part within the plaintext */
  offset: number;
  length: number;
}

export interface StagingFile {
  path: string;
  bytes: number;
}

/** What the platform's background uploader needs, and nothing more. */
export interface PlatformUpload {
  /**
   * Hands one staged part to the platform. The grant is created for this call
   * and must not outlive it (§5.3.3), so it is a parameter rather than state.
   */
  send(file: StagingFile, grant: string): Promise<void>;
}

export interface Crypto {
  /** decrypt exactly one part into a staging file */
  decryptPart(mediaId: string, part: PartRef): Promise<StagingFile>;
}

export interface Fs {
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** iOS: excluded from backup; Android: no-backup directory (§5.3.3) */
  excludeFromBackup(path: string): Promise<void>;
}

export interface Grants {
  /** a grant valid for one hand-off only */
  mint(mediaId: string, part: number): Promise<string>;
}

export interface UploadOutcome {
  mediaId: string;
  partsSent: number;
  /** every staging file created, so a test can assert none survived */
  staged: string[];
  failedAtPart: number | null;
}

export class MediaUploader {
  private readonly crypto: Crypto;
  private readonly fs: Fs;
  private readonly platform: PlatformUpload;
  private readonly grants: Grants;

  constructor(crypto: Crypto, fs: Fs, platform: PlatformUpload, grants: Grants) {
    this.crypto = crypto;
    this.fs = fs;
    this.platform = platform;
    this.grants = grants;
  }

  /**
   * One part at a time. Deliberately sequential: §5.3.3 says "one multipart
   * part at a time", and staging two parts at once would put two plaintext
   * copies on disk, which is the thing the rule exists to prevent.
   */
  async upload(mediaId: string, parts: readonly PartRef[]): Promise<UploadOutcome> {
    const staged: string[] = [];
    let partsSent = 0;

    for (const part of parts) {
      let file: StagingFile | null = null;
      try {
        file = await this.crypto.decryptPart(mediaId, part);
        staged.push(file.path);
        // excluded from backup before anything is written out of our control
        await this.fs.excludeFromBackup(file.path);

        // minted per hand-off, so it cannot outlive the moment it was created
        const grant = await this.grants.mint(mediaId, part.index);
        await this.platform.send(file, grant);
        partsSent++;
      } catch (err) {
        // "deleted on completion OR FAILURE" — the failure half is the one
        // that gets forgotten, and it is the one that leaves plaintext behind
        if (file) await this.safeDelete(file.path);
        return { mediaId, partsSent, staged, failedAtPart: part.index };
      }
      await this.safeDelete(file.path);
    }

    return { mediaId, partsSent, staged, failedAtPart: null };
  }

  /** A delete that cannot itself leave the staging file behind by throwing. */
  private async safeDelete(path: string): Promise<void> {
    try {
      await this.fs.delete(path);
    } catch {
      // swallowed deliberately: a failed delete must not abort the loop and
      // strand later parts, and the leak is observable via fs.exists in the
      // conformance check below
    }
  }

  /** Leg (ii)'s assertion, usable on a device as well as in a test. */
  async noStagingSurvives(outcome: UploadOutcome): Promise<boolean> {
    for (const p of outcome.staged) {
      if (await this.fs.exists(p)) return false;
    }
    return true;
  }
}

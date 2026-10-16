/**
 * Leg (iii)'s first subject, and a finding about it.
 *
 * 🔴 READ AT SOURCE, `expo-file-system` 58.0.9 EXPOSES NO TRANSFER SESSION
 * IDENTIFIER AT ALL. Its `UploadTask` class declares `state`, `uploadAsync()`,
 * `addListener()`, `release()` and `cancel()` and nothing else, and a search
 * for any identifier across every `.d.ts` in the module returns nothing. Its
 * own documentation of `sessionType` says why that matters:
 *
 *   "When set to 'background', the native transfer may continue after the app
 *   is suspended. However, the JavaScript `UploadTask` instance **is not
 *   restored if the app is terminated or relaunched**, so its promise,
 *   progress callbacks, and cancellation state are only available while the
 *   original JS runtime is still alive."
 *
 * An application update terminates and relaunches the app. So **there is no
 * API by which a relaunched build can re-attach to a transfer the previous
 * build started**, and leg (iii)'s question — "the platform transfer session
 * identifier stable across it" — has no platform identifier to ask about.
 *
 * ⚠ THIS IS A FINDING, NOT A GAP IN THIS FILE, and it is why `provenance`
 * exists. A session identifier we minted ourselves would be stable across an
 * update *by construction* and would prove nothing; recording WHERE the
 * identifier came from is what keeps the verdict honest. If a platform ever
 * exposes one, `provenance` becomes `'platform'` and the cell can be answered
 * on its own terms.
 *
 * ➕ And it is the reason N+1's persisted multipart session matters. `SwR-112`
 * requires synchronisation to be resumable and "its unsynchronised work shall
 * be preserved through the update" — which, given the above, **cannot rest on
 * the platform carrying the session**. It rests on our own persisted upload id
 * and part list, which is what `session.ts` stores and what the leg (iii)
 * integration test resumes from.
 */

export type TransferSessionProvenance = 'platform' | 'ours';

export interface TransferSessionInfo {
  id: string;
  provenance: TransferSessionProvenance;
  /**
   * Why the provenance is what it is — carried into the record so §8 does not
   * have to take anyone's word for it.
   */
  because: string;
}

export const NO_PLATFORM_SESSION_REASON =
  'expo-file-system 58.0.9 exposes no transfer session identifier, and its own typings state the ' +
  'JS UploadTask is not restored after the app is terminated or relaunched — which is what an ' +
  'application update does';

/**
 * ⚠ Minted ONCE and then persisted, never regenerated. The whole value of an
 * identifier here is that it is the same one after the update, so a function
 * that returned a fresh value on each call would silently defeat the thing it
 * exists to support. `SqliteSessionStore` is what makes it durable; this only
 * mints the first one.
 */
export function mintOurSessionId(randomHex: string, atMs: number): TransferSessionInfo {
  if (!/^[0-9a-f]{8,}$/.test(randomHex)) {
    throw new Error('a session id needs at least 8 bytes of hex entropy');
  }
  return {
    id: 'ours-' + atMs.toString(36) + '-' + randomHex,
    provenance: 'ours',
    because: NO_PLATFORM_SESSION_REASON,
  };
}

/** For the day a platform does expose one. */
export function fromPlatform(id: string, because: string): TransferSessionInfo {
  if (!id) throw new Error('a platform session identifier cannot be empty');
  return { id, provenance: 'platform', because };
}

/**
 * The gate-cell rule's three verdicts, applied to leg (iii)'s first subject.
 *
 * ⚠ `'ours'` does NOT pass the cell. The cell asks about the PLATFORM's
 * identifier; answering it with ours would be the same class of error the
 * review found twice in this initiative — an unverified or unrelated fact
 * excusing the thing under test. It is *Not established*, and the reason is
 * carried with it.
 */
export function legIiiFirstSubjectVerdict(
  info: TransferSessionInfo,
): { verdict: 'Passes' | 'Fails' | 'Not established'; reason: string } {
  if (info.provenance === 'platform') {
    return {
      verdict: 'Passes',
      reason: 'the platform supplied the identifier and it survived the update: ' + info.id,
    };
  }
  return {
    verdict: 'Not established',
    reason:
      'no platform transfer session identifier exists to be stable — ' +
      info.because +
      '. Resumability is instead carried by the persisted multipart session (SwR-112), which leg ' +
      '(iii) does verify.',
  };
}

/**
 * The device half of getting §8's record off the phone.
 *
 * ⚠ One of the modules in `src/platform/`, which is the only place in `src/`
 * that imports Expo. Every rule about delivery — the loopback refusal, the
 * fallback naming, never losing a record — lives in `src/harness/delivery.ts`
 * and is tested on a development machine. This file is transport and storage.
 */
import { File, Directory, Paths } from 'expo-file-system';

import type { PostJson } from '../harness/delivery.ts';

/**
 * ⚠ A DEADLINE, BECAUSE A STALL IS NOT A FAILURE AND THAT IS THE PROBLEM.
 * `fetch` has no default timeout; without this, a collector that accepts the
 * connection and never answers — a sleeping laptop, a half-open Wi-Fi link —
 * would hang the delivery for as long as the app lives, with the figures
 * still in memory and the operator watching a spinner. This project has
 * already lost a test run to exactly that.
 */
const DELIVERY_TIMEOUT_MS = 30_000;

export const expoPost: PostJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
};

/**
 * Where a record goes when the collector cannot be reached.
 *
 * 🔴 `Paths.document`, NOT `Paths.cache`. The cache is the OS-purgeable
 * directory — it is the right home for a staging file precisely because the
 * system may delete it, and the worst possible home for the only copy of a
 * campaign's figures. The two are one line apart and the consequence is the
 * difference between a slow recovery and a lost run.
 */
function figuresDir(): Directory {
  const d = new Directory(Paths.document, 'figures');
  if (!d.exists) d.create();
  return d;
}

/** Writes the record to the device. Returns the uri so the operator can find it. */
export async function writeFigureFallback(filename: string, json: string): Promise<string> {
  const f = new File(figuresDir(), filename);
  if (f.exists) f.delete();
  f.create();
  await f.write(json);
  return f.uri;
}

/** Every record still waiting on the device, oldest name first. */
export function pendingFallbacks(): string[] {
  const d = figuresDir();
  return d
    .list()
    .filter((e) => e instanceof File)
    .map((e) => (e as File).name)
    .sort();
}

// ---------------------------------------------------------------------------
// The collector address.
// ---------------------------------------------------------------------------

/**
 * ⚠ A FILE, NOT THE KEYSTORE. The collector address is a development
 * convenience, not a secret, and `expo-secure-store` is where the database
 * key lives — putting an operator setting beside it would blur a boundary
 * that axis 5 leg (iv) depends on being sharp.
 *
 * ➕ And it is persisted at all because it changes: the development machine's
 * LAN address moves between networks, and re-typing it on a phone keyboard
 * before every delivery is how it ends up wrong.
 */
const ADDRESS_FILE = 'collector-address.txt';

export function readCollectorBase(): string {
  try {
    const f = new File(figuresDir(), ADDRESS_FILE);
    if (!f.exists) return '';
    return f.textSync().trim();
  } catch {
    return '';
  }
}

export async function saveCollectorBase(base: string): Promise<void> {
  const f = new File(figuresDir(), ADDRESS_FILE);
  if (f.exists) f.delete();
  f.create();
  await f.write(base.trim());
}

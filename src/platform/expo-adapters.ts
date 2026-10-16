/**
 * The ONLY module that imports Expo. Everything else in src/ is plain
 * TypeScript and tested with `node --test` on a development machine.
 *
 * Keeping the boundary here is what let build 1's logic — re-evaluation, the
 * queue, the media path, the store's driving order — be written and tested
 * before any dependency was installed, and it is what keeps axis 5 leg
 * (iv)'s three causes attributable: a failure in this file is the package or
 * our key's flags; a failure behind it is the prototype.
 */
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

import type { KeyProvider, OpenDatabase, SqliteLike } from '../store/store.ts';

/**
 * ADR-003 §5.3: the key lives in the platform keystore, bound to the
 * application. expo-secure-store is the Keychain on iOS and the Keystore on
 * Android; WHEN_UNLOCKED_THIS_DEVICE_ONLY is the flag that makes it
 * device-bound and non-migratable, which §5.3.1's state table depends on.
 *
 * ⚠ These flags are leg (iv) cause (a)'s subject — "our key's flags, a
 * prototype fix, re-run, no package change". They are stated in one place on
 * purpose so a leg (iv) failure can be attributed without reading the app.
 */
const KEY_ITEM = 'antarii.spike.dbkey';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const keystoreKeyProvider: KeyProvider = {
  async key(): Promise<string> {
    const existing = await SecureStore.getItemAsync(KEY_ITEM, KEY_OPTIONS);
    if (existing) return existing;
    // 32 bytes, hex — SQLCipher accepts a passphrase or a raw key; a
    // passphrase is used here so the spike measures SQLCipher's own KDF,
    // which is part of what the 300 ms budget has to absorb.
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(KEY_ITEM, hex, KEY_OPTIONS);
    return hex;
  },
};

/** expo-sqlite's async API, narrowed to what the store actually uses. */
export const openExpoDatabase: OpenDatabase = async (name: string): Promise<SqliteLike> => {
  const db = await SQLite.openDatabaseAsync(name);
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params) => {
      await db.runAsync(sql, params as SQLite.SQLiteBindParams);
    },
    getAllAsync: (sql, params) =>
      db.getAllAsync(sql, params as SQLite.SQLiteBindParams) as Promise<Array<Record<string, unknown>>>,
    closeAsync: () => db.closeAsync(),
  };
};

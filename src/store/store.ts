/**
 * Build 1, thing 2 — the encrypted store.
 *
 * D1: expo-sqlite@58.0.13 with SQLCipher, enabled through the first-party
 * config plugin (app.json: `useSQLCipher: true`). D2 is therefore that
 * plugin, and the spike writes none.
 *
 * ADR-003 §5.3: the key lives in the platform keystore, bound to the
 * application. §5.3.1's state table is what axis 5 leg (iv) exercises.
 *
 * The store is defined as an interface first so the queue, the form and the
 * harness can be tested without a device — and so leg (iv)'s three causes
 * stay separable: cause (a) is OUR KEY'S FLAGS, cause (b) is THE PACKAGE.
 * A single class mixing both would make a failure unattributable, and §7
 * rule 2 sends those two causes to different places.
 */

export interface EncryptedStore {
  /** opens, keying the database; throws if the key is wrong or absent */
  open(): Promise<void>;
  /** SwR-066's clock stops when the write is COMMITTED, not queued (brief §6c) */
  putAnswer(record: string, field: string, value: unknown): Promise<void>;
  getAnswers(record: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/**
 * Where the key comes from. Separated deliberately: ADR-003 §5.3.4 asks what
 * releases the key and §5.3.5 the no-contact clock, and leg (iv) cause (a) is
 * "our key's flags — a prototype fix, re-run, no package change". Keeping the
 * provider behind its own interface is what makes that attribution possible.
 */
export interface KeyProvider {
  /** returns the database key, creating and storing it on first use */
  key(): Promise<string>;
}

/** SQLCipher keys by PRAGMA, which must be the first statement after opening. */
export const KEY_PRAGMA = 'PRAGMA key';

export interface SqliteLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: unknown[]): Promise<void>;
  getAllAsync(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>>;
  closeAsync(): Promise<void>;
}

/** Injected so the real expo-sqlite is only imported by the app shell. */
export type OpenDatabase = (name: string) => Promise<SqliteLike>;

export class SqlCipherStore implements EncryptedStore {
  private readonly name: string;
  private readonly keys: KeyProvider;
  private readonly openDb: OpenDatabase;
  private db: SqliteLike | null = null;

  constructor(name: string, keys: KeyProvider, openDb: OpenDatabase) {
    this.name = name;
    this.keys = keys;
    this.openDb = openDb;
  }

  async open(): Promise<void> {
    const db = await this.openDb(this.name);
    const key = await this.keys.key();
    // The PRAGMA must precede any other statement: SQLCipher decides keying
    // on first access, and a query before it would create an unencrypted
    // database rather than fail — which is the quiet failure leg (iv) looks
    // for, so the ordering is asserted rather than assumed.
    await db.execAsync(`${KEY_PRAGMA} = '${key.replace(/'/g, "''")}'`);
    // cipher_integrity_check is the cheapest proof the file really is keyed
    const rows = await db.getAllAsync('PRAGMA cipher_integrity_check', []);
    if (rows.length > 0) {
      throw new Error(`store: cipher integrity check reported ${rows.length} problem(s)`);
    }
    await db.execAsync(
      'CREATE TABLE IF NOT EXISTS answers (record TEXT NOT NULL, field TEXT NOT NULL, value TEXT, PRIMARY KEY (record, field))',
    );
    this.db = db;
  }

  async putAnswer(record: string, field: string, value: unknown): Promise<void> {
    const db = this.require();
    // one statement, so "committed" is unambiguous for brief §6c's clock
    await db.runAsync(
      'INSERT INTO answers (record, field, value) VALUES (?, ?, ?) ON CONFLICT(record, field) DO UPDATE SET value = excluded.value',
      [record, field, JSON.stringify(value ?? null)],
    );
  }

  async getAnswers(record: string): Promise<Record<string, unknown>> {
    const db = this.require();
    const rows = await db.getAllAsync('SELECT field, value FROM answers WHERE record = ?', [record]);
    const out: Record<string, unknown> = {};
    for (const r of rows) out[String(r.field)] = JSON.parse(String(r.value ?? 'null'));
    return out;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
  }

  private require(): SqliteLike {
    if (!this.db) throw new Error('store: open() must be awaited before use');
    return this.db;
  }
}

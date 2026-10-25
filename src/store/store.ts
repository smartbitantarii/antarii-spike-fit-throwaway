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

import type { Job } from '../form/worklist.ts';

export interface EncryptedStore {
  /** opens, keying the database; throws if the key is wrong or absent */
  open(): Promise<void>;
  /** SwR-066's clock stops when the write is COMMITTED, not queued (brief §6c) */
  putAnswer(record: string, field: string, value: unknown): Promise<void>;
  getAnswers(record: string): Promise<Record<string, unknown>>;

  /**
   * 🔴 `S4`'s DATA, AND THE REASON THIS EXISTS. Until 2026-10-25 the worklist
   * was `makeWorklist(200)` held in a `useMemo` — **pure computation, never
   * touching the store** — so *“opening the job list”* read nothing and
   * §3a's fill could not have changed `S4`'s figure **by construction**.
   * *The product's worklist comes from the device store; measuring a render
   * over an in-memory array measured the wrong thing.*
   */
  listJobs(limit?: number): Promise<Job[]>;
  putJobs(jobs: readonly Job[]): Promise<void>;

  /** §3a's fill: many rows at once, inside one transaction. */
  putAnswers(rows: readonly AnswerRow[]): Promise<void>;

  /**
   * ⚠ THE DATABASE'S SIZE ON DISK, MEASURED RATHER THAN PREDICTED. §3a's record
   * side must reach *“about a quarter of the budget”*, and SQLite's page usage
   * for a given row shape is not something to guess — a fill that COMPUTED its
   * size would be a fill nobody had checked.
   */
  sizeBytes(): Promise<number>;
  counts(): Promise<{ jobs: number; answers: number; instances: number }>;

  /**
   * ⚠ REMOVES ONLY WHAT THE FILL WROTE. The spike's own measured record lives
   * in the same table, as do the operator's answers from using the app by
   * hand; a blanket `DELETE FROM answers` would take those with it and the
   * next figure would be taken against a store nobody meant to empty.
   */
  deleteFillRecords(): Promise<number>;

  close(): Promise<void>;
}

export interface AnswerRow {
  record: string;
  field: string;
  value: string;
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
    /**
     * §3a's worklist. ⚠ THE COLUMNS ARE THE SPIKE'S `Job` AND NOTHING MORE.
     * §3a also names sites, customers, published form versions, catalogue,
     * price rules, tax classes, lifecycle versions and roles — and modelling
     * those would mean **inventing a schema ADR-003 has not decided**, then
     * measuring the invention. *The fill reaches §3a's VOLUME with a narrower
     * SHAPE, and that deviation is recorded rather than absorbed.*
     */
    await db.execAsync(
      'CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, reference TEXT NOT NULL, ' +
        'customer TEXT NOT NULL, site TEXT NOT NULL, due TEXT NOT NULL, state TEXT NOT NULL)',
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

  /**
   * ⚠ ORDERED BY `due`, BECAUSE `SwR-096` REQUIRES IT: the worklist *“shall be
   * ordered by **schedule** — never by distance from the worker”*. An
   * unordered read would be faster and would measure something the product may
   * not do.
   */
  async listJobs(limit?: number): Promise<Job[]> {
    const db = this.require();
    const sql = 'SELECT id, reference, customer, site, due, state FROM jobs ORDER BY due' +
      (limit === undefined ? '' : ' LIMIT ' + Math.floor(limit));
    const rows = await db.getAllAsync(sql, []);
    return rows.map((r) => ({
      id: String(r.id),
      reference: String(r.reference),
      customer: String(r.customer),
      site: String(r.site),
      due: String(r.due),
      state: String(r.state) as Job['state'],
    }));
  }

  async putJobs(jobs: readonly Job[]): Promise<void> {
    const db = this.require();
    await this.inTransaction(async () => {
      for (const j of jobs) {
        await db.runAsync(
          'INSERT INTO jobs (id, reference, customer, site, due, state) VALUES (?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT(id) DO UPDATE SET reference = excluded.reference, customer = excluded.customer, ' +
            'site = excluded.site, due = excluded.due, state = excluded.state',
          [j.id, j.reference, j.customer, j.site, j.due, j.state],
        );
      }
    });
  }

  async putAnswers(rows: readonly AnswerRow[]): Promise<void> {
    const db = this.require();
    await this.inTransaction(async () => {
      for (const r of rows) {
        await db.runAsync(
          'INSERT INTO answers (record, field, value) VALUES (?, ?, ?) ' +
            'ON CONFLICT(record, field) DO UPDATE SET value = excluded.value',
          [r.record, r.field, r.value],
        );
      }
    });
  }

  /**
   * 🔴 ONE TRANSACTION PER BATCH, AND IT IS NOT AN OPTIMISATION DETAIL.
   * Without it SQLite commits — and SQLCipher re-encrypts and fsyncs — once per
   * row, and §3a's fill is hundreds of thousands of rows. ⚠ It also makes a
   * batch **all-or-nothing**, so an interrupted fill leaves whole instances
   * rather than half of one, which is what makes the builder resumable.
   */
  private async inTransaction(body: () => Promise<void>): Promise<void> {
    const db = this.require();
    await db.execAsync('BEGIN');
    try {
      await body();
      await db.execAsync('COMMIT');
    } catch (err) {
      // ⚠ The rollback is itself allowed to fail — if the connection is gone,
      // reporting THAT instead of the original error would hide the cause.
      try {
        await db.execAsync('ROLLBACK');
      } catch {
        /* the original error is the one worth raising */
      }
      throw err;
    }
  }

  async sizeBytes(): Promise<number> {
    const db = this.require();
    const [pc] = await db.getAllAsync('PRAGMA page_count', []);
    const [ps] = await db.getAllAsync('PRAGMA page_size', []);
    const pages = Number(pc?.page_count ?? 0);
    const size = Number(ps?.page_size ?? 0);
    if (!Number.isFinite(pages) || !Number.isFinite(size)) {
      throw new Error('store: page_count/page_size did not return numbers');
    }
    return pages * size;
  }

  async counts(): Promise<{ jobs: number; answers: number; instances: number }> {
    const db = this.require();
    const [j] = await db.getAllAsync('SELECT COUNT(*) AS n FROM jobs', []);
    const [a] = await db.getAllAsync('SELECT COUNT(*) AS n FROM answers', []);
    const [i] = await db.getAllAsync('SELECT COUNT(DISTINCT record) AS n FROM answers', []);
    return {
      jobs: Number(j?.n ?? 0),
      answers: Number(a?.n ?? 0),
      instances: Number(i?.n ?? 0),
    };
  }

  async deleteFillRecords(): Promise<number> {
    const db = this.require();
    const [before] = await db.getAllAsync(
      "SELECT COUNT(*) AS n FROM answers WHERE record LIKE 'fill-instance-%'",
      [],
    );
    await db.runAsync("DELETE FROM answers WHERE record LIKE 'fill-instance-%'", []);
    /**
     * 🔴 VACUUM, OR THE DELETE CHANGES NOTHING THAT MATTERS. SQLite keeps freed
     * pages on a free list and the FILE DOES NOT SHRINK — so `sizeBytes` would
     * still report a filled database and the next “empty store” figure would be
     * taken against 512 MiB of free list. *A clear that leaves the file the
     * same size is not a clear.*
     *
     * ⚠ It cannot run inside a transaction, which is why this method does not
     * use `inTransaction`.
     */
    await db.execAsync('VACUUM');
    return Number(before?.n ?? 0);
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

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

/**
 * 🔴 WHAT OPENING THE STORE COSTS, BROKEN INTO ITS PARTS — BECAUSE THE
 * NUMBER THAT MATTERS MOST HAS SO FAR BEEN AN INFERENCE.
 *
 * At the §3a fill the cold start is **3.4–3.9 s** against **~290 ms** at an
 * empty store, and that difference was ATTRIBUTED to `PRAGMA
 * cipher_integrity_check` reading a 512 MiB database. ⚠ **Attributed, not
 * measured**: it is the gap between two whole launches, each of which also
 * loads a JavaScript bundle, mounts React and opens a file.
 *
 * `F-1` *(bind launch with a target, or exempt it)* and `F-3` *(what the
 * integrity check is worth)* both rest on that number and are both sitting on
 * the owner. **A decision resting on an inference deserves the measurement
 * instead**, and it costs one timer per phase.
 */
export interface OpenTimings {
  /** `PRAGMA key` — key stretching, which does NOT scale with the data */
  keyMs: number;
  /** `PRAGMA cipher_integrity_check` — reads the database, so it DOES scale */
  integrityMs: number;
  /** the schema statements */
  schemaMs: number;
  totalMs: number;
  /**
   * Whether the check ran **inside this open**.
   *
   * 🔴 SINCE ADR-003 §5.3.3a THIS IS NORMALLY FALSE, AND THAT IS THE DECISION,
   * not a regression. *"The check runs IN FULL, in the background, once the UI
   * is interactive. Launch does not wait for it."* ➕ The field is kept, and
   * keeps travelling in the record, because **a launch taken with the check
   * inline must never be mistaken for one taken without it** — the figures
   * already in `figures/` were taken the old way and stay comparable.
   */
  integrityChecked: boolean;
}

/**
 * 🔴 WHAT THE BACKGROUND VERIFICATION FOUND — ADR-003 §5.3.3a's half of the
 * store's integrity story, and `F-8`'s trigger.
 *
 * The check moved out of `open()` so launch could meet `SwR-100`'s 2-second
 * bound *(Android: 3738 ms of open became 305 ms)*. ⚠ **Moving it changed WHEN
 * a failure is known, not WHETHER** — so the outcome needs somewhere to live
 * that is not an exception thrown into a start-up path nobody is waiting on.
 */
export interface VerifyOutcome {
  /** `true` only when the check ran to completion and found nothing */
  ok: boolean;
  /** how long the full check took — the figure §5.3.3a moved out of launch */
  durationMs: number;
  /** how many rows `cipher_integrity_check` returned; 0 is a pass */
  problems: number;
  /** set when the check itself could not run, as opposed to finding problems */
  error: string | null;
}

export interface EncryptedStore {
  /** opens, keying the database; throws if the key is wrong or absent */
  open(): Promise<void>;
  /** what the last `open()` cost, by phase; null before the first open */
  lastOpen(): OpenTimings | null;

  /**
   * 🔴 ADR-003 §5.3.3a — run the full integrity check OFF the launch path,
   * once the UI is interactive. Returns the outcome rather than throwing,
   * because `F-8` wants the application running and telling the worker.
   */
  verify(): Promise<VerifyOutcome>;
  /** what `verify()` found; null until it has run */
  lastVerify(): VerifyOutcome | null;
  /** `F-8`'s *"do not serve"* — true once verification has FAILED */
  isQuarantined(): boolean;
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

  private timings: OpenTimings | null = null;
  private verifyOutcome: VerifyOutcome | null = null;
  /** `F-8`'s *"do not serve"*, held as a reason rather than a boolean. */
  private quarantine: string | null = null;
  private readonly integrityCheckOnOpen: boolean;
  private readonly now: () => number;

  /**
   * 🔴 `integrityCheckOnOpen` NOW DEFAULTS TO **FALSE** — ADR-003 §5.3.3a,
   * *owner, 2026-10-27*. ✕ **It defaulted to TRUE until 2026-10-28**, and the
   * comment here argued for that default on a justification the ADR has since
   * found *"half wrong"*: the check was called *"the cheapest proof the file
   * really is keyed"*, and it is not — **the `PRAGMA key` and any read prove
   * the keying, because a wrong key fails the first query.** What the check
   * uniquely detects is **page-level corruption or tampering**.
   *
   * ➕ So the trade was never proof-of-keying against speed. It was **whole-file
   * corruption detection against 3433 ms on every Android launch** — and
   * §5.3.3a resolves it by moving the check rather than dropping it: *"the
   * check runs IN FULL, in the background, once the UI is interactive."*
   * **Nothing is traded away in detection; only in timing.**
   *
   * ⚠ **The flag is KEPT, not deleted, and only an operator sets it true.**
   * §5.3.3a asks for one more measurement it cannot yet make — *"there is no
   * iOS equivalent of the 3433 ms net figure, and none is implied"*, needing
   * *"three launches with the check toggled off"*. **Deleting the flag would
   * delete the ability to reproduce every figure already in `figures/`.**
   */
  constructor(
    name: string,
    keys: KeyProvider,
    openDb: OpenDatabase,
    options: { integrityCheckOnOpen?: boolean; now?: () => number } = {},
  ) {
    this.name = name;
    this.keys = keys;
    this.openDb = openDb;
    this.integrityCheckOnOpen = options.integrityCheckOnOpen ?? false;
    this.now = options.now ?? (() => Date.now());
  }

  lastOpen(): OpenTimings | null {
    return this.timings;
  }

  lastVerify(): VerifyOutcome | null {
    return this.verifyOutcome;
  }

  /**
   * True once verification has FAILED. ⚠ Not the negation of `lastVerify()?.ok`
   * — before the check has run this is **false**, because nothing is known yet
   * and refusing on *unknown* would reinstate the blocking launch §5.3.3a
   * removed.
   */
  isQuarantined(): boolean {
    return this.quarantine !== null;
  }

  /**
   * 🔴 ADR-003 §5.3.3a — THE FULL CHECK, RUN OFF THE LAUNCH PATH.
   *
   * *"The check runs IN FULL, in the background, once the UI is interactive.
   * Launch does not wait for it."* ✅ **In full** is load-bearing: §5.3.3a
   * chose this option because *"it is the only option that costs nothing in
   * DETECTION"* — checking once after install, sampling pages, or checking on
   * a schedule each trade away coverage. **So this runs the same single PRAGMA
   * the launch path used to, over the whole file.**
   *
   * ✕ **IT DOES NOT THROW ON A FAILED CHECK, AND THAT IS `F-8`.** The old
   * inline check threw, which refused the open — and `F-8` decided the
   * opposite: ***start, do not serve, tell***. *"The application starts. It does
   * NOT open the failed store for work. The worker is told plainly what has
   * happened and that their unsynchronised work is at risk."* ➕ So a failure
   * **quarantines** the store and is **returned**, for the caller to show.
   * *Throwing here would land in a promise nobody awaits.*
   *
   * ⚠ **An error RUNNING the check is not a corrupt file**, and the two are
   * reported separately — `problems` against `error`. *Quarantining a healthy
   * store because a PRAGMA failed to execute would destroy work to protect it.*
   */
  async verify(): Promise<VerifyOutcome> {
    const db = this.require();
    const t0 = this.now();
    try {
      const rows = await db.getAllAsync('PRAGMA cipher_integrity_check', []);
      const problems = rows.length;
      const outcome: VerifyOutcome = {
        ok: problems === 0,
        durationMs: this.now() - t0,
        problems,
        error: null,
      };
      if (problems > 0) {
        this.quarantine = `store: cipher integrity check reported ${problems} problem(s)`;
      }
      this.verifyOutcome = outcome;
      return outcome;
    } catch (err) {
      // ✕ Deliberately NOT a quarantine — see the note above.
      const outcome: VerifyOutcome = {
        ok: false,
        durationMs: this.now() - t0,
        problems: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      this.verifyOutcome = outcome;
      return outcome;
    }
  }

  async open(): Promise<void> {
    const t0 = this.now();
    const db = await this.openDb(this.name);
    const key = await this.keys.key();
    // The PRAGMA must precede any other statement: SQLCipher decides keying
    // on first access, and a query before it would create an unencrypted
    // database rather than fail — which is the quiet failure leg (iv) looks
    // for, so the ordering is asserted rather than assumed.
    await db.execAsync(`${KEY_PRAGMA} = '${key.replace(/'/g, "''")}'`);
    const tKeyed = this.now();

    /**
     * 🔴 OFF BY DEFAULT SINCE ADR-003 §5.3.3a — the launch path does not verify.
     *
     * `F-3` listed four alternatives and the owner chose the fourth: **in the
     * background, once the UI is interactive**, in full. So the ordinary path
     * skips this block entirely and `verify()` below does the work.
     *
     * ⚠ **This block stays reachable on purpose.** It is the only way to
     * reproduce the figures already taken, and §5.3.3a still wants *"three
     * launches with the check toggled off"* on iOS to settle a net saving it
     * refuses to borrow from Android.
     */
    if (this.integrityCheckOnOpen) {
      const rows = await db.getAllAsync('PRAGMA cipher_integrity_check', []);
      if (rows.length > 0) {
        throw new Error(`store: cipher integrity check reported ${rows.length} problem(s)`);
      }
    }
    const tChecked = this.now();
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
    const tDone = this.now();

    this.timings = {
      keyMs: tKeyed - t0,
      integrityMs: tChecked - tKeyed,
      schemaMs: tDone - tChecked,
      totalMs: tDone - t0,
      integrityChecked: this.integrityCheckOnOpen,
    };
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

  /**
   * 🔴 THE GUARD HERE IS NOT PADDING, AND ITS ABSENCE COST 22 GB.
   *
   * The first version read `PRAGMA page_count` / `page_size` and returned
   * `pages * size`, rejecting only a NON-FINITE result. **Zero is finite.** So
   * when the pragma did not come back in the shape this code assumed, it
   * returned **0** — and §3a's fill, whose loop runs *while the database is
   * smaller than the target*, wrote batches for an hour and reached **22.30 GB
   * against a 512 MiB target** before the operator stopped it.
   *
   * ⚠ The same lesson as three earlier defects in this project, and it was not
   * carried across: *a lost signal is indistinguishable from a slow device* ·
   * *a failed store open looked like a slow one* · *a truthy `localUri` is not
   * a usable path*. **A measurement that can silently return “nothing” must say
   * so, not return a number that happens to be small.**
   *
   * ➕ A keyless read as well as a keyed one: some drivers return a pragma's
   * value in a column named after the pragma, others in the first column
   * whatever it is called. *Reading both is cheaper than assuming either.*
   */
  async sizeBytes(): Promise<number> {
    const db = this.require();
    const pages = await this.pragmaNumber('page_count');
    const size = await this.pragmaNumber('page_size');
    if (pages <= 0 || size <= 0) {
      throw new Error(
        'store: PRAGMA page_count/page_size returned ' + pages + '/' + size +
          ' — the database size cannot be measured, so anything that fills ' +
          'to a size target would never stop',
      );
    }
    return pages * size;
  }

  private async pragmaNumber(name: string): Promise<number> {
    const [row] = await this.require().getAllAsync('PRAGMA ' + name, []);
    if (!row) return 0;
    const direct = (row as Record<string, unknown>)[name];
    const value = direct ?? Object.values(row)[0];
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
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

  /**
   * ⚠ `verify()` CALLS THIS TOO, AND MUST — it needs the handle. The quarantine
   * is set only after the PRAGMA has returned, so the check can never lock
   * itself out.
   */
  private require(): SqliteLike {
    if (!this.db) throw new Error('store: open() must be awaited before use');
    // 🔴 `F-8`'s *do not serve*: once verification has failed, every read and
    // write refuses. The application keeps running and says why — that is the
    // other half, and it belongs to the caller.
    if (this.quarantine) throw new Error(this.quarantine);
    return this.db;
  }
}

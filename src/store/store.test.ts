/**
 * Tests for the encrypted store's own logic — the parts that do not need a
 * device. The SQLCipher binding itself is axis 5 leg (iv)'s subject and is
 * proven on hardware, not here; what is proven here is that we drive it in
 * the one order that cannot fail quietly.
 *
 * Run: node --test src/store/store.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqlCipherStore, KEY_PRAGMA, type SqliteLike } from './store.ts';

function fakeDb(opts: {
  integrityProblems?: number;
  /**
   * How `PRAGMA page_count` / `page_size` come back. ⚠ 'named' is the shape the
   * first version of `sizeBytes` ASSUMED; 'positional' and 'empty' are the two
   * it could not survive, and one of them cost a 22 GB fill.
   */
  pragmaShape?: 'named' | 'positional' | 'empty';
  pages?: number;
} = {}) {
  const calls: string[] = [];
  const rows = new Map<string, string>();
  const db: SqliteLike = {
    async execAsync(sql) {
      calls.push(`exec:${sql}`);
    },
    async runAsync(sql, params) {
      calls.push(`run:${sql.slice(0, 20)}`);
      rows.set(`${params[0]}|${params[1]}`, String(params[2]));
    },
    async getAllAsync(sql, params) {
      calls.push(`all:${sql.slice(0, 32)}`);
      if (sql.includes('cipher_integrity_check')) {
        return new Array(opts.integrityProblems ?? 0).fill({ problem: 'x' });
      }
      if (sql.startsWith('PRAGMA page_count') || sql.startsWith('PRAGMA page_size')) {
        const name = sql.slice('PRAGMA '.length).trim();
        const value = name === 'page_count' ? (opts.pages ?? 128) : 4096;
        switch (opts.pragmaShape ?? 'named') {
          case 'empty':
            return [];
          case 'positional':
            // The value is there, under a column name this code does not know.
            return [{ 'the-driver-called-it-something-else': value }];
          default:
            return [{ [name]: value }];
        }
      }
      const out: Array<Record<string, unknown>> = [];
      for (const [k, v] of rows) {
        const [rec, field] = k.split('|');
        if (rec === params[0]) out.push({ field, value: v });
      }
      return out;
    },
    async closeAsync() {
      calls.push('close');
    },
  };
  return { db, calls };
}

const keys = { async key() { return 'the-key'; } };

test('the key PRAGMA is the FIRST statement — a query before it would create an unencrypted database', async () => {
  const { db, calls } = fakeDb();
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  assert.ok(calls[0].startsWith(`exec:${KEY_PRAGMA}`), `first call was ${calls[0]}`);
  // and the integrity check comes before any table work
  const integrity = calls.findIndex((c) => c.includes('cipher_integrity_check'));
  const create = calls.findIndex((c) => c.includes('CREATE TABLE'));
  assert.ok(integrity >= 0 && integrity < create, 'integrity proven before the schema is touched');
});

test('a failed integrity check refuses to open rather than carrying on', async () => {
  const { db } = fakeDb({ integrityProblems: 2 });
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await assert.rejects(() => s.open(), /cipher integrity check reported 2/);
});

test("a key containing a quote cannot break out of the PRAGMA", async () => {
  const { db, calls } = fakeDb();
  const s = new SqlCipherStore('spike.db', { async key() { return "a'b"; } }, async () => db);
  await s.open();
  assert.ok(calls[0].includes("'a''b'"), `the quote must be doubled, got ${calls[0]}`);
});

test('use before open is refused with a clear reason, not a null dereference', async () => {
  const { db } = fakeDb();
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await assert.rejects(() => s.putAnswer('r1', 'f1', 'v'), /open\(\) must be awaited/);
});

test('an answer round-trips, and one statement makes "committed" unambiguous', async () => {
  const { db, calls } = fakeDb();
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  const before = calls.length;
  await s.putAnswer('r1', 'reading', 'fail');
  assert.equal(calls.length - before, 1, 'one statement per answer — brief §6c times a commit, not a transaction');
  assert.deepEqual(await s.getAnswers('r1'), { reading: 'fail' });
});

test('null and absent values survive the round trip distinctly from strings', async () => {
  const { db } = fakeDb();
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  await s.putAnswer('r1', 'a', null);
  await s.putAnswer('r1', 'b', 0);
  await s.putAnswer('r1', 'c', false);
  assert.deepEqual(await s.getAnswers('r1'), { a: null, b: 0, c: false });
});

test('close is idempotent, so a failed run cannot leave a handle open', async () => {
  const { db } = fakeDb();
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  await s.close();
  await assert.doesNotReject(() => s.close());
});

// --------------------------------------------------- the measurement that cost 22 GB

test('sizeBytes reads the pragma when the column is named as expected', async () => {
  const { db } = fakeDb({ pages: 1000 });
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  assert.equal(await s.sizeBytes(), 1000 * 4096);
});

test('sizeBytes survives a driver that names the column something else', async () => {
  // ➕ Reading the first column when the named one is absent is cheaper than
  // assuming a shape — and this is the shape that was assumed.
  const { db } = fakeDb({ pragmaShape: 'positional', pages: 1000 });
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  assert.equal(await s.sizeBytes(), 1000 * 4096);
});

test('\u{1F534} sizeBytes THROWS when it cannot measure, instead of returning zero', async () => {
  /**
   * THE DEFECT THIS PINS, AND IT IS NOT HYPOTHETICAL. The first version
   * rejected only a NON-FINITE result — and **zero is finite**. When the
   * pragma came back in a shape it did not expect it returned **0**, and
   * §3a's fill, whose loop runs *while the database is smaller than the
   * target*, wrote for an hour and reached **22.30 GB against a 512 MiB
   * target**.
   *
   * ⚠ A fill bounded by a measurement will run until the device is full if
   * the measurement is wrong. So the measurement must be able to say
   * "I cannot", and saying it with a small number is not saying it.
   */
  const { db } = fakeDb({ pragmaShape: 'empty' });
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  await assert.rejects(
    () => s.sizeBytes(),
    /cannot be measured|returned 0/,
    'a store that cannot measure itself must say so, not report a small size',
  );
});

test('sizeBytes refuses a zero page count as well as a missing one', async () => {
  const { db } = fakeDb({ pages: 0 });
  const s = new SqlCipherStore('spike.db', keys, async () => db);
  await s.open();
  await assert.rejects(() => s.sizeBytes(), /cannot be measured/);
});

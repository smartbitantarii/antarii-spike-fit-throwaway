/**
 * Tests for getting the record off the device — including a REAL post to the
 * 1a collector when the stack is up.
 * Run: node --test src/harness/delivery.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectorUrl,
  normaliseBase,
  assertReachableFromDevice,
  fallbackFilename,
  deliver,
  type PostJson,
} from './delivery.ts';

const who = { buildId: 'N', device: 'Galaxy M04' };

// ------------------------------------------------------------- the address

test('the collector path is appended once, however the base is written', () => {
  assert.equal(collectorUrl('http://192.168.1.50:8080'), 'http://192.168.1.50:8080/figures');
  assert.equal(collectorUrl('http://192.168.1.50:8080/'), 'http://192.168.1.50:8080/figures');
  assert.equal(collectorUrl('http://192.168.1.50:8080///'), 'http://192.168.1.50:8080/figures');
});

test('a base that is not a URL is refused with the text that was given', () => {
  assert.throws(() => normaliseBase('192.168.1.50:8080'), /not a URL/);
  assert.throws(() => normaliseBase(''), /empty/);
  assert.throws(() => normaliseBase('ftp://host/'), /must be http or https/);
});

test('🔴 a loopback address is refused — on a phone that IS the phone', () => {
  for (const bad of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080']) {
    assert.throws(() => assertReachableFromDevice(bad), /that address IS the phone/, bad);
  }
  // And a LAN address is fine.
  assertReachableFromDevice('http://192.168.1.50:8080');
});

test('the fallback filename identifies the run and survives a hostile device string', () => {
  const n = fallbackFilename('N+1', 'Galaxy M04', Date.parse('2026-10-19T10:00:00Z'));
  assert.match(n, /^figures_2026-10-19T10-00-00-000Z_Galaxy-M04_N-1\.json$/);
  const nasty = fallbackFilename('b', '../../etc/passwd', 0);
  assert.ok(!nasty.includes('/'), 'a path separator must not survive: ' + nasty);
  assert.ok(!nasty.includes('..' + '/'), nasty);
});

// ------------------------------------------ the rule: never lose the record

test('🔴 a transport failure does NOT throw and names the file to write instead', async () => {
  const post: PostJson = async () => { throw new Error('connection refused'); };
  const out = await deliver('{"a":1}', 'http://192.168.1.50:8080', post, who, { onDevice: true });
  assert.equal(out.delivered, false);
  assert.match(out.reason!, /connection refused/);
  assert.ok(out.fallbackFilename, 'the record must have somewhere to go');
});

test('a bad address also yields a fallback rather than losing the figures', async () => {
  const post: PostJson = async () => ({ status: 200, body: '{}' });
  const out = await deliver('{"a":1}', 'http://localhost:8080', post, who, { onDevice: true });
  assert.equal(out.delivered, false);
  assert.match(out.reason!, /IS the phone/);
  assert.ok(out.fallbackFilename);
});

test('a non-200 is a failure, with the collector\'s own words', async () => {
  const post: PostJson = async () => ({ status: 400, body: 'the body is not a JSON object' });
  const out = await deliver('nonsense', 'http://192.168.1.50:8080', post, who, { onDevice: true });
  assert.equal(out.delivered, false);
  assert.match(out.reason!, /answered 400: the body is not a JSON object/);
  assert.ok(out.fallbackFilename);
});

test('the bytes posted are the bytes given — not re-encoded', async () => {
  // report.ts validated and serialised those exact bytes; re-encoding here
  // would store this module's idea of the record instead.
  let seen = '';
  const json = '{"b":2,"a":1}';
  const post: PostJson = async (_u, body) => { seen = body; return { status: 200, body: '{}' }; };
  await deliver(json, 'http://192.168.1.50:8080', post, who, { onDevice: true });
  assert.equal(seen, json, 'key order and all');
});

test('an unreadable acknowledgement on a 200 is still a success', async () => {
  // Treating it as a failure would have the operator write a duplicate file
  // for a record that did land.
  const post: PostJson = async () => ({ status: 200, body: 'OK' });
  const out = await deliver('{"a":1}', 'http://192.168.1.50:8080', post, who, { onDevice: true });
  assert.equal(out.delivered, true);
  assert.equal(out.stored, undefined);
});

// --------------------------------------- against the REAL 1a collector

const STUBS = process.env.STUBS_ENDPOINT ?? 'http://localhost:8080';

async function stubUp(): Promise<boolean> {
  try {
    const r = await fetch(STUBS + '/healthz', { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch {
    return false;
  }
}
const live = await stubUp();

const realPost: PostJson = async (url, body) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  return { status: r.status, body: await r.text() };
};

test(
  'a record really reaches the 1a collector and is stored under a name it reports',
  { skip: live ? false : 'the 1a stubs are not up at ' + STUBS },
  async () => {
    const json = JSON.stringify({
      buildId: 'N',
      device: { model: 'delivery-test' },
      batches: [],
    });
    // ⚠ `onDevice: false` because this runs on the development machine,
    // where localhost IS the collector. The same call from a phone would be
    // refused by the loopback guard, which is the point of the flag.
    const out = await deliver(json, STUBS, realPost, who, { onDevice: false });
    assert.equal(out.delivered, true, out.reason);
    assert.ok(out.stored, 'the collector names what it stored');
    assert.match(out.stored!, /delivery-test/, 'the name carries the device');
    assert.match(out.stored!, /\.json$/);
  },
);

test(
  'the collector refuses a body that is not a JSON object, and the record is not lost',
  { skip: live ? false : 'the 1a stubs are not up at ' + STUBS },
  async () => {
    const out = await deliver('this is not json', STUBS, realPost, who, { onDevice: false });
    assert.equal(out.delivered, false);
    assert.match(out.reason!, /answered 400/);
    assert.ok(out.fallbackFilename, 'even a rejected record gets somewhere to go');
  },
);

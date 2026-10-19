/**
 * Getting §8's record off the device.
 *
 * ⚠ THE RULE THIS MODULE EXISTS TO ENFORCE: **a failed delivery must never
 * lose the record.** A campaign is 101 passes per sequence on a phone; if the
 * collector is unreachable — wrong address, laptop asleep, firewall — the
 * figures must land in a file on the device, not vanish into a rejected
 * promise. So `deliver` NEVER throws on a transport failure. It reports the
 * failure and names the file the caller must write instead.
 *
 * 🔴 AND THE TRAP THAT WILL CATCH SOMEBODY: on a phone, `localhost` is THE
 * PHONE. The 1a stack listens on the development machine, so a device must be
 * pointed at that machine's LAN address. A base URL of `http://localhost:8080`
 * is not a configuration mistake that fails loudly — it fails as a connection
 * refused, which looks exactly like the collector being down.
 * `assertReachableFromDevice` refuses it in terms.
 *
 * Imports nothing. The HTTP call is injected, so the rules are tested on a
 * development machine and the platform supplies only the transport.
 */

export interface DeliveryOutcome {
  delivered: boolean;
  /** the collector's own name for the stored record, when it accepted one */
  stored?: string;
  /** why it did not land, in words an operator at a bench can act on */
  reason?: string;
  /**
   * Where the caller must write the record instead. Always present when
   * `delivered` is false — the record is never simply dropped.
   */
  fallbackFilename?: string;
}

/**
 * Where the delivery is being made from.
 *
 * 🔴 `onDevice` HAS NO DEFAULT, DELIBERATELY. The loopback check below is
 * right on a phone and wrong on the development machine, so a default would
 * be wrong half the time — silently. Making every caller say where it is
 * running is the only version of this that cannot be forgotten.
 */
export interface DeliveryContext {
  onDevice: boolean;
  nowMs?: number;
}

/** The transport, injected: a POST returning its status and body. */
export type PostJson = (
  url: string,
  body: string,
) => Promise<{ status: number; body: string }>;

export function normaliseBase(base: string): string {
  const trimmed = base.trim();
  if (!trimmed) throw new Error('the collector address is empty');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('the collector address is not a URL: ' + trimmed);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('the collector address must be http or https, not ' + url.protocol);
  }
  // ⚠ Trailing slash stripped and re-added by the caller, which is the same
  // defect that made every OTA probe link a 404.
  return trimmed.replace(/\/+$/, '');
}

export function collectorUrl(base: string): string {
  return normaliseBase(base) + '/figures';
}

/**
 * ⚠ Refuses an address that means "this phone".
 *
 * `localhost`, `127.0.0.1` and `::1` all resolve to the DEVICE when the app
 * runs on one, so the record would be posted to a port on the phone itself.
 * The failure that produces is a connection refused — indistinguishable from
 * the development machine being switched off, which is the wrong thing to go
 * looking at.
 */
export function assertReachableFromDevice(base: string): void {
  const host = new URL(normaliseBase(base)).hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (loopback) {
    throw new Error(
      'a device cannot reach "' + host + '" — on a phone that address IS the phone. Use the ' +
        "development machine's LAN address, e.g. http://192.168.1.50:8080",
    );
  }
}

/** A filename the device can write, carrying enough to identify the run. */
export function fallbackFilename(buildId: string, device: string, atMs: number): string {
  const stamp = new Date(atMs).toISOString().replace(/[:.]/g, '-');
  const safe = (s: string) => (s || 'unknown').replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 40);
  return 'figures_' + stamp + '_' + safe(device) + '_' + safe(buildId) + '.json';
}

/**
 * Posts the record, and says what to do when it does not land.
 *
 * ⚠ `recordJson` is passed as a STRING, already serialised by `report.ts`.
 * Re-encoding it here would mean the bytes stored are this module's idea of
 * the record rather than the one `emitRecord` validated.
 */
export async function deliver(
  recordJson: string,
  base: string,
  post: PostJson,
  identity: { buildId: string; device: string },
  where: DeliveryContext,
): Promise<DeliveryOutcome> {
  const nowMs = where.nowMs ?? Date.now();
  const fallback = fallbackFilename(identity.buildId, identity.device, nowMs);

  let url: string;
  try {
    url = collectorUrl(base);
    // ⚠ ONLY ON A DEVICE. `localhost` is correct when a campaign is driven
    // from the development machine and catastrophic from a phone, so the
    // caller states where it is running and the check follows from that.
    if (where.onDevice) assertReachableFromDevice(base);
  } catch (err) {
    // A bad address is still not a reason to lose the figures.
    return {
      delivered: false,
      reason: err instanceof Error ? err.message : String(err),
      fallbackFilename: fallback,
    };
  }

  try {
    const res = await post(url, recordJson);
    if (res.status !== 200) {
      return {
        delivered: false,
        reason: 'the collector answered ' + res.status + ': ' + res.body.slice(0, 200),
        fallbackFilename: fallback,
      };
    }
    let stored: string | undefined;
    try {
      stored = (JSON.parse(res.body) as { stored?: string }).stored;
    } catch {
      // ⚠ Accepted anyway. The collector said 200; an unreadable acknowledgement
      // is a cosmetic problem, and treating it as a failure would have the
      // operator write a duplicate file for a record that did land.
      stored = undefined;
    }
    return { delivered: true, stored };
  } catch (err) {
    return {
      delivered: false,
      reason: err instanceof Error ? err.message : String(err),
      fallbackFilename: fallback,
    };
  }
}

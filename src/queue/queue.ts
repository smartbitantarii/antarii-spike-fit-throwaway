/**
 * Build 1, thing 3 — the synchronisation queue.
 *
 * Ours, triggered by the platform, with a PER-RECORD BATCH as the transfer
 * unit (ADR-003 §5.5.3). Leg (iii) of axis 5 exercises it across an
 * application update, and conditions 1/2 measure saves against it.
 *
 * The requirements that shape every decision here:
 *
 *   SwR-109 — "until the server confirms it is durably stored, NOT MERELY
 *   RECEIVED (a distinct acknowledgement), and for at least the
 *   recovery-point window after that (SyR-153: 15 minutes)".
 *     => received and durablyConfirmed are two states, not one.
 *
 *   SwR-097 — the worker sees "unambiguously and at every moment" what is
 *   captured but not synchronised (count AND pending media size, per
 *   instance and in total) and what is synchronised but not durably
 *   confirmed. "A record SHALL NEVER appear as safely delivered before the
 *   server has confirmed durable storage."
 *
 *   ADR-004 §6.4 — idempotency on resend, because ADR-003's queue has a
 *   "sent, awaiting confirmation" state, so a batch WILL be resent.
 */

export type RecordId = string;
export type BatchId = string;

/**
 * SwR-097's visible states. `sent` is "sent, awaiting confirmation";
 * `received` is the server's transport acknowledgement and is deliberately
 * NOT delivery — SwR-109 calls durable storage "a distinct acknowledgement".
 */
export type EntryState = 'pending' | 'sent' | 'received' | 'durablyConfirmed';

export interface Entry {
  record: RecordId;
  state: EntryState;
  /** the batch currently representing this record, if any */
  batch: BatchId | null;
  /** bytes of media attached to this record and not yet confirmed */
  mediaBytes: number;
  /** a monotonic revision, bumped on every save — the fuller batch wins */
  revision: number;
  /** when the server confirmed durable storage (clock ms), for SwR-109's window */
  confirmedAt: number | null;
  /** SwR-109: the server has announced an outstanding re-offer for this item */
  reOfferOutstanding: boolean;
}

/** SyR-153's recovery-point window, which SwR-109 adds after confirmation. */
export const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

/** N-F3, set 2026-09-18, tenant-configurable: the reference period. */
export const REFERENCE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface Totals {
  /** captured but not yet synchronised */
  pendingCount: number;
  pendingMediaBytes: number;
  /** synchronised but not yet durably confirmed — SwR-097 keeps these separate */
  awaitingConfirmationCount: number;
  awaitingConfirmationMediaBytes: number;
}

export class Queue {
  private readonly entries = new Map<RecordId, Entry>();
  /** ADR-004 §6.4: a batch already applied must not be applied twice */
  private readonly appliedBatches = new Set<BatchId>();
  private seq = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /**
   * ADR-003 §5.5.3: each save REPLACES the record's pending batch with a
   * fuller one. A record therefore has at most one pending batch, which is
   * why the transfer unit is per-record rather than per-change.
   */
  save(record: RecordId, mediaBytes = 0): Entry {
    const existing = this.entries.get(record);
    if (existing && existing.state === 'pending') {
      existing.revision += 1;
      existing.mediaBytes = mediaBytes;
      existing.batch = null; // the old pending batch is superseded, not queued twice
      return existing;
    }
    // A save after sending starts a new pending generation; the in-flight
    // batch keeps its own state until the server answers it.
    const entry: Entry = {
      record,
      state: 'pending',
      batch: null,
      mediaBytes,
      revision: (existing?.revision ?? 0) + 1,
      confirmedAt: null,
      reOfferOutstanding: false,
    };
    this.entries.set(record, entry);
    return entry;
  }

  /** The platform triggers transfer; we decide what goes. One batch per record. */
  nextBatch(): { batch: BatchId; record: RecordId; revision: number } | null {
    for (const e of this.entries.values()) {
      if (e.state === 'pending') {
        const batch = `b${++this.seq}:${e.record}:r${e.revision}`;
        e.batch = batch;
        e.state = 'sent';
        return { batch, record: e.record, revision: e.revision };
      }
    }
    return null;
  }

  /** The transport acknowledgement. NOT delivery — SwR-109 is explicit. */
  markReceived(batch: BatchId): void {
    const e = this.byBatch(batch);
    if (e && e.state === 'sent') e.state = 'received';
  }

  /**
   * The distinct acknowledgement SwR-109 requires. Idempotent: a resent batch
   * confirmed twice must not double-count or reset the window.
   */
  confirmDurable(batch: BatchId): void {
    if (this.appliedBatches.has(batch)) return; // ADR-004 §6.4
    const e = this.byBatch(batch);
    if (!e) return;
    this.appliedBatches.add(batch);
    e.state = 'durablyConfirmed';
    e.confirmedAt = this.now();
  }

  /** The server announces or settles a re-offer for an item (SwR-109). */
  setReOffer(record: RecordId, outstanding: boolean): void {
    const e = this.entries.get(record);
    if (e) e.reOfferOutstanding = outstanding;
  }

  /**
   * SwR-097's counters, computed from one pass so the two numbers can never
   * disagree with each other. §5.7 requires them transactional; here that is
   * trivially satisfied by deriving them rather than maintaining them.
   */
  totals(): Totals {
    let pendingCount = 0;
    let pendingMediaBytes = 0;
    let awaitingConfirmationCount = 0;
    let awaitingConfirmationMediaBytes = 0;
    for (const e of this.entries.values()) {
      if (e.state === 'pending') {
        pendingCount++;
        pendingMediaBytes += e.mediaBytes;
      } else if (e.state === 'sent' || e.state === 'received') {
        awaitingConfirmationCount++;
        awaitingConfirmationMediaBytes += e.mediaBytes;
      }
    }
    return { pendingCount, pendingMediaBytes, awaitingConfirmationCount, awaitingConfirmationMediaBytes };
  }

  /**
   * SwR-097: "A record shall never appear as safely delivered before the
   * server has confirmed durable storage." The only state that answers true.
   */
  isSafelyDelivered(record: RecordId): boolean {
    return this.entries.get(record)?.state === 'durablyConfirmed';
  }

  /**
   * SwR-109's automatic removal and SwR-125's manual one share these bounds:
   * durably confirmed, past the recovery-point window, past the reference
   * period, and any announced re-offer settled.
   */
  isRemovable(record: RecordId): boolean {
    const e = this.entries.get(record);
    if (!e || e.state !== 'durablyConfirmed' || e.confirmedAt === null) return false;
    if (e.reOfferOutstanding) return false;
    const age = this.now() - e.confirmedAt;
    return age >= RECOVERY_WINDOW_MS && age >= REFERENCE_PERIOD_MS;
  }

  /** SwR-125: the list is ordered by size and shows what each removal frees. */
  removableBySize(): Array<{ record: RecordId; frees: number }> {
    return [...this.entries.values()]
      .filter((e) => this.isRemovable(e.record))
      .map((e) => ({ record: e.record, frees: e.mediaBytes }))
      .sort((a, b) => b.frees - a.frees);
  }

  get(record: RecordId): Entry | undefined {
    return this.entries.get(record);
  }

  private byBatch(batch: BatchId): Entry | undefined {
    for (const e of this.entries.values()) if (e.batch === batch) return e;
    return undefined;
  }
}

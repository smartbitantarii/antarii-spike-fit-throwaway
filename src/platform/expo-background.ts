/**
 * Condition 5, leg (i) — background execution.
 *
 * The brief fails this leg when *"the queue cannot be read or written in any
 * state in which `SwR-107` requires work to continue — foreground, background,
 * suspended, terminated, device locked"*. `SwR-107` requires synchronisation to
 * run as *"background work that continues when the application is not in the
 * foreground, **within what the device platform permits**"*.
 *
 * 🔴 SO THERE IS NO NUMBER TO MEASURE AGAINST, AND THAT IS NOT AN OVERSIGHT.
 * `SyR-076` says the figures bind *"with the application in the foreground; in
 * the background synchronisation continues as `SyR-089` requires, within what
 * the device platform permits, **with no separate figure**"*. The question this
 * module answers is therefore **in which states does the platform let our queue
 * run at all** — not how fast.
 *
 * ⚠ `SyR-210`'s rationale names iOS as the hard case for exactly this, which is
 * why it is measured there first.
 */
/**
 * 🔴 `expo-background-task` AND `expo-task-manager` ARE REMOVED, 2026-10-28,
 * AND THIS IS A RECORDED FINDING RATHER THAN A WORKAROUND.
 *
 * ✕ **What happened.** Registering the queue-drain task through
 * `expo-background-task` left the Galaxy A35 in a state where **the
 * application could not start at all**. The crash is Java-level, in
 * `androidx.startup.InitializationProvider` during `handleBindApplication` —
 * *before React Native loads and before a line of JavaScript runs*:
 *
 *     java.lang.RuntimeException: Unable to get provider
 *       androidx.startup.InitializationProvider
 *     Caused by: Failed to create an instance of
 *       class androidx.work.impl.WorkDatabase
 *       at androidx.work.WorkManagerInitializer.create(...)
 *
 * ✅ **Established from the artefacts, not inferred.** Three builds containing
 * WorkManager crash identically; the pre-leg-(i) build runs fine on the same
 * app data. `1496f8f` ran at 06:37 and **those identical bytes** crashed at
 * 17:39 — `classes.dex` and `AndroidManifest.xml` sha256-identical across the
 * builds that worked and failed. ✕ **Not storage** (79 GB free), ✕ **not stale
 * dexopt** (forced recompile), ✕ **not a reboot**.
 *
 * ⚠ **THE ROOT CAUSE IS NOT KNOWN, and is deliberately not guessed here.** Why
 * a fixed dex instantiates `WorkDatabase_Impl` one hour and not the next is
 * unexplained. *It is an open question in the record, not a solved one.*
 *
 * ➕ **Why removal rather than a manifest patch.** The composition without
 * these packages is the one **observed to run**, and it is also the
 * composition the 2026-10-26 Android baseline figures were taken on — leg (i)
 * landed two days later. *So removing them makes the launch figure MORE
 * comparable with its baseline, not less.*
 *
 * ✅ **`probe()` below is untouched and still works**, because it only reads
 * and writes the store. **Leg (i)'s foreground control survives**; what is
 * lost is the scheduler-driven half, which on this device never ran anyway.
 *
 * ⓘ Restoring these is a one-line revert of this comment block plus
 * `package.json` — kept narrow for exactly that reason.
 */
import { File, Paths } from 'expo-file-system';

import type { EncryptedStore } from '../store/store.ts';

export const TASK_NAME = 'antarii-spike-queue-drain';

/**
 * 🔴 THE EVIDENCE FILE IS PLAIN, AND THAT IS THE WHOLE DESIGN.
 *
 * The thing under test is **whether the encrypted store can be opened and the
 * queue read** in each application state. ⚠ If the evidence were written *into*
 * that store, then a state where the store cannot be opened would produce **no
 * evidence of the failure** — the run would look identical to one that never
 * happened. *A measurement whose failure mode is silence is the defect this
 * spike has already hit three times.*
 *
 * ➕ So the outcome is appended to an ordinary file, including the store's own
 * error when it refuses. **The evidence survives the thing it is measuring.**
 *
 * ⚠ It is also the only way to learn anything about **terminated**: the app is
 * dead and can report nothing live, so the record has to be left behind and
 * read on the next launch.
 */
function evidenceFile(): File {
  return new File(Paths.document, 'background-evidence.jsonl');
}

export interface BackgroundMark {
  /** when the task body ran, by the device clock */
  at: string;
  /** what caused it: the registered task, or an explicit foreground probe */
  trigger: 'background-task' | 'foreground-probe';
  /**
   * What React Native believed the app state was. ⚠ 'active' | 'background' |
   * 'inactive' only — **the platform does not report "suspended",
   * "terminated" or "locked" to us**, so those are inferred from WHEN the mark
   * appears and from whether the store opened, never claimed as observed.
   */
  appState: string;
  /** did the encrypted store open? the error verbatim when not */
  storeOpened: boolean;
  storeError: string | null;
  /** could the queue be READ, and how many rows did it hold */
  queueRead: boolean;
  queueDepth: number | null;
  /** could the queue be WRITTEN — the other half of leg (i)'s clause */
  queueWritten: boolean;
  error: string | null;
}

/**
 * Appends one mark. ⚠ Never throws: a background task that crashes is killed by
 * the platform and leaves nothing, which would be indistinguishable from a task
 * that never ran.
 */
export async function appendMark(mark: BackgroundMark): Promise<void> {
  try {
    const f = evidenceFile();
    const line = JSON.stringify(mark) + '\n';
    if (!f.exists) {
      f.create();
      await f.write(line);
      return;
    }
    // ⚠ Read-modify-write rather than an append handle: the file is tiny and a
    // background task may be killed mid-write, so a whole-file write is the
    // shape least likely to leave a half-line that breaks every later parse.
    const existing = await f.text();
    await f.write(existing + line);
  } catch {
    /* an unwritable evidence file must not kill the task */
  }
}

export async function readMarks(): Promise<BackgroundMark[]> {
  try {
    const f = evidenceFile();
    if (!f.exists) return [];
    const text = await f.text();
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as BackgroundMark;
        } catch {
          return null;
        }
      })
      .filter((m): m is BackgroundMark => m !== null);
  } catch {
    return [];
  }
}

export async function clearMarks(): Promise<void> {
  try {
    const f = evidenceFile();
    if (f.exists) f.delete();
  } catch {
    /* nothing to clear */
  }
}

/**
 * What the task actually does: open the store, read the queue, write to it.
 *
 * ✕ IT DOES NOT UPLOAD ANYTHING, DELIBERATELY. Leg (ii) already proves the
 * transfer against a real S3, and a real upload here would turn a question
 * about **platform scheduling** into a question about **the network** — the two
 * would be inseparable in the result.
 *
 * ➕ Every step is recorded separately because leg (i)'s clause is *"read **or**
 * written"*: a state that permits one and not the other is a different finding
 * from one that permits neither, and a single boolean would hide it.
 */
export async function probe(
  trigger: BackgroundMark['trigger'],
  appState: string,
  store: EncryptedStore,
): Promise<BackgroundMark> {
  const mark: BackgroundMark = {
    at: new Date().toISOString(),
    trigger,
    appState,
    storeOpened: false,
    storeError: null,
    queueRead: false,
    queueDepth: null,
    queueWritten: false,
    error: null,
  };

  try {
    await store.open();
    mark.storeOpened = true;
  } catch (err) {
    // 🔴 THE MOST INTERESTING FAILURE THIS WHOLE LEG CAN PRODUCE. On iOS a file
    // written under `NSFileProtectionComplete` is unreadable while the device
    // is locked, so a store that opens in the foreground and refuses when
    // locked is not a bug — it is the platform answering leg (i)'s question.
    // The message is kept verbatim so the cause is attributable.
    mark.storeError = err instanceof Error ? err.message : String(err);
    await appendMark(mark);
    return mark;
  }

  try {
    const counts = await store.counts();
    mark.queueRead = true;
    mark.queueDepth = counts.answers;

    await store.putAnswer('background-probe', 'at', mark.at);
    mark.queueWritten = true;
  } catch (err) {
    mark.error = err instanceof Error ? err.message : String(err);
  }

  await appendMark(mark);
  return mark;
}

/**
 * ⚠ DEFINED AT MODULE SCOPE, NOT INSIDE A COMPONENT. The platform may launch
 * the app **into the background** to run this task, and a definition that only
 * happened during a render would not exist yet when that launch occurs — the
 * task would be registered but undefined, which iOS reports as a task that did
 * nothing rather than as an error.
 */
/**
 * ⚠ A NO-OP SINCE 2026-10-28, and the signature is kept deliberately.
 *
 * `App.tsx` calls this at module scope, and the comment there explains why
 * that matters. Keeping the shape means **nothing else had to change to make
 * the application startable**, so the diff that bought a launch figure is this
 * file and `package.json` and nothing more. *A smaller blast radius is worth
 * more here than a tidier API.*
 */
export function defineQueueDrainTask(_makeStore: () => EncryptedStore): void {
  // Nothing to define: there is no task runner in this build.
}

/**
 * ⚠ Reports unavailability rather than pretending to register.
 *
 * ✕ **It does NOT return one of leg (i)'s verdicts**, and that is the point.
 * The run plan's table offers *pass*, *framework/prototype failure* and
 * *platform limit* — **all three assume the application runs**, so none of
 * them describes a mechanism that stopped the app from starting. *Returning
 * "restricted" or "platform limit" here would file this result under a cell it
 * does not belong in, which is the class of defect `C1`, `C2` and `M5` were
 * all caught being.*
 */
export async function registerQueueDrain(): Promise<string> {
  return (
    'UNAVAILABLE — expo-background-task removed 2026-10-28 after it left the ' +
    'application unable to start (see this file\'s header). Task "' +
    TASK_NAME +
    '" is not registered, and this is NOT a leg (i) verdict.'
  );
}

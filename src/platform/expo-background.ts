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
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
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
export function defineQueueDrainTask(makeStore: () => EncryptedStore): void {
  if (TaskManager.isTaskDefined(TASK_NAME)) return;
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      // The app may have been launched for this task alone, so a fresh store is
      // opened rather than reusing one a screen might hold.
      await probe('background-task', 'background', makeStore());
    } catch (err) {
      await appendMark({
        at: new Date().toISOString(),
        trigger: 'background-task',
        appState: 'background',
        storeOpened: false,
        storeError: null,
        queueRead: false,
        queueDepth: null,
        queueWritten: false,
        error: 'task body threw: ' + (err instanceof Error ? err.message : String(err)),
      });
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function registerQueueDrain(): Promise<string> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      // ⚠ Reported, not swallowed: "the user has background refresh off" and
      // "the platform refuses" are different findings for leg (i), and only one
      // of them is about the platform.
      return 'restricted — background execution is disabled for this app or device';
    }
    const already = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!already) {
      // ⚠ 15 minutes is the floor iOS honours; it is a REQUEST, not a promise.
      // The scheduler decides, which is the very thing being measured.
      await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
    }
    return 'registered (minimum interval 15 min — the scheduler decides)';
  } catch (err) {
    return 'registration failed: ' + (err instanceof Error ? err.message : String(err));
  }
}

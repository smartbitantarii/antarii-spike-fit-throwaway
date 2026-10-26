/**
 * The spike's app shell — hand-written, not scaffolded.
 *
 * Author's recommendation on the owner's go ahead, 2026-10-16: a template
 * brings a router, linting and example screens the spike does not need, and
 * the spike's value is that every file in it is there for a measured reason.
 *
 * This screen is the harness's trigger surface. It calls mark() at exactly
 * the points M7-scripted-sequences.md §2 defines, and nothing else here is
 * for show.
 */
import React from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  Pressable,
  View,
  Image,
  StyleSheet,
  useWindowDimensions,
  Platform,
  StatusBar,
} from 'react-native';

import { Harness, type Figure, type RunContext } from './src/harness/harness.ts';
import { evaluate, plan } from './src/form/evaluate.ts';
import type { Answers, FormDef } from './src/form/model.ts';
import { SqlCipherStore } from './src/store/store.ts';
import { buildFill, clearFill, measureFill } from './src/platform/expo-fill.ts';
import { describeFill, fillState, type FillState } from './src/store/fill.ts';
import { Queue } from './src/queue/queue.ts';
import { keystoreKeyProvider, openExpoDatabase } from './src/platform/expo-adapters.ts';
import { spikeForm, denseFocusTransitions } from './src/form/spike-form.ts';
import { makeWorklist, jobForIteration, DEFAULT_WORKLIST_VOLUME, type Job } from './src/form/worklist.ts';
import { WorklistScreen } from './src/ui/worklist-screen.tsx';
import { BUILD_ID } from './src/build.ts';
import {
  planCapture,
  SHIPPED_LAYERS,
  LOCATION_UNAVAILABLE,
  LOCATION_DEADLINE_MS,
} from './src/media/prepare.ts';
import {
  captureAndPrepare,
  captureFromFixture,
  discardCapture,
  type CaptureResult,
} from './src/platform/expo-media.ts';
import { devicePayload, stableJson } from './src/harness/report.ts';
import { runCampaign, ITERATIONS } from './src/harness/campaign.ts';
import { SEQUENCES, stepsForRecord } from './src/harness/sequences.ts';
import { deliver } from './src/harness/delivery.ts';
import {
  expoPost,
  writeFigureFallback,
  readCollectorBase,
  saveCollectorBase,
  readDeviceLabel,
  saveDeviceLabel,
  readFillState,
  saveFillState,
} from './src/platform/expo-delivery.ts';
import { ProfilePreference, type Profile } from './src/ui/profile.ts';
import { repeatingPresentation, type RepeatingPresentation } from './src/ui/presentation.ts';
import { FieldWidget, ProfileSwitch } from './src/ui/widgets.tsx';

const RECORD = 'spike-record-1';

const context: RunContext = {
  // leg (iii) tests an application UPDATE, so the build identity must be
  // visible in the record. ⚠ READ from src/build.ts rather than written here:
  // a hardcoded 'N' would survive `npm run bump-to-n-plus-1` and the record
  // would name the wrong build, which is a false pass on the leg that tests
  // the update. build.test.ts holds build.ts and app.json to each other.
  buildId: BUILD_ID,
  // ⚠ Replaced at start-up by the operator's stored label. The first
  // delivery from a phone wrote `..._set-at-run-time-by-the-operator_N.json`
  // — the placeholder reached the evidence, which §6d does not permit.
  device: 'UNSET — set the device label',
  fill: 'set at run time by the operator',
  offline: false,
};

/** The tenant default SwR-093 defaults to; the worker may switch from it. */
const TENANT_DEFAULT_PROFILE: Profile = 'standard';

/**
 * 🔴 NEVER AWAIT A SIGNAL WITHOUT A DEADLINE.
 *
 * The first version awaited one with no timeout, and when the signal could not
 * arrive — because the navigation was a no-op — the campaign hung silently on
 * iteration 1. **A lost signal is indistinguishable from a slow device**, which
 * is the same defect this project already hit with `fetch` having no default
 * timeout; the lesson simply was not carried across.
 *
 * ➕ Ten seconds is far beyond any plausible navigation or focus change on the
 * weakest device in hand, and far below the patience of someone watching a bar
 * that is not moving.
 *
 * ⚠ AT MODULE SCOPE because `S2`'s `focusAndWait` uses it well above the point
 * where it used to be declared. A closure reading a `const` declared later in
 * the same body works — it is only called after that line runs — but relying on
 * that is a trap for the next edit, and this constant is not per-render anyway.
 */
const NAV_TIMEOUT_MS = 10_000;

/**
 * `S2`'s variants. ➕ NAMED RATHER THAN BOOLEAN because there are now three and
 * a pair of flags would admit combinations nobody has run — and the variant
 * NAME travels into the figure's own line on screen, so a delivered record can
 * never be mistaken for a different one.
 *
 * ✕ `blur-before-collapse` is KEPT THOUGH IT IS ANSWERED — it changed nothing
 * (slope +2.276 against the control's +2.297). A disproved control is still a
 * control, and deleting it would make the next reader wonder whether anyone
 * had tried it.
 */
type S2Variant = 'plain' | 'blur-before-collapse' | 'no-input-services' | 'no-collapse';

/**
 * What each variant means, carried INTO THE RECORD so a delivered figure
 * explains itself rather than relying on whoever pressed the button.
 *
 * ✕ `no-collapse` IS A DIAGNOSTIC, NOT A FIGURE. It omits M7 step 4's reset
 * entirely, so it must never be read as `S2`'s measurement — which is exactly
 * why the note saying so travels in the payload rather than in a message to
 * the owner.
 */
const S2_VARIANT_NOTE: Readonly<Record<S2Variant, string>> = Object.freeze({
  plain:
    'M7 §3 as written, within the recorded deviation: 5 focusable transitions per pass, ' +
    'the section collapsed and re-expanded between iterations (step 4).',
  'blur-before-collapse':
    'DIAGNOSTIC. As plain, but the focused input is blurred before the collapse, to test ' +
    'whether tearing down a focused view is what accumulates. It is not: +2.276 ms/iteration ' +
    'against the control\u2019s +2.297.',
  'no-input-services':
    'DIAGNOSTIC. As plain, but importantForAutofill="no", autoComplete="off" and ' +
    'spellCheck={false} are set BEFORE the inputs mount, to test Android\u2019s autofill and ' +
    'spell-check sessions. They are not it: +2.492 ms/iteration, unchanged.',
  'no-collapse':
    'DIAGNOSTIC, NOT A FIGURE — it omits M7 step 4\u2019s reset. The section is opened once and ' +
    'left open, so the five focus moves happen without the per-iteration remount. It exists ' +
    'to separate focus-alone from focus-plus-remount, which no run so far has done.',
});

export default function App(): React.JSX.Element {
  const form: FormDef = spikeForm;
  // The real width, so SwR-084's fallback is decided by the device rather than
  // by presentation.ts's ASSUMED_VIEWPORT_DP, which exists only for the tests.
  const { width } = useWindowDimensions();
  const order = React.useMemo(() => plan(form), [form]);
  /**
   * ⚠ The device label is read ONCE, here, because every `Figure` carries
   * the context it was taken under. Reading it later would leave figures
   * already recorded naming the wrong handset.
   */
  const runContext = React.useMemo<RunContext>(
    () => ({
      ...context,
      device: readDeviceLabel() || context.device,
      fill: readFillState() || context.fill,
    }),
    [],
  );
  const harness = React.useMemo(
    () => new Harness(runContext, () => performance.now()),
    [runContext],
  );
  const store = React.useMemo(
    () => new SqlCipherStore('spike.db', keystoreKeyProvider, openExpoDatabase),
    [],
  );

  const [answers, setAnswers] = React.useState<Answers>({});
  const [ready, setReady] = React.useState(false);
  const [openSection, setOpenSection] = React.useState<string>(form.sections[0]!.id);

  /**
   * 🔴 A COLLAPSED SECTION IS HIDDEN, NOT DESTROYED — `F-6`'s RULE, IMPLEMENTED.
   *
   * `SwR-082` requires collapsible sections, one expanded at a time. That is a
   * requirement about **what the worker sees**; how a collapse is implemented
   * was the author's choice, and the first choice was to UNMOUNT. Measurement
   * found what that costs: moving focus between fields gets steadily more
   * expensive the more it is done, **but only when the section is collapsed and
   * re-expanded between moves** — 36.8 → 220.4 ms at the §3a fill, +2.191 ms per
   * iteration. A `no-collapse` diagnostic stayed **flat at ~21 ms** and did so
   * *in a process the collapsing run had already dragged to ~106 ms*.
   *
   * ➕ SO THIS IS NOT A DEVIATION FROM M7 §3 step 4. Step 4 says *“Collapse the
   * section. (reset)”*, and the section is still collapsed from the worker's
   * point of view. **The unmount was never the instruction.** *(Unlike the
   * 5-versus-19 transitions, which IS a deviation and carries an owner
   * decision.)*
   *
   * ⚠ MOUNTED ON FIRST EXPAND, HIDDEN THEREAFTER — NOT MOUNTED ALWAYS. Keeping
   * every section mounted from the start would make **opening a form** mount
   * every field of every section, which would change `S1`'s figure — the one
   * just measured at the fill. *Nothing a worker has opened is destroyed; what
   * they have never opened is not built.* ✕ The memory cost of holding a whole
   * form's view hierarchy is noted in `F-6` and is NOT measured here.
   */
  const [everExpanded, setEverExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set([form.sections[0]!.id]),
  );
  React.useEffect(() => {
    if (!openSection || everExpanded.has(openSection)) return;
    setEverExpanded((prev) => new Set([...prev, openSection]));
  }, [openSection, everExpanded]);

  /**
   * ⚠ Read SYNCHRONOUSLY by `S2`'s reset. With the fields hidden rather than
   * unmounted there is no registration to wait for — the inputs never leave —
   * so the campaign waits on the section's own state instead.
   */
  const openSectionRef = React.useRef(openSection);
  openSectionRef.current = openSection;

  /**
   * SwR-093's switch. The preference object holds the profile and nothing else
   * — it has no reference to answers or to the instance, which is how "affects
   * no captured data, and is not recorded on the instance" is true by
   * construction rather than by care taken here. React needs its own copy to
   * re-render on, so the profile is mirrored into state and the preference
   * stays the thing that owns the rule.
   */
  const pref = React.useMemo(() => new ProfilePreference(TENANT_DEFAULT_PROFILE), []);
  const [profile, setProfile] = React.useState<Profile>(pref.current());

  /**
   * S5 — "photograph attached and visible, including compression (SwR-086) and
   * stamping (SwR-102)", under 2 s.
   *
   * ⚠ THE TWO CLOCK POINTS ARE M7 §2's, NOT CONVENIENT ONES.
   * START is "the shutter returns an image to the application" — so it is the
   * `onShutter` callback inside `captureAndPrepare`, NOT the button tap, which
   * would wrongly include the worker framing the shot and the camera opening.
   * STOP is "the thumbnail is VISIBLE in the form, after compression and
   * stamping" — so it is the thumbnail Image's own `onLoad`, not the moment
   * state is set, which is merely when React was told.
   */
  const [capture, setCapture] = React.useState<CaptureResult | null>(null);
  const onCapture = React.useCallback(async () => {
    // The level in force comes from SwR-086's layers, resolved in prepare.ts.
    const plan = planCapture(SHIPPED_LAYERS);
    const result = await captureAndPrepare(plan, () => harness.start('S5'));
    // ✕ A cancel is not a failure and must not be timed as one: with no
    // result there is no stop, so no sample is recorded.
    if (result) setCapture(result);
  }, [harness]);

  /**
   * Getting what the harness holds off the device.
   *
   * 🔴 WHAT THIS SENDS IS *NOT* A MEASUREMENT, AND IT SAYS SO.
   * The app marks S3 and S6 while the form is used by hand. Those are
   * real timings and they are not figures: no warm-up discarded, no
   * controlled fill, no §6a sample. The payload carries
   * `kind: 'incidental-marks'` so nothing downstream can mistake them for a
   * campaign's result — **a p95 over incidental marks looks exactly like a
   * p95 over a campaign**.
   *
   * ⚠ The address is typed in because the development machine's LAN address
   * moves between networks, and because on a phone `localhost` is the phone.
   */
  /**
   * 🔴 A CAMPAIGN GETS ITS OWN HARNESS. The app's harness already holds
   * S3/S6 marks from ordinary use, and `runCampaign` refuses a harness
   * that has recorded the sequence — rightly, since a p95 over a mixture of
   * conditions looks exactly like a p95 over a campaign. A dedicated
   * harness makes the separation structural instead of a thing to remember.
   */
  const [campaign, setCampaign] = React.useState<string>('');
  const [campaignFigures, setCampaignFigures] = React.useState<Figure[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [collector, setCollector] = React.useState<string>('');
  const [deviceLabel, setDeviceLabel] = React.useState<string>('');
  const [fill, setFill] = React.useState<string>('');
  const [delivery, setDelivery] = React.useState<string>('');

  React.useEffect(() => {
    setCollector(readCollectorBase());
    setDeviceLabel(readDeviceLabel());
    setFill(readFillState());
  }, []);

  /**
   * S3 + S6, driven to a full §6a sample. M7 §3 lists them as ONE section
   * with a single `mark start` and two stops, so they are driven together —
   * driving them apart would time two different value-sets and make the
   * pair incomparable.
   *
   * ⚠ TWO METHOD CHOICES THAT DECIDE WHAT THE FIGURE MEANS, both the
   * author's and both recorded here rather than buried:
   *
   * ➕ **The field is one a rule depends on.** M7 makes this a REQUIREMENT
   * of the step — “required, or S6 measures nothing” — so the value is set
   * on `defect`, which `explanation` and `photo` both react to.
   *
   * ➕ **S6 stops after the RENDER, not after `evaluate()` returns.** M7
   * stops it when “the next interaction is accepted — input unblocked”,
   * which is a property of the screen rather than of the engine. Timing
   * `evaluate()` alone would measure the rule engine and report it as the
   * application's figure. The cost is that React's frame scheduling is
   * inside the measurement; that makes the figure WORSE than the engine
   * alone, never better, so it cannot flatter a pass.
   */
  const onRunCampaign = React.useCallback(async () => {
    setBusy(true);
    setCampaign('starting\u2026');
    try {
      const fresh = new Harness(runContext, () => performance.now());
      const field = 'defect';
      let flip = false;

      const result = await runCampaign(
        fresh,
        'S3',
        async ({ iteration }) => {
          const token = 'c' + iteration;
          const value = flip ? 'true' : 'false';
          flip = !flip;

          fresh.start('S3', token);
          fresh.start('S6', token);

          await store.putAnswer(RECORD, field, value);
          fresh.stop('S3', token); // committed, not queued — brief §6c

          await new Promise<void>((resolve, reject) => {
            // ⚠ A DEADLINE HERE TOO. `requestAnimationFrame` does not fire
            // while the app is backgrounded, so a campaign left running
            // behind another app would stall here indefinitely — the same
            // shape as the navigation hang, for a different reason.
            const timer = setTimeout(
              () => reject(new Error('no frame within 10s — was the app backgrounded mid-campaign?')),
              10_000,
            );
            setAnswers((prev) => ({ ...prev, [field]: value }));
            // One frame, so the re-evaluation has reached the screen and
            // input is unblocked — which is what S6's stop event names.
            requestAnimationFrame(() => {
              clearTimeout(timer);
              resolve();
            });
          });
          fresh.stop('S6', token);
        },
        {
          onProgress: (p) =>
            setCampaign('iteration ' + p.iteration + '/' + p.total + (p.warmup ? ' (warm-up)' : '')),
        },
      );

      // S6 was driven by the same iteration, so its figure is ready too.
      const s6 = fresh.figure('S6');
      setCampaignFigures([result.figure, s6]);
      setCampaign(
        'S3 n=' + result.figure.n + ' p95=' + result.figure.p95Ms + 'ms ' +
          (result.figure.pass ? 'PASS' : 'FAIL') +
          '  |  S6 n=' + s6.n + ' p95=' + s6.p95Ms + 'ms ' + (s6.pass ? 'PASS' : 'FAIL') +
          '  — now Deliver',
      );
    } catch (err) {
      setCampaign('campaign failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }, [runContext, store]);

  /**
   * `S1` — opening a form, as M7 §3 actually defines it: **from the job
   * list, with the store already open**, stopping when the first field is
   * focusable, then leaving without saving. *(reset)*
   *
   * ➕ Each iteration opens a DIFFERENT job, stepping through the list.
   * Re-opening row 0 a hundred times would measure a row already mounted
   * and laid out, which flatters the navigation.
   */
  const runNavigationCampaign = React.useCallback(
    async (seq: 'S1' | 'S4') => {
      setBusy(true);
      setCampaign('starting ' + seq + '\u2026');
      try {
        const fresh = new Harness(runContext, () => performance.now());
        const result = await runCampaign(
          fresh,
          seq,
          async ({ iteration }) => {
            if (seq === 'S1') {
              /**
               * ⚠ Only navigate if we are not already there. M7's reset
               * returns to the list at the END of each iteration, so from
               * iteration 2 onwards we arrive here already on it — and
               * navigating to the screen you are on produces no layout and
               * no signal.
               */
              if (screenRef.current !== 'list') {
                await awaitSignal(listReady, 'worklist', () => setScreen('list'));
              }

              const target = jobForIteration(worklist, iteration);
              await awaitSignal(formReady, 'form', () => {
                fresh.start('S1');
                setJob(target);
                setScreen('form');
              });
              fresh.stop('S1');

              // M7 step 4: leave without saving, return to the list. Awaited,
              // so the next iteration genuinely starts from a settled list
              // rather than racing the navigation it depends on.
              await awaitSignal(listReady, 'worklist (reset)', () => setScreen('list'));
            } else {
              // S4 starts from a NON-list screen, so get onto the form first.
              if (screenRef.current !== 'form') {
                setJob(jobForIteration(worklist, iteration));
                await awaitSignal(formReady, 'form', () => setScreen('form'));
              }

              await awaitSignal(listReady, 'worklist', () => {
                fresh.start('S4');
                setScreen('list');
              });
              fresh.stop('S4');

              // Navigate away again (reset), so each iteration measures the
              // same journey rather than alternating between two.
              setJob(jobForIteration(worklist, iteration));
              await awaitSignal(formReady, 'form (reset)', () => setScreen('form'));
            }
          },
          {
            onProgress: (p) =>
              setCampaign(seq + ' ' + p.iteration + '/' + p.total + (p.warmup ? ' (warm-up)' : '')),
          },
        );
        setCampaignFigures([result.figure]);
        setCampaign(
          seq + ' n=' + result.figure.n + ' p95=' + result.figure.p95Ms + 'ms target=' +
            result.figure.targetMs + ' ' + (result.figure.pass ? 'PASS' : 'FAIL') + ' \u2014 now Deliver',
        );
      } catch (err) {
        setCampaign(seq + ' failed: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setBusy(false);
      }
    },
    [awaitSignal, runContext, worklist],
  );

  /**
   * `S5` — a photograph attached and visible, target **2 s**.
   *
   * ➕ The source is M7 §4a's **fixed fixture**, not the camera: *“a live
   * capture varies by lighting and sensor warm-up, so it measures the
   * camera rather than compression and stamping”*. ⚠ It is also the only
   * way to run the sequence 101 times at all — nobody can press a shutter
   * a hundred times and call the result a controlled sample.
   *
   * 🔴 THE CLOCK STOPS WHEN THE THUMBNAIL HAS LAID OUT, not when the
   * file is written. M7's stop is *“the thumbnail is visible in the form,
   * AFTER compression and stamping”* — a property of the screen. Stopping
   * at the end of `captureFromFixture` would omit the decode and draw of a
   * freshly written image, which is part of what the worker waits for.
   */
  const thumbReady = React.useRef<null | (() => void)>(null);
  const signalThumbReady = React.useCallback(() => {
    const r = thumbReady.current;
    thumbReady.current = null;
    r?.();
  }, []);

  const runS5Campaign = React.useCallback(async () => {
    setBusy(true);
    setCampaign('starting S5\u2026');
    try {
      const fresh = new Harness(runContext, () => performance.now());
      const plan = planCapture(SHIPPED_LAYERS);

      const result = await runCampaign(
        fresh,
        'S5',
        async () => {
          const shot = await new Promise<CaptureResult>((resolve, reject) => {
            captureFromFixture(plan, () => fresh.start('S5')).then(resolve, reject);
          });

          // Wait for the thumbnail itself, with a deadline for the same
          // reason every other signal has one: a lost signal is otherwise
          // indistinguishable from a slow device.
          await awaitSignal(thumbReady, 'thumbnail', () => setCapture(shot));
          fresh.stop('S5');

          // M7 step 4 (reset): delete the attachment and confirm it is gone.
          setCapture(null);
          const gone = await discardCapture(shot.uri);
          if (!gone) throw new Error('the captured file survived its deletion: ' + shot.uri);
        },
        {
          onProgress: (p) =>
            setCampaign('S5 ' + p.iteration + '/' + p.total + (p.warmup ? ' (warm-up)' : '')),
        },
      );

      setCampaignFigures([result.figure]);
      setCampaign(
        'S5 n=' + result.figure.n + ' p95=' + result.figure.p95Ms + 'ms target=' +
          result.figure.targetMs + ' ' + (result.figure.pass ? 'PASS' : 'FAIL') + ' \u2014 now Deliver',
      );
    } catch (err) {
      setCampaign('S5 failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }, [awaitSignal, runContext, signalThumbReady]);

  /**
   * `S2` — moving between fields in the dense section, target **300 ms**.
   *
   * 🔴 THE FIELDS ARE FOCUSED BY REF, WHICH IS THE WHOLE REASON `S2` WAS
   * BLOCKED. M7 stops the clock when *“field k+1 accepts input”*, a property of
   * the control, so the stop is the target's own `onFocus` — not a state update,
   * which would time React rather than the platform.
   *
   * ⚠ ONE SAMPLE PER ITERATION, REDUCED BY §4b's RULE. `reduceIteration` takes
   * the pass's own p95; letting every move through would redefine `n` from 100
   * to several hundred and quietly change what §6a's sample means.
   *
   * ✕ It measures **5 transitions, not M7's 19** — see `FOCUSABLE_FIELD_TYPES`
   * for why that is the honest reading and why it yields the same number.
   */
  const focusInputs = React.useRef<Record<string, TextInput | null>>({});
  const registerInput = React.useCallback((id: string, input: TextInput | null) => {
    focusInputs.current[id] = input;
  }, []);
  const awaitingFocus = React.useRef<null | { id: string; done: () => void }>(null);
  const onFieldFocus = React.useCallback((id: string) => {
    const w = awaitingFocus.current;
    if (w && w.id === id) {
      awaitingFocus.current = null;
      w.done();
    }
  }, []);

  /**
   * Waits until a field's input IS or IS NOT registered.
   *
   * ⚠ M7 step 4 resets `S2` by **collapsing the section**, which unmounts all
   * twenty widgets — so each iteration must wait for the re-mounted inputs
   * before it can focus one. ✕ A FIXED SLEEP WOULD BE THE WRONG TOOL: too
   * short and iteration 1 dies on a missing ref, too long and 101 iterations
   * carry minutes of invented delay. Polling the registration itself is the
   * thing actually being waited for.
   *
   * ➕ The deadline is the same one every other signal carries, for the same
   * reason: a reset that silently never completes must not look like a slow
   * device.
   */
  /**
   * Waits until the dense section is open or collapsed.
   *
   * ⚠ REPLACES WAITING FOR THE INPUTS TO UNREGISTER, which only worked while a
   * collapse destroyed them. Now that it hides them the registration never
   * changes, and the old wait would simply have timed out — *a reset that
   * cannot complete would have looked like a slow device, which is the defect
   * this project keeps rediscovering.*
   */
  const awaitSection = React.useCallback(
    async (wantOpen: boolean): Promise<void> => {
      const until = Date.now() + NAV_TIMEOUT_MS;
      for (;;) {
        if ((openSectionRef.current === 'dense') === wantOpen) return;
        if (Date.now() > until) {
          throw new Error(
            'S2: the dense section did not ' + (wantOpen ? 'open' : 'collapse') +
              ' within ' + NAV_TIMEOUT_MS + 'ms',
          );
        }
        await new Promise<void>((r) => setTimeout(r, 8));
      }
    },
    [],
  );

  const awaitRegistration = React.useCallback(
    async (id: string, present: boolean): Promise<void> => {
      const until = Date.now() + NAV_TIMEOUT_MS;
      for (;;) {
        const got = focusInputs.current[id] != null;
        if (got === present) return;
        if (Date.now() > until) {
          throw new Error(
            'S2: ' + id + (present ? ' never registered' : ' never unregistered') +
              ' within ' + NAV_TIMEOUT_MS + 'ms',
          );
        }
        await new Promise<void>((r) => setTimeout(r, 8));
      }
    },
    [],
  );

  const focusAndWait = React.useCallback(async (id: string): Promise<void> => {
    const input = focusInputs.current[id];
    if (!input) throw new Error('S2: no input registered for ' + id + ' — is the dense section open?');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          awaitingFocus.current = null;
          reject(new Error('S2: ' + id + ' did not report focus within ' + NAV_TIMEOUT_MS + 'ms'));
        },
        NAV_TIMEOUT_MS,
      );
      awaitingFocus.current = {
        id,
        done: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      input.focus();
    });
  }, []);

  const [quietInputs, setQuietInputs] = React.useState(false);
  /**
   * ⚠ Held in a ref, not state, because `onDeliver` reads it when the operator
   * presses Deliver — possibly several renders after the campaign ended — and a
   * stale closure here would stamp the WRONG variant onto a record, which is
   * worse than stamping none.
   */
  const lastVariant = React.useRef<{ name: string; note: string } | null>(null);

  const runS2Campaign = React.useCallback(async (variant: S2Variant) => {
    const blurBeforeCollapse = variant === 'blur-before-collapse';
    // ✕ The ONE variant that does not perform M7 step 4, and the reason it exists.
    const collapses = variant !== 'no-collapse';
    setBusy(true);
    setCampaign('starting S2' + (variant === 'plain' ? '' : ' [' + variant + ']') + '\u2026');
    try {
      /**
       * ⚠ Set BEFORE the first expand, so the inputs mount with the props in
       * force. `importantForAutofill` is read by the platform when the view is
       * created, so toggling it on a mounted input would prove nothing.
       * The campaign's setup collapses the section first, which guarantees
       * every input this run uses is mounted after this line.
       */
      setQuietInputs(variant === 'no-input-services');
      lastVariant.current = { name: variant, note: S2_VARIANT_NOTE[variant] };
      const pairs = denseFocusTransitions();
      if (pairs.length === 0) throw new Error('S2: the dense section has no focusable pairs');

      // The form must be mounted at all — the worklist screen returns early and
      // renders no fields — and the section starts COLLAPSED, so iteration 1
      // begins in the same state M7's reset leaves every other iteration in.
      setScreen('form');
      // The fields mount on their FIRST expand and are only hidden afterwards,
      // so the section is opened once before anything can be focused.
      setOpenSection('dense');
      await awaitRegistration(pairs[0]![0], true);
      if (collapses) {
        // Then collapsed, so iteration 1 begins in the state M7's reset leaves
        // every other iteration in.
        setOpenSection('');
        await awaitSection(false);
      }

      const fresh = new Harness(runContext, () => performance.now());

      const result = await runCampaign(
        fresh,
        'S2',
        async () => {
          // M7 step 1: open the dense section — ~20 visible fields, the brief's
          // labelled density. That density is the CONDITION the transitions are
          // measured under, not part of what is timed.
          if (collapses) {
            setOpenSection('dense');
            await awaitSection(true);
          }

          // M7 step 2: focus field 1. ⚠ OUTSIDE the timing — it is the pass's
          // starting position, not a move between fields.
          await focusAndWait(pairs[0]![0]);

          // M7 step 3: time each move.
          const within: number[] = [];
          for (const [, to] of pairs) {
            const t0 = performance.now();
            await focusAndWait(to);
            within.push(performance.now() - t0);
          }

          // §4b: one sample per iteration, the pass reduced by its own p95.
          fresh.reduceIteration('S2', within);

          /**
           * 🔴 THE ONE VARIABLE THIS BUILD EXISTS TO TEST.
           *
           * `S2` is the only sequence that UNMOUNTS A TEXTINPUT WHILE IT STILL
           * HOLDS FOCUS — M7 step 4 collapses the section immediately after the
           * last focus move. Across two campaigns in one process the cost per
           * move went **29 → 316 ms**, continuously across the campaign
           * boundary, with the slope rising **+0.764 → +2.297 ms/iteration** as
           * accumulated moves went ~300 → ~900 — both factors of three.
           * ⚠ **A slope proportional to the work already done is quadratic
           * growth**, which is what a collection gaining one item per focus and
           * being walked on every focus would produce.
           *
           * ➕ Blurring first is the single controlled change that would stop a
           * focused view being torn down. **It is offered as a VARIANT rather
           * than applied**, so the two can be compared on one build — if the
           * trend survives the blur, the hypothesis is dead and nothing has
           * been quietly “fixed” underneath the measurement.
           *
           * ✕ And note it is not a free fix even if it works: the application
           * will unmount focused inputs in ordinary use, whenever a worker
           * collapses a section mid-edit.
           */
          if (collapses) {
            if (blurBeforeCollapse) {
              focusInputs.current[pairs[pairs.length - 1]![1]]?.blur();
            }
            setOpenSection('');
            await awaitSection(false);
          }
        },
        {
          onProgress: (p) =>
            setCampaign('S2 ' + p.iteration + '/' + p.total + (p.warmup ? ' (warm-up)' : '')),
        },
      );

      setCampaignFigures([result.figure]);
      setCampaign(
        'S2 [' + variant + '] n=' + result.figure.n + ' p95=' + result.figure.p95Ms +
          'ms target=' + result.figure.targetMs + ' ' + (result.figure.pass ? 'PASS' : 'FAIL') +
          ' (' + pairs.length + ' transitions/pass) \u2014 now Deliver',
      );
    } catch (err) {
      setCampaign('S2 failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      /**
       * 🔴 LEAVE THE APPLICATION USABLE. `S2`'s reset ends with the dense
       * section COLLAPSED, and on 2026-10-25 that booby-trapped the next
       * sequence: `S1` navigated to a form with no fields rendered, so nothing
       * reported layout and it died on its warm-up after ten seconds.
       *
       * ⚠ A campaign's per-iteration reset is not the same thing as leaving
       * the app as it was found, and conflating them cost a whole experiment.
       * ➕ In the `finally`, so a FAILED campaign cleans up too — that is
       * exactly the case that bit, since the failure is what leaves the odd
       * state behind.
       */
      setOpenSection(form.sections[0]!.id);
      setQuietInputs(false);
      setBusy(false);
    }
  }, [awaitRegistration, awaitSection, focusAndWait, form, runContext]);

  React.useEffect(() => {
    if (screen !== 'list' || !ready) return;
    let live = true;
    setJobs(null);
    void store
      .listJobs()
      .then((rows) => {
        if (live) setJobs(rows);
      })
      .catch((err) => {
        // ⚠ A failed read must not look like a slow one — the same defect that
        // hid a failed store open behind a splash screen.
        if (live) setCampaign('worklist read failed: ' + (err instanceof Error ? err.message : String(err)));
      });
    return () => {
      live = false;
    };
  }, [screen, ready, store]);

  /**
   * §3a's worklist is the FIRST thing the fill writes — but `S1` and `S4` must
   * work before anyone builds a 1.6 GiB fill, so the table is seeded on first
   * open with the same generated rows.
   *
   * ➕ Seeded only when it is EMPTY. Re-seeding every launch would rewrite 200
   * rows each time and, worse, would mask a fill that had failed to write them.
   */
  React.useEffect(() => {
    if (!ready) return;
    let live = true;
    void (async () => {
      try {
        const counts = await store.counts();
        if (live && counts.jobs === 0) await store.putJobs(worklist);
        if (live) setFillState(await measureFill(store));
      } catch (err) {
        if (live) {
          setCampaign('seeding the worklist failed: ' + (err instanceof Error ? err.message : String(err)));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [ready, store, worklist]);

  const refreshFill = React.useCallback(async () => {
    setFillState(await measureFill(store));
  }, [store]);

  const onBuildFill = React.useCallback(async () => {
    setFillBusy(true);
    stopFill.current = false;
    try {
      const mb = (n: number) => (n / (1024 * 1024)).toFixed(0);
      const final = await buildFill(
        store,
        worklist,
        (p) => {
          setFillState(p.state);
          setCampaign(
            'fill [' + p.phase + '] records ' + mb(p.state.recordBytes) + ' MiB + media ' +
              mb(p.state.mediaBytes) + ' MiB = ' + mb(p.state.totalBytes) + ' MiB',
          );
        },
        () => stopFill.current,
      );
      setFillState(final);
      setCampaign(describeFill(final));
    } catch (err) {
      setCampaign('fill failed: ' + (err instanceof Error ? err.message : String(err)));
      await refreshFill();
    } finally {
      setFillBusy(false);
    }
  }, [refreshFill, store, worklist]);

  const onClearFill = React.useCallback(async () => {
    setFillBusy(true);
    try {
      setCampaign('clearing the fill (VACUUM can take a while)\u2026');
      setFillState(await clearFill(store));
      setCampaign('fill cleared');
    } catch (err) {
      setCampaign('clear failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFillBusy(false);
    }
  }, [store]);

  const onDeliver = React.useCallback(async () => {
    setDelivery('working\u2026');
    try {
      await saveCollectorBase(collector);
      await saveDeviceLabel(deviceLabel);
      await saveFillState(fill);

      /**
       * 🔴 REFUSED RATHER THAN DOCUMENTED. The first real delivery
       * arrived naming its handset `UNSET — set the device label`, because
       * the label is read at start-up and typing it is not enough. §6d
       * requires the ACTUAL device, so **a record that cannot say which
       * handset produced it is not a record** — and a trap that only a
       * README warns about is a trap that gets sprung.
       *
       * ⚠ The check is against the HARNESS's context, not the text field:
       * the field may already hold the right name while every figure
       * recorded so far carries the placeholder, and it is the figures
       * that travel.
       */
      if (runContext.device === context.device) {
        setDelivery(
          'refused: the label is SAVED but not in force — now RESTART the app. ' +
            'Figures carry the context they were taken under, so a label applied after ' +
            'they were recorded would name the wrong handset.',
        );
        return;
      }

      // ⚠ `record()` asserts nothing is still being timed. A mark left open
      // would otherwise be delivered as a silently short figure.
      /**
       * ⚠ A campaign's figures travel as `kind: 'campaign'` WITH their
       * steps; anything else is `incidental-marks` with none. The kind is
       * decided by what was actually run, never by a toggle — a payload
       * that could be mislabelled by hand would defeat the distinction.
       */
      const isCampaign = campaignFigures !== null;
      const figures = isCampaign ? campaignFigures! : harness.record().figures;
      const payload = devicePayload(
        isCampaign ? 'campaign' : 'incidental-marks',
        runContext,
        figures,
        new Date().toISOString(),
        isCampaign ? stepsForRecord(campaignFigures!.map((f) => f.seq)) : {},
        coldStartMs,
        LOCATION_DEADLINE_MS,
        // Only an S2 figure carries one; every other sequence has no variants.
        isCampaign && campaignFigures!.some((f) => f.seq === 'S2') ? lastVariant.current : null,
        fillMeasured,
      );
      const json = stableJson(payload);

      const outcome = await deliver(
        json,
        collector,
        expoPost,
        { buildId: runContext.buildId, device: runContext.device },
        // On a phone, always. The loopback guard exists for this call.
        { onDevice: true },
      );

      if (outcome.delivered) {
        setDelivery('delivered: ' + (outcome.stored ?? 'accepted'));
        return;
      }

      // 🔴 Never lost. The collector could not take it, so it goes to
      // the device and the operator is told exactly where.
      const uri = await writeFigureFallback(outcome.fallbackFilename!, json);
      setDelivery('NOT delivered (' + outcome.reason + ') \u2014 written to ' + uri);
    } catch (err) {
      setDelivery('failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [campaignFigures, coldStartMs, collector, deviceLabel, fill, harness, runContext]);
  const onSwitchProfile = React.useCallback(
    (next: Profile) => {
      pref.switchTo(next);
      setProfile(pref.current());
      // ✕ Nothing is written to the store here, deliberately. The switch is a
      // device preference; writing it to the record would break SwR-093.
    },
    [pref],
  );

  /**
   * SwR-084's presentation for the repeating section, at SwR-093's
   * "correspondingly wider width". ⚠ The result genuinely differs between
   * profiles on a phone-width screen, which is 1b's substantive finding: the
   * same form shows a grid under Standard and stacked cards under Field.
   */
  const repeatColumns = form.fields.filter((f) => f.repeating).length;
  const repeatPresentation: RepeatingPresentation = repeatingPresentation(
    'grid',
    repeatColumns,
    profile,
    width,
  );

  /**
   * Opening the store, which must happen before anything is interactive.
   *
   * 🔴 THE CATCH IS NOT DEFENSIVE PADDING. Without it a rejected
   * `open()` was swallowed as an unhandled rejection, `ready` stayed false,
   * and the app sat on “opening the encrypted store…” forever — so **a
   * store that FAILED to open was indistinguishable from one that was
   * slow**. That is the worst possible presentation of leg (iv)'s subject:
   * the quiet failure the whole axis exists to catch, hidden behind a
   * splash screen. It cost an install cycle before it was noticed.
   */
  const [openFailure, setOpenFailure] = React.useState<string>('');
  /**
   * 🔴 MEASURED, BUT NOT AS `S1`. The launch was instrumented as `S1`
   * and it is not one: M7 starts `S1` at the form-open tap **from the job
   * list with the store already open**. Timing a cold start under that
   * name put a launch figure against a navigation's 300 ms target, and it
   * also meant ordinary use filled `S1`'s slot with the wrong thing — so a
   * real `S1` campaign would later have been refused for the wrong reason.
   *
   * ➕ The number is kept because it is the most expensive thing observed
   * so far, and it is reported with **no target and no verdict**.
   */
  const [coldStartMs, setColdStartMs] = React.useState<number | null>(null);

  /**
   * 🔴 THE LIST IS WHAT MAKES `S1` AND `S4` MEASURABLE AT ALL. Both are
   * NAVIGATIONS — M7 starts `S1` *“from the job list”* with the store
   * already open, and `S4` *“from a non-list screen”* — so with no list
   * there was nowhere to navigate from or to, and the nearest thing to
   * “opening a form” was application launch. That is exactly how a cold
   * start came to be recorded under `S1`'s name.
   */
  const [screen, setScreen] = React.useState<'list' | 'form'>('list');
  const [job, setJob] = React.useState<Job | null>(null);
  /**
   * The GENERATED worklist — §3a's seed and `S1`'s job labels, not `S4`'s data.
   * ➕ Kept because the fill needs rows to write and `S1` needs a job to put in
   * the form header, neither of which is a store read.
   */
  const worklist = React.useMemo(() => makeWorklist(DEFAULT_WORKLIST_VOLUME), []);

  /**
   * 🔴 `S4`'s DATA, READ FROM THE STORE — WHICH IT WAS NOT UNTIL NOW.
   *
   * The list used to render the memoised `worklist` above: **pure computation,
   * never touching the store**. So *“opening the job list”* read nothing, and
   * §3a's fill could not have moved `S4`'s figure **by construction** — it
   * would have returned ~30 ms whatever the device held. *The product's
   * worklist comes from the device store; a render over an in-memory array was
   * measuring the wrong thing.*
   *
   * ⚠ `null` MEANS “NOT LOADED YET”, and it matters: the list renders nothing
   * until the query returns, so `S4`'s stop — the first screenful laid out —
   * cannot fire over stale rows from the previous navigation. *Without that,
   * the second iteration onwards would measure a cached render.*
   *
   * ✕ It re-queries on EVERY open rather than caching. A real client might
   * cache and refresh — `SwR-096` requires the list to state *“when it was last
   * refreshed”*, which implies as much — but caching is an optimisation nobody
   * has decided, and measuring the uncached cost is the honest default.
   */
  const [jobs, setJobs] = React.useState<Job[] | null>(null);

  const [fillMeasured, setFillState] = React.useState<FillState>(() =>
    fillState({ recordBytes: 0, mediaBytes: 0, jobs: 0, instances: 0, answers: 0, mediaFiles: 0 }),
  );
  const [fillBusy, setFillBusy] = React.useState(false);
  const stopFill = React.useRef(false);

  /**
   * ⚠ THE RESOLVER IS ARMED BEFORE THE NAVIGATION IS TRIGGERED, never
   * after. Layout can complete before a promise created afterwards would
   * have registered its callback, and the campaign would then wait forever
   * on an event that had already happened — a hang that looks like a slow
   * device rather than a lost signal.
   */
  const listReady = React.useRef<null | (() => void)>(null);
  const formReady = React.useRef<null | (() => void)>(null);

  /**
   * ⚠ A REF, BECAUSE THE CAMPAIGN NEEDS TO KNOW WHERE IT IS *NOW*.
   * The loop runs inside one closure across 101 iterations, so reading
   * `screen` from state would read the value captured when the campaign
   * started. The first version did not check at all, which is how it came to
   * navigate to the screen it was already on.
   */
  const screenRef = React.useRef<'list' | 'form'>('list');
  screenRef.current = screen;

  const awaitSignal = React.useCallback(
    (slot: React.MutableRefObject<null | (() => void)>, what: string, trigger: () => void) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          slot.current = null;
          /**
           * 🔴 STATE WHAT WAS OBSERVED; DO NOT GUESS WHY.
           *
           * This message used to read *“the navigation probably did not happen
           * — a screen does not re-layout when it is already showing”*, which
           * names the one cause the author knew about. On 2026-10-25 it fired
           * for a DIFFERENT cause — `S2` had left the dense section collapsed,
           * so the form rendered no fields and nothing could report layout —
           * and the confident wrong guess sent the reader at the navigation.
           *
           * ⚠ A diagnostic that asserts a cause is worse than one that reports
           * a fact, because it is believed exactly when the reader has least
           * information of their own.
           */
          reject(
            new Error(
              'no ' + what + ' signal within ' + NAV_TIMEOUT_MS + 'ms. The trigger ran and no ' +
                'layout followed. Known causes: the screen was already showing, so nothing ' +
                're-laid out; or nothing is rendered that reports this signal — for the form, ' +
                'that means no section is expanded.',
            ),
          );
        }, NAV_TIMEOUT_MS);
        // Armed BEFORE the trigger: layout can complete before a callback
        // registered afterwards would exist.
        slot.current = () => {
          clearTimeout(timer);
          resolve();
        };
        trigger();
      }),
    [],
  );

  const signalListReady = React.useCallback(() => {
    const r = listReady.current;
    listReady.current = null;
    r?.();
  }, []);
  const signalFormReady = React.useCallback(() => {
    const r = formReady.current;
    formReady.current = null;
    r?.();
  }, []);
  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const t0 = performance.now();
        await store.open();
        const loaded = await store.getAnswers(RECORD);
        if (!live) return;
        setAnswers(loaded);
        setReady(true);
        setColdStartMs(performance.now() - t0);
      } catch (err) {
        if (!live) return;
        // ⚠ Reported verbatim. SqlCipherStore's messages name which step
        // refused — the key PRAGMA, the integrity check, the schema — and
        // paraphrasing them would throw away the attribution leg (iv)
        // depends on.
        setOpenFailure(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [harness, store]);

  const state = React.useMemo(() => evaluate(form, answers, order), [form, answers, order]);

  /**
   * S3 and S6 share ONE start, which is the brief's design (§6c) and the
   * reason the harness takes a token: S3 stops when the write is committed,
   * S6 when the next interaction is accepted.
   */
  const onCommit = React.useCallback(
    async (field: string, value: string) => {
      const token = `${field}:${Date.now()}`;
      harness.start('S3', token);
      harness.start('S6', token);

      await store.putAnswer(RECORD, field, value);
      harness.stop('S3', token); // durable in the store, not queued

      setAnswers((prev) => {
        const next = { ...prev, [field]: value };
        // the settled re-evaluation is what unblocks input, so S6 stops after it
        evaluate(form, next, order);
        return next;
      });
      harness.stop('S6', token);
    },
    [form, harness, order, store],
  );

  if (openFailure) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.status}>The encrypted store did not open.</Text>
        <Text selectable style={styles.note}>{openFailure}</Text>
        <Text style={styles.note}>
          {'\n'}If this mentions the integrity check, the database on this device was not
          written by the key now in the keystore — reinstall after clearing the app’s data.
        </Text>
      </ScrollView>
    );
  }
  if (!ready) return <Text style={styles.status}>opening the encrypted store…</Text>;

  /**
   * ➕ THE OPERATOR CONTROLS BELONG ON BOTH SCREENS. The worklist is now
   * the default screen, and leaving the campaign buttons only on the form
   * would mean starting a run required navigating away from the screen
   * `S1` and `S4` start from.
   */
  /**
   * 🔴 THE CONTROLS SCROLL, AND THEY DID NOT UNTIL 2026-10-25.
   *
   * They were a fragment placed after a `flex: 1` sibling on both screens.
   * That works while they fit; **once they do not, the overflow is simply
   * clipped and there is no way to reach it**. By the time §3a's fill added a
   * status line and three buttons — beside four `S2` variants — **Deliver had
   * gone off the bottom of the screen, so a figure that had already been
   * measured could not be delivered.**
   *
   * ⚠ A measuring apparatus whose RESULT cannot be retrieved is worse than one
   * that fails outright: the campaign still runs, still reports its p95 on
   * screen, and the record is simply lost.
   *
   * ➕ `maxHeight` rather than `flex: 1`, so the pane never takes the whole
   * screen and the worklist or form underneath stays visible — `S1` and `S4`
   * navigate between those, and a control pane covering them would change what
   * is being measured.
   */
  const controls = (
    <ScrollView style={styles.controlsPane}>
      {/*
        SyR-221: "On a phone, the actions used most often during capture shall be
        reachable by the thumb of the hand holding it, in every profile." The
        switch is one of `PRIMARY_CAPTURE_ACTIONS`, so it is pinned to the bottom
        of the screen — inside the thumb zone — rather than put behind a settings
        screen. ⚠ `presentation.ts` models the VERTICAL axis only, and the real
        thumb arc is also horizontal; the far corner is what condition 3 has to
        look at on a device.
      */}
      {/*
        ⚠ Deliberately NOT in the thumb zone. SyR-221 reserves that band for
        "the actions used most often during capture"; delivering figures is an
        operator action between runs, and putting it under the thumb would make
        it easy to hit by accident during a measured sequence.
      */}
      <View style={styles.collectorBar}>
        {/*
          🔴 §3a's FILL, AND THE STATE IT REPORTS IS MEASURED, NOT TYPED.
          Every figure to date was taken at `fill: none`, where §6a wants the
          §3a fill THROUGHOUT — so none of the five is a condition-1 figure
          yet, whatever its margin.
        */}
        <Text style={styles.note}>{describeFill(fillMeasured)}</Text>
        <Pressable
          onPress={() => { void onBuildFill(); }}
          disabled={fillBusy || busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>
            {fillBusy ? 'building the fill\u2026' : 'Build the \u00a73a fill (1.6 GiB \u2014 takes a long time)'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { stopFill.current = true; }}
          disabled={!fillBusy}
          style={styles.capture}
          accessibilityRole="button"
        >
          {/*
            ⚠ Stops BETWEEN batches, so it never leaves half an instance. The
            build resumes from wherever it stopped, because it measures rather
            than counts.
          */}
          <Text>{'Stop building (resumable)'}</Text>
        </Pressable>
        <Pressable
          onPress={() => { void onClearFill(); }}
          disabled={fillBusy || busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>{'Clear the fill (VACUUMs \u2014 also slow)'}</Text>
        </Pressable>
        <Text style={styles.note}>device label (§6d: the actual handset) — restart to apply</Text>
        <TextInput
          style={styles.collectorInput}
          value={deviceLabel}
          onChangeText={setDeviceLabel}
          onBlur={() => { void saveDeviceLabel(deviceLabel); }}
          placeholder="Galaxy M04"
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel="Device label"
        />
        <Text style={styles.note}>fill (§6d: the state held throughout) — restart to apply</Text>
        <TextInput
          style={styles.collectorInput}
          value={fill}
          onChangeText={setFill}
          onBlur={() => { void saveFillState(fill); }}
          placeholder="80% of SwR-115's 2 GB budget"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Fill state"
        />
        <Text style={styles.note}>collector (the dev machine's LAN address)</Text>
        <TextInput
          style={styles.collectorInput}
          value={collector}
          onChangeText={setCollector}
          onBlur={() => { void saveCollectorBase(collector); }}
          placeholder="http://192.168.1.50:8080"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Collector address"
        />
        <Pressable
          onPress={onRunCampaign}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>{busy ? 'running\u2026' : 'Run campaign: S3 + S6 (' + ITERATIONS + ' passes)'}</Text>
        </Pressable>
        <Pressable
          onPress={() => { void runNavigationCampaign('S1'); }}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>{busy ? 'running\u2026' : 'Run campaign: S1 \u2014 opening a form'}</Text>
        </Pressable>
        <Pressable
          onPress={() => { void runS2Campaign('plain'); }}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>{busy ? 'running\u2026' : 'Run campaign: S2 \u2014 moving between fields'}</Text>
        </Pressable>
        <Pressable
          onPress={() => { void runS2Campaign('blur-before-collapse'); }}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>
            {busy ? 'running\u2026' : 'Run campaign: S2 \u2014 VARIANT: blur before collapsing'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { void runS2Campaign('no-input-services'); }}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>
            {busy ? 'running\u2026' : 'Run campaign: S2 \u2014 VARIANT: no autofill / spell-check'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { void runS2Campaign('no-collapse'); }}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>
            {busy ? 'running\u2026' : 'Run campaign: S2 \u2014 VARIANT: no collapse (diagnostic)'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { void runS5Campaign(); }}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>{busy ? 'running…' : 'Run campaign: S5 — photograph attached'}</Text>
        </Pressable>
        <Pressable
          onPress={() => { void runNavigationCampaign('S4'); }}
          disabled={busy}
          style={styles.capture}
          accessibilityRole="button"
        >
          <Text>{busy ? 'running\u2026' : 'Run campaign: S4 \u2014 opening the list'}</Text>
        </Pressable>
        {campaign ? <Text style={styles.note}>{campaign}</Text> : null}
        {/* ➕ Named here so the operator sees WHY the other six are absent. */}
        <Text style={styles.note}>
          {'not drivable yet: ' +
            (['S7', 'S8'] as const)
              .map((s) => s + ' (' + (SEQUENCES[s].blockedBy ?? '').split(',')[0] + ')')
              .join('; ')}
        </Text>
        <Pressable onPress={onDeliver} style={styles.capture} accessibilityRole="button">
          <Text>
            {campaignFigures ? 'Deliver CAMPAIGN figures' : 'Deliver marks (not a measurement)'}
          </Text>
        </Pressable>
        {delivery ? <Text style={styles.note}>{delivery}</Text> : null}
      </View>
    
      <View style={styles.thumbZone}>
        {/*
          Both of these are in `PRIMARY_CAPTURE_ACTIONS`, which is why they are
          here and not in a menu: SyR-221 requires the actions used most often
          during capture to be thumb-reachable IN EVERY PROFILE.
        */}
        <Pressable onPress={onCapture} style={styles.capture} accessibilityRole="button">
          <Text>Capture a photograph</Text>
        </Pressable>
        {capture ? (
          <View style={styles.thumbRow}>
            <Image
              source={{ uri: capture.uri }}
              style={styles.thumb}
              // S5's STOP: the thumbnail is visible, after compression and stamping.
              /**
               * 🔴 It used to call `harness.stop('S5')` directly, which
               * marked the app's own harness during ordinary use — the same
               * mistake that put a cold start under `S1`'s name. It now only
               * SIGNALS; the campaign decides whether anything is being timed.
               */
              onLoad={signalThumbReady}
            />
            {/* The stamp is shown because SwR-102 makes it part of the response,
                and because a figure for "attached and visible" is only honest if
                what became visible included the stamp. */}
            <View style={styles.stamp}>
              <Text style={styles.note}>level used: {capture.stamp.levelUsed}</Text>
              <Text style={styles.note}>
                {capture.nativeWidth}×{capture.nativeHeight} → long edge{' '}
                {capture.stamp.longEdgePx ?? 'native'}
              </Text>
              <Text style={styles.note}>
                {capture.stamp.location
                  ? 'at ' +
                    capture.stamp.location.latitude.toFixed(4) +
                    ', ' +
                    capture.stamp.location.longitude.toFixed(4) +
                    ' ±' +
                    (capture.stamp.location.accuracyMetres ?? '?') +
                    'm'
                  : LOCATION_UNAVAILABLE}
              </Text>
            </View>
          </View>
        ) : null}
        <ProfileSwitch profile={profile} onSwitch={onSwitchProfile} />
      </View>
    </ScrollView>
  );

  /**
   * ➕ The list is the default screen, which is also what M7 assumes: `S1`
   * starts *“from the job list”*, so landing there is the ordinary state
   * rather than a mode the operator has to find.
   */
  if (screen === 'list') {
    return (
      <View style={styles.screen}>
        <WorklistScreen
          jobs={jobs ?? []}
          profile={profile}
          onFirstScreenful={signalListReady}
          onOpenJob={(j) => {
            setJob(j);
            setScreen('form');
          }}
        />
        {controls}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <Pressable onPress={() => setScreen('list')} accessibilityRole="button">
        <Text style={styles.sectionLabel}>
          {'\u2039 worklist' + (job ? '  \u00b7  ' + job.reference + ' \u00b7 ' + job.customer : '')}
        </Text>
      </Pressable>
      {form.sections.map((section) => {
        const expanded = openSection === section.id;
        return (
          <View key={section.id} style={styles.section}>
            {/* SwR-082: collapsible, and one expanded at a time */}
            <Pressable onPress={() => setOpenSection(expanded ? '' : section.id)}>
              <Text style={styles.sectionLabel}>
                {expanded ? '▾' : '▸'} {section.label}
              </Text>
            </Pressable>
            {/*
              🔴 `display: 'none'` — the fields stay mounted and leave the layout.
              Rendering them with `{expanded && …}` destroyed them on every
              collapse, which is what made focus cost grow. See `everExpanded`.
            */}
            {everExpanded.has(section.id) && (
            <View style={expanded ? undefined : styles.collapsed}>
              {form.fields
                .filter((f) => f.section === section.id && state.state[f.id]?.visible)
                .map((f, fieldIndex) => (
                  <FieldWidget
                    key={f.id}
                    onFirstFieldLayout={
                      expanded && fieldIndex === 0 ? signalFormReady : undefined
                    }
                    registerInput={registerInput}
                    onFieldFocus={onFieldFocus}
                    suppressInputServices={quietInputs}
                    field={f}
                    profile={profile}
                    state={state.state[f.id]!}
                    value={answers[f.id] ?? null}
                    onCommit={onCommit}
                  />
                ))}
            </View>
            )}
            {expanded && section.repeating ? (
              <Text style={styles.note}>
                repeating presentation: {repeatPresentation} ({repeatColumns} columns, {width}dp
                wide)
              </Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
    {controls}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * ⚠ `paddingTop` for the status bar. Without it the first line of the
   * controls renders UNDER the clock and battery — which on 2026-10-25 hid the
   * fill's own status line, the one thing that says whether the device is in
   * the state §6a requires.
   */
  screen: { flex: 1, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0 },
  /** Bounded, so the screen underneath stays visible and reachable. */
  controlsPane: { maxHeight: '55%' },
  /** §F-6: collapsed means hidden and out of layout, never unmounted. */
  collapsed: { display: 'none' },
  /** Inside a screen that already pads for the status bar; padding twice would gap. */
  pane: { flex: 1 },
  content: { padding: 16 },
  status: { padding: 24 },
  section: { marginBottom: 12 },
  sectionLabel: { fontWeight: '600', paddingVertical: 8 },
  note: { paddingVertical: 4, fontStyle: 'italic' },
  // ✕ No field, label, input, invalid or message styles any more: every
  // dimension and colour a widget uses now comes from `profile.ts`'s tokens,
  // which is what makes `presentation.test.ts` evidence about what renders.
  thumbZone: { padding: 12 },
  collectorBar: { paddingHorizontal: 12, paddingTop: 8 },
  /**
   * 🔴 THE COLOURS ARE EXPLICIT BECAUSE THE DEFAULTS ARE NOT OURS.
   *
   * These three operator fields used to set neither `color` nor
   * `backgroundColor`, so they rendered as TRANSPARENT boxes carrying whatever
   * text colour the platform chose — and on a device showing the system dark
   * theme that came out dark-on-dark and unreadable. ⚠ **Typing mistakes in
   * these fields are not cosmetic**: they are the `§6d` run conditions. An
   * unreadable device label is how a record came back saying `Galaxy M35 5G`,
   * and an unreadable fill is how one came back saying `wmpty`.
   *
   * ➕ The values are `profile.ts`'s own `STANDARD` tokens — `#1a1a1a` on
   * `#ffffff` — rather than a fresh pair, so the operator bar matches the form
   * controls above it, which have always set both and have always been legible.
   * *They are written literally rather than imported because this bar is the
   * harness's own furniture, not a `SwR-084` widget; `presentation.test.ts` is
   * evidence about what the FORM renders, and borrowing its tokens here would
   * quietly widen what that test appears to cover.*
   */
  collectorInput: {
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#595959',
    borderRadius: 4,
    paddingHorizontal: 8,
    minHeight: 44,
    marginVertical: 4,
  },
  capture: { paddingVertical: 12, alignItems: 'center' },
  thumbRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  thumb: { width: 64, height: 64, borderRadius: 4 },
  stamp: { marginLeft: 8, flex: 1 },
});

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
} from 'react-native';

import { Harness, type RunContext } from './src/harness/harness.ts';
import { evaluate, plan } from './src/form/evaluate.ts';
import type { Answers, FormDef } from './src/form/model.ts';
import { SqlCipherStore } from './src/store/store.ts';
import { Queue } from './src/queue/queue.ts';
import { keystoreKeyProvider, openExpoDatabase } from './src/platform/expo-adapters.ts';
import { spikeForm } from './src/form/spike-form.ts';
import { BUILD_ID } from './src/build.ts';
import { planCapture, SHIPPED_LAYERS, LOCATION_UNAVAILABLE } from './src/media/prepare.ts';
import { captureAndPrepare, type CaptureResult } from './src/platform/expo-media.ts';
import { devicePayload, stableJson } from './src/harness/report.ts';
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
   * The app marks S1, S3 and S6 while the form is used by hand. Those are
   * real timings and they are not figures: no warm-up discarded, no
   * controlled fill, no §6a sample. The payload carries
   * `kind: 'incidental-marks'` so nothing downstream can mistake them for a
   * campaign's result — **a p95 over incidental marks looks exactly like a
   * p95 over a campaign**.
   *
   * ⚠ The address is typed in because the development machine's LAN address
   * moves between networks, and because on a phone `localhost` is the phone.
   */
  const [collector, setCollector] = React.useState<string>('');
  const [deviceLabel, setDeviceLabel] = React.useState<string>('');
  const [fill, setFill] = React.useState<string>('');
  const [delivery, setDelivery] = React.useState<string>('');

  React.useEffect(() => {
    setCollector(readCollectorBase());
    setDeviceLabel(readDeviceLabel());
    setFill(readFillState());
  }, []);

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
          'refused: the device label is not in force yet. Type it above, then RESTART ' +
            'the app — figures carry the context they were taken under, so a label set ' +
            'after they were recorded would name the wrong handset.',
        );
        return;
      }

      // ⚠ `record()` asserts nothing is still being timed. A mark left open
      // would otherwise be delivered as a silently short figure.
      const taken = harness.record();
      const payload = devicePayload('incidental-marks', runContext, taken.figures);
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
  }, [collector, deviceLabel, fill, harness, runContext]);
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
   * S1's stop is "the form is interactive", so the store must be open first.
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
  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        harness.start('S1');
        await store.open();
        const loaded = await store.getAnswers(RECORD);
        if (!live) return;
        setAnswers(loaded);
        setReady(true);
        harness.stop('S1');
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

  return (
    <View style={styles.screen}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
            {expanded &&
              form.fields
                .filter((f) => f.section === section.id && state.state[f.id]?.visible)
                .map((f) => (
                  <FieldWidget
                    key={f.id}
                    field={f}
                    profile={profile}
                    state={state.state[f.id]!}
                    value={answers[f.id] ?? null}
                    onCommit={onCommit}
                  />
                ))}
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
      <Text style={styles.note}>device label (§6d: the actual handset) — restart to apply</Text>
      <TextInput
        style={styles.collectorInput}
        value={deviceLabel}
        onChangeText={setDeviceLabel}
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
        placeholder="http://192.168.1.50:8080"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Collector address"
      />
      <Pressable onPress={onDeliver} style={styles.capture} accessibilityRole="button">
        <Text>Deliver marks (not a measurement)</Text>
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
            onLoad={() => harness.stop('S5')}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  collectorInput: {
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

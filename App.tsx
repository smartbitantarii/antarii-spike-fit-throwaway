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
import { ScrollView, Text, Pressable, View, StyleSheet, useWindowDimensions } from 'react-native';

import { Harness, type RunContext } from './src/harness/harness.ts';
import { evaluate, plan } from './src/form/evaluate.ts';
import type { Answers, FormDef } from './src/form/model.ts';
import { SqlCipherStore } from './src/store/store.ts';
import { Queue } from './src/queue/queue.ts';
import { keystoreKeyProvider, openExpoDatabase } from './src/platform/expo-adapters.ts';
import { spikeForm } from './src/form/spike-form.ts';
import { ProfilePreference, type Profile } from './src/ui/profile.ts';
import { repeatingPresentation, type RepeatingPresentation } from './src/ui/presentation.ts';
import { FieldWidget, ProfileSwitch } from './src/ui/widgets.tsx';

const RECORD = 'spike-record-1';

const context: RunContext = {
  // leg (iii) tests an application UPDATE, so the build identity must be
  // visible in the record: N and N+1 differ here and in app.json's version.
  buildId: 'N',
  device: 'set at run time by the operator',
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
  const harness = React.useMemo(() => new Harness(context, () => performance.now()), []);
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

  // S1's stop is "the form is interactive", so the store must be open first.
  React.useEffect(() => {
    let live = true;
    (async () => {
      harness.start('S1');
      await store.open();
      const loaded = await store.getAnswers(RECORD);
      if (!live) return;
      setAnswers(loaded);
      setReady(true);
      harness.stop('S1');
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
    <View style={styles.thumbZone}>
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
});

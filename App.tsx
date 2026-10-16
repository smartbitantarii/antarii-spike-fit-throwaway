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
import { ScrollView, Text, TextInput, Pressable, View, StyleSheet } from 'react-native';

import { Harness, type RunContext } from './src/harness/harness.ts';
import { evaluate, plan } from './src/form/evaluate.ts';
import type { Answers, FormDef } from './src/form/model.ts';
import { SqlCipherStore } from './src/store/store.ts';
import { Queue } from './src/queue/queue.ts';
import { keystoreKeyProvider, openExpoDatabase } from './src/platform/expo-adapters.ts';
import { spikeForm } from './src/form/spike-form.ts';

const RECORD = 'spike-record-1';

const context: RunContext = {
  // leg (iii) tests an application UPDATE, so the build identity must be
  // visible in the record: N and N+1 differ here and in app.json's version.
  buildId: 'N',
  device: 'set at run time by the operator',
  fill: 'set at run time by the operator',
  offline: false,
};

export default function App(): React.JSX.Element {
  const form: FormDef = spikeForm;
  const order = React.useMemo(() => plan(form), [form]);
  const harness = React.useMemo(() => new Harness(context, () => performance.now()), []);
  const store = React.useMemo(
    () => new SqlCipherStore('spike.db', keystoreKeyProvider, openExpoDatabase),
    [],
  );

  const [answers, setAnswers] = React.useState<Answers>({});
  const [ready, setReady] = React.useState(false);
  const [openSection, setOpenSection] = React.useState<string>(form.sections[0]!.id);

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
                  <View key={f.id} style={styles.field}>
                    <Text style={styles.label}>
                      {f.label}
                      {state.state[f.id]?.required ? ' *' : ''}
                    </Text>
                    <TextInput
                      style={[styles.input, state.state[f.id]?.valid ? null : styles.invalid]}
                      defaultValue={String(answers[f.id] ?? '')}
                      onBlur={(e) => onCommit(f.id, e.nativeEvent.text)}
                    />
                    {state.state[f.id]?.message ? (
                      <Text style={styles.message}>{state.state[f.id]!.message}</Text>
                    ) : null}
                  </View>
                ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16 },
  status: { padding: 24 },
  section: { marginBottom: 12 },
  sectionLabel: { fontWeight: '600', paddingVertical: 8 },
  field: { marginBottom: 10 },
  label: { marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 4, padding: 8 },
  invalid: { borderColor: '#b00' },
  message: { color: '#b00', marginTop: 2 },
});

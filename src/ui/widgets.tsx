/**
 * Step 1b, part 3 — the eight widgets, in both profiles.
 *
 * 🔴 EVERY DIMENSION HERE IS READ FROM `present()` AND `TOKENS`. Nothing is
 * hand-written. That is not tidiness: if these components carried their own
 * numbers, `presentation.test.ts` would be testing a parallel universe and the
 * sixteen presentations it checks would not be the sixteen the device renders.
 * The tests are only evidence about this file because this file has no numbers
 * of its own.
 *
 * ⚠ THIS FILE IS NOT TESTED BY `node --test`, AND THAT IS DELIBERATE. It is
 * `.tsx`, and Node's strip-only TypeScript does not transform JSX — the same
 * reason `App.tsx` is only ever loaded by Metro. So the split is the one
 * `src/platform/` already established: all the DECIDABLE content sits in
 * `profile.ts` and `presentation.ts` as plain `.ts` and is tested on a
 * development machine, and what is left here is rendering, which is what
 * condition 3 measures on the device.
 */
import React from 'react';
import { Text, TextInput, Pressable, View } from 'react-native';

import type { FieldDef, FieldState, Value } from '../form/model.ts';
import { TOKENS, statusPresentation, type Profile, type StatusKind } from './profile.ts';
import { present, accessibleFieldLabel } from './presentation.ts';

// ---------------------------------------------------------------- status line

/**
 * `SyR-221` Field: "status never carried by colour without a shape or word".
 * `SwR-053`, under BOTH profiles: a required or invalid state "is also
 * announced in text". Both are satisfied by always rendering the glyph and the
 * word, which is why there is no profile branch here.
 */
export function StatusLine(props: { profile: Profile; kind: StatusKind }): React.JSX.Element {
  const t = TOKENS[props.profile];
  const s = statusPresentation(props.profile, props.kind);
  return (
    <Text
      accessibilityLabel={s.word}
      style={{ color: s.colour, fontSize: t.labelDp }}
    >
      {s.glyph} {s.word}
    </Text>
  );
}

// ------------------------------------------------------------- the eight types

interface WidgetProps {
  /**
   * ⚠ `S1` stops when *“the first field is focusable”*, which React does
   * not announce. Layout is the closest observable — a field that has been
   * laid out can take focus — so the FIRST field on the screen carries this
   * and nothing else does. Passing it to every field would stop the clock
   * at whichever happened to lay out last.
   */
  onFirstFieldLayout?: () => void;
  /**
   * 🔴 `S2`'s HANDLE ON THE FIELD. The campaign must move focus itself —
   * “nothing manages focus programmatically” was what blocked `S2` — so the
   * focusable widgets hand their `TextInput` up by ref. ⚠ Only `text` and
   * `number` call it; `FOCUSABLE_FIELD_TYPES` in `model.ts` is the declared
   * list, and a test checks this file against it rather than trusting it.
   */
  registerInput?: (id: string, input: TextInput | null) => void;
  /** `S2`'s STOP: the target field has taken focus and accepts input. */
  onFieldFocus?: (id: string) => void;
  /**
   * 🔴 `S2`'s SECOND HYPOTHESIS, AS A VARIANT RATHER THAN A FIX.
   *
   * Focusing a `TextInput` on Android wakes the **autofill** and **spell-check**
   * services, each of which keeps per-session state. Those are the remaining
   * candidates for the cost that grows with accumulated focus operations —
   * mounting was ruled out by `S1` staying flat over 101 mounts, and unmounting
   * a focused input by the blur variant changing nothing.
   *
   * ⚠ TURNED ON ONLY FOR THE VARIANT RUN. If these props were simply applied,
   * a disappearing trend would prove nothing: there would be no run to compare
   * against, and “we changed three things and it got better” is not a finding.
   *
   * ✕ AND THEY ARE NOT FREE IF THEY WORK. `autoComplete` off and
   * `importantForAutofill` *no* deny the worker their saved addresses and the
   * platform's own convenience; `spellCheck` false removes correction from free
   * text a field worker types one-handed. *That is a product decision, not a
   * performance switch.*
   */
  suppressInputServices?: boolean;
  field: FieldDef;
  profile: Profile;
  state: FieldState;
  value: Value;
  onCommit: (field: string, value: string) => void;
}

/** Options exist only so single- and multi-select have something to present. */
const SPIKE_OPTIONS = ['Pass', 'Advisory', 'Fail'];

function useBox(profile: Profile, field: FieldDef) {
  // `present()` is consulted even where only the tokens are read, so a change
  // to the presentation table cannot drift away from what renders.
  return { t: TOKENS[profile], p: present(field.type, profile) };
}

/**
 * The control's own box. `minHeight` is `SyR-221`'s touch floor and
 * `hitSlop` is not used to fake it: a target that only *registers* at 64dp
 * while *looking* 32dp fails the requirement as a user experiences it.
 */
function controlStyle(profile: Profile, valid: boolean) {
  const t = TOKENS[profile];
  return {
    minHeight: t.minTouchDp,
    borderWidth: 1,
    borderColor: valid ? t.outline : statusPresentation(profile, 'invalid').colour,
    borderRadius: 4,
    paddingHorizontal: 8,
    justifyContent: 'center' as const,
    backgroundColor: t.background,
  };
}

export function FieldWidget(props: WidgetProps): React.JSX.Element {
  const { field, profile, state, value, onCommit, registerInput, onFieldFocus } = props;
  const quiet = props.suppressInputServices
    ? ({ importantForAutofill: 'no', autoComplete: 'off', spellCheck: false } as const)
    : null;
  const { t } = useBox(profile, field);

  /**
   * 🔴 `SC-06` — WHAT A SCREEN READER HEARS WHEN THE CONTROL TAKES FOCUS.
   *
   * ⚠ Not `field.label` alone, which is what all seven branches said until
   * now. The visible `StatusLine` nodes below announce *required* and
   * *invalid* in text — `SwR-053` and `SyR-221`'s *"status never by colour
   * alone"* — **but they are SIBLINGS of the control inside a container
   * marked `accessible={false}`**, so a worker moving between controls with
   * TalkBack or VoiceOver hears the label and never reaches them.
   *
   * ➕ Two channels for two audiences, not duplication: the sighted worker
   * reads the line, the screen-reader user hears the label. *Remove either and
   * one audience loses the rule outcome.*
   */
  const a11yLabel = accessibleFieldLabel(field.label, {
    required: state.required,
    valid: state.valid,
    message: state.message,
  });

  const label = (
    <Text style={{ fontSize: t.labelDp, color: t.text, marginBottom: 4 }}>
      {field.label}
    </Text>
  );

  const body = (() => {
    switch (field.type) {
      case 'text':
        return (
          <TextInput
            ref={(r) => registerInput?.(field.id, r)}
            onFocus={() => onFieldFocus?.(field.id)}
            {...quiet}
            style={[controlStyle(profile, state.valid), { fontSize: t.valueDp, color: t.text }]}
            defaultValue={String(value ?? '')}
            onBlur={(e) => onCommit(field.id, e.nativeEvent.text)}
            accessibilityLabel={a11yLabel}
          />
        );

      case 'number':
        return (
          <TextInput
            ref={(r) => registerInput?.(field.id, r)}
            onFocus={() => onFieldFocus?.(field.id)}
            {...quiet}
            style={[controlStyle(profile, state.valid), { fontSize: t.valueDp, color: t.text }]}
            keyboardType="numeric"
            defaultValue={String(value ?? '')}
            onBlur={(e) => onCommit(field.id, e.nativeEvent.text)}
            accessibilityLabel={a11yLabel}
          />
        );

      // ➕ A TRIGGER, NOT A PICKER, and said plainly. A platform date picker
      // is a modal whose own timing is the platform's, not ours; condition 3
      // measures the presentation and the touch target, which is what this is.
      case 'date':
        return (
          <Pressable
            style={controlStyle(profile, state.valid)}
            onPress={() => onCommit(field.id, new Date().toISOString().slice(0, 10))}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
          >
            <Text style={{ fontSize: t.valueDp, color: t.text }}>
              {String(value ?? 'Choose a date')}
            </Text>
          </Pressable>
        );

      case 'single-select': {
        const i = SPIKE_OPTIONS.indexOf(String(value ?? ''));
        const next = SPIKE_OPTIONS[(i + 1) % SPIKE_OPTIONS.length]!;
        return (
          <Pressable
            style={controlStyle(profile, state.valid)}
            onPress={() => onCommit(field.id, next)}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
          >
            <Text style={{ fontSize: t.valueDp, color: t.text }}>
              {String(value ?? 'Choose one')}
            </Text>
          </Pressable>
        );
      }

      // Two rows, which is what CONTROL_ROWS['multi-select'] says it costs:
      // the trigger, and a row showing what is chosen.
      case 'multi-select': {
        const chosen = Array.isArray(value) ? value : [];
        return (
          <View>
            <Pressable
              style={controlStyle(profile, state.valid)}
              onPress={() => onCommit(field.id, SPIKE_OPTIONS.join(','))}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
            >
              <Text style={{ fontSize: t.valueDp, color: t.text }}>Choose any</Text>
            </Pressable>
            <View style={{ minHeight: t.minTouchDp, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: t.labelDp, color: t.text }}>
                {chosen.length ? chosen.join(' · ') : 'none chosen'}
              </Text>
            </View>
          </View>
        );
      }

      case 'checkbox':
      case 'check-item': {
        const on = value === true || value === 'true';
        return (
          <Pressable
            style={[controlStyle(profile, state.valid), { flexDirection: 'row', alignItems: 'center' }]}
            onPress={() => onCommit(field.id, on ? 'false' : 'true')}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={a11yLabel}
          >
            {/* The box is a square at the touch floor less its padding, so the
                tappable area and the visible control are the same thing. */}
            <View
              style={{
                width: t.minTouchDp - 16,
                height: t.minTouchDp - 16,
                borderWidth: 2,
                borderColor: t.outline,
                borderRadius: 4,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* A shape, not a colour — SyR-221's Field clause, applied in both. */}
              <Text style={{ fontSize: t.valueDp, color: t.text }}>{on ? '✓' : ''}</Text>
            </View>
            <Text style={{ fontSize: t.valueDp, color: t.text, marginLeft: 8 }}>
              {on ? 'Yes' : 'No'}
            </Text>
          </Pressable>
        );
      }

      // Three rows: the capture control and a thumbnail strip, which is what
      // CONTROL_ROWS['media'] charges it.
      case 'media':
        return (
          <View>
            <Pressable
              style={controlStyle(profile, state.valid)}
              onPress={() => onCommit(field.id, 'captured')}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
            >
              <Text style={{ fontSize: t.valueDp, color: t.text }}>Capture</Text>
            </Pressable>
            <View
              style={{
                minHeight: t.minTouchDp * 2,
                borderWidth: 1,
                borderColor: t.outline,
                borderRadius: 4,
                marginTop: 4,
                justifyContent: 'center',
                paddingHorizontal: 8,
              }}
            >
              <Text style={{ fontSize: t.labelDp, color: t.text }}>
                {value ? '1 item' : 'no media yet'}
              </Text>
            </View>
          </View>
        );
    }
  })();

  return (
    <View
      style={{ marginBottom: t.rowGapDp }}
      accessible={false}
      onLayout={props.onFirstFieldLayout}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {label}
        {/* SwR-053: required is announced in TEXT, not by the asterisk alone. */}
        {state.required ? <StatusLine profile={profile} kind="required" /> : null}
      </View>
      {body}
      {!state.valid ? <StatusLine profile={profile} kind="invalid" /> : null}
      {state.message ? (
        <Text style={{ fontSize: t.labelDp, color: statusPresentation(profile, 'invalid').colour }}>
          {state.message}
        </Text>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------- SwR-093's switch

/**
 * The worker's own switch. ⚠ It lives in the thumb zone — `SyR-221` names the
 * actions "used most often during capture" as the ones that must be reachable
 * "in every profile", and `PRIMARY_CAPTURE_ACTIONS` includes this one, so the
 * shell places it there rather than in a settings screen two taps away.
 */
export function ProfileSwitch(props: {
  profile: Profile;
  onSwitch: (p: Profile) => void;
}): React.JSX.Element {
  const t = TOKENS[props.profile];
  const next: Profile = props.profile === 'standard' ? 'field' : 'standard';
  return (
    <Pressable
      onPress={() => props.onSwitch(next)}
      style={{
        minHeight: t.minTouchDp,
        borderWidth: 2,
        borderColor: t.outline,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.background,
      }}
      accessibilityRole="button"
      accessibilityLabel={'Switch to the ' + next + ' profile'}
    >
      <Text style={{ fontSize: t.valueDp, color: t.text }}>
        Profile: {props.profile} → tap for {next}
      </Text>
    </Pressable>
  );
}

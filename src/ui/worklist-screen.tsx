/**
 * The job list — `S1` navigates out of it, `S4` navigates into it.
 *
 * ⚠ THE TWO CALLBACKS ARE THE MEASUREMENT, not decoration. M7 stops `S4`
 * when *"the first screenful is interactive"* and `S1` when *"the first field
 * is focusable"*, and neither is a moment React tells you about directly —
 * so the screens signal it themselves through `onFirstScreenful`.
 *
 * 🔴 `onLayout` IS THE PROXY, AND IT IS AN APPROXIMATION I AM LABELLING.
 * A row that has been laid out can be tapped, so layout is the closest
 * observable to "interactive" without synthesising a touch. It is slightly
 * EARLY — paint may follow — so **the figure it produces is optimistic**, and
 * a figure near its target should be read with that in mind rather than
 * treated as settled.
 */
import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import type { Job } from '../form/worklist.ts';
import { TOKENS, type Profile } from './profile.ts';

export interface WorklistScreenProps {
  jobs: readonly Job[];
  profile: Profile;
  onOpenJob: (job: Job) => void;
  /**
   * Fired once per mount, when the first screenful has been laid out.
   * ⚠ Once — a list that fired on every row would stop `S4`'s clock at a
   * moment nobody chose.
   */
  onFirstScreenful?: () => void;
}

export function WorklistScreen(props: WorklistScreenProps): React.JSX.Element {
  const t = TOKENS[props.profile];
  const fired = React.useRef(false);

  const signalOnce = React.useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    props.onFirstScreenful?.();
  }, [props]);

  const renderItem = React.useCallback(
    ({ item, index }: { item: Job; index: number }) => (
      <Pressable
        onPress={() => props.onOpenJob(item)}
        accessibilityRole="button"
        accessibilityLabel={'Open ' + item.reference + ' for ' + item.customer}
        style={{
          // SyR-221's touch floor applies to a list row as much as a control.
          minHeight: t.minTouchDp,
          justifyContent: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: t.outline,
          backgroundColor: t.background,
        }}
        // The first row's layout is the earliest point at which the screenful
        // can be acted on, which is what S4's stop event names.
        onLayout={index === 0 ? signalOnce : undefined}
      >
        <Text style={{ fontSize: t.valueDp, color: t.text }}>
          {item.reference} · {item.customer}
        </Text>
        <Text style={{ fontSize: t.labelDp, color: t.text }}>
          {item.site} · due {item.due} · {item.state}
        </Text>
      </Pressable>
    ),
    [props, signalOnce, t],
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <Text style={{ fontSize: t.valueDp, color: t.text, padding: 12, fontWeight: '600' }}>
        Worklist · {props.jobs.length} jobs
      </Text>
      <FlatList
        data={props.jobs as Job[]}
        keyExtractor={(j) => j.id}
        renderItem={renderItem}
        /**
         * ⚠ No `initialNumToRender` override and no `getItemLayout`. Both
         * would make the list cheaper to mount, and `S4` exists to measure
         * what the list actually costs — tuning it here would be measuring
         * the tuning. If a figure fails, THAT is when the trade-off becomes a
         * decision with evidence behind it.
         */
        // Fires when the list has content laid out, covering the case where
        // the data is empty and no row ever lays out.
        onContentSizeChange={signalOnce}
      />
    </View>
  );
}

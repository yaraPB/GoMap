import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { api } from '../api/client';
import type { Answer, Lang } from '../api/types';
import { t } from '../i18n/strings';
import { useApp, useLocation } from '../state/app';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { Btn, Icon, IconBtn, T } from '../ui/kit';
import { color } from '../ui/theme';
import { useSpeech } from '../voice/useSpeech';
import Waveform from '../voice/Waveform';

const LANG_LABEL: Record<Lang, string> = { en: 'English', fr: 'Français', ar: 'العربية' };

function understood(a: Answer | null) {
  if (!a || a.intent === 'unknown') return null;
  if (a.intent === 'place' && a.place) return { title: `Directions → ${a.place.name}`, body: 'Release to confirm. Directions open on their own · you will not have to tap again.' };
  if (a.intent === 'person' && a.person) return { title: `Office → ${a.person.name}`, body: 'Release to see where they are and whether they are in.' };
  if (a.intent === 'procedure' && a.procedure) return { title: `How to → ${a.procedure.title}`, body: 'Release to see the steps, the office and its hours.' };
  if (a.intent === 'help') return { title: 'Help → a quick tour of GoMap', body: 'Release to start the walkthrough.' };
  return null;
}

/** Pulsing double ring around the mic while listening (design: mic-ring). */
function MicRings({ on }: { on: boolean }) {
  const a = useSharedValue(0), b = useSharedValue(0);
  useEffect(() => {
    if (on) {
      a.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1);
      b.value = withDelay(1200, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1));
    } else { a.value = withTiming(0); b.value = withTiming(0); }
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const sa = useAnimatedStyle(() => ({ opacity: a.value === 0 ? 0 : 0.45 * (1 - a.value), transform: [{ scale: 0.8 + a.value * 1.1 }] }));
  const sb = useAnimatedStyle(() => ({ opacity: b.value === 0 ? 0 : 0.35 * (1 - b.value), transform: [{ scale: 0.8 + b.value * 1.1 }] }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.ring, sa]} />
      <Animated.View pointerEvents="none" style={[styles.ring, sb]} />
    </>
  );
}

export default function Voice() {
  const insets = useSafeAreaInsets();
  const { lang, setLang, reduceMotion } = useApp();
  const loc = useLocation();
  const nav = useNav();
  const { pop, replace } = usePanels();
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState('');
  const [preview, setPreview] = useState<Answer | null>(null);
  const [sending, setSending] = useState(false);
  const [toggled, setToggled] = useState(false);
  const pressedAt = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starting = useRef<Promise<boolean> | null>(null);
  const finishing = useRef(false);
  const speech = useSpeech({ onLevel: setLevel, onPartial: setPartial });
  const listening = speech.state === 'listening';
  const thinking = speech.state === 'transcribing' || sending;

  // "Understood as" while still speaking: local router only, no model call, no log
  useEffect(() => {
    if (!partial || partial.length < 4) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { api.ask(partial, lang, loc.coord, [], true).then(setPreview).catch(() => {}); }, 280);
  }, [partial]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    if (listening || thinking) return;
    setPreview(null); setPartial('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const pending = speech.start(lang);
    starting.current = pending;
    const ok = await pending;
    if (!ok) setToggled(false);
    return ok;
  };
  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    const started = starting.current ? await starting.current : listening;
    starting.current = null;
    if (!started) { finishing.current = false; return; }
    Haptics.selectionAsync().catch(() => {});
    let text = '';
    try { text = (await speech.stop()).trim(); } catch { finishing.current = false; return; }
    if (!text) { finishing.current = false; return; }
    setSending(true);
    try {
      const a = await api.ask(text, lang, loc.reason === 'off-campus' ? null : loc.coord, [], true);
      if (a.intent === 'place' && a.action?.type === 'route' && a.place) {
        const ready = await nav.preview({ placeId: a.place.id, name: a.place.name, coordinates: a.place.coordinates, category: a.place.category }, a.action.mode === 'step_free' ? 'step_free' : 'walk');
        if (a.action.mode === 'ar' && ready) { nav.start(); replace({ name: 'go' }); router.push('/ar'); }
        else { if (a.text) Speech.speak(a.text, { language: lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar' : 'en-US' }); replace({ name: 'route', said: text, reply: a.text }); }
      } else replace({ name: 'assistant', ask: text });
    } catch {
      replace({ name: 'assistant', ask: text });
    } finally { setSending(false); finishing.current = false; }
  };
  const onPressIn = () => { pressedAt.current = Date.now(); if (!toggled) begin(); };
  const onPressOut = () => {
    if (toggled) { setToggled(false); finish(); return; }
    if (Date.now() - pressedAt.current < 350) { setToggled(true); return; } // a tap: keep listening until tapped again
    finish();
  };
  useEffect(() => () => { speech.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const words = partial.split(' ');
  const confirmed = listening && words.length > 2 ? words.slice(0, -2).join(' ') : partial;
  const tail = listening && words.length > 2 ? ' ' + words.slice(-2).join(' ') : '';
  const card = understood(preview);
  const cycleLang = () => setLang(lang === 'en' ? 'fr' : lang === 'fr' ? 'ar' : 'en');

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, styles.root]}>
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <IconBtn icon="close" label="Cancel voice input" onPress={() => { speech.cancel(); pop(); }} bg="rgba(255,255,255,0.14)" stroke="#fff" float={false} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Language: ${LANG_LABEL[lang]}. Tap to switch.`} onPress={cycleLang} style={styles.langBtn}>
          <Icon name="globe" size={16} stroke="#fff" />
          <T weight="semibold" style={{ color: '#fff', fontSize: 13 }}>{LANG_LABEL[lang]}</T>
        </Pressable>
      </View>

      <View style={[styles.center, { top: insets.top + 140 }]}>
        <T weight="semibold" style={styles.state}>{thinking ? t(lang, 'thinking') : listening ? t(lang, 'listening') : speech.state === 'error' ? 'Microphone' : 'Ready'}</T>
        <Waveform level={level} mode={thinking ? 'thinking' : listening ? 'listening' : 'idle'} reduceMotion={reduceMotion} />
        <View style={{ minHeight: 70, paddingHorizontal: 28 }}>
          {partial ? (
            <T weight="semibold" style={styles.transcript} accessibilityLiveRegion="polite">{confirmed}<T weight="semibold" style={[styles.transcript, { color: '#6B7280' }]}>{tail}{listening ? '…' : ''}</T></T>
          ) : (
            <T style={[styles.transcript, { color: '#6B7280', fontSize: 20 }]}>{listening ? (speech.engine === 'native' ? 'Go ahead…' : 'Speak, then release') : 'Try “Take me to building eight”'}</T>
          )}
          <T style={styles.hint}>{speech.engine === 'native' ? `${LANG_LABEL[lang]} · on-device recognition` : `${LANG_LABEL[lang]} · words appear after you release (install the dev build for live words)`}</T>
        </View>
      </View>

      {card && !speech.error && (
        <Animated.View entering={FadeInDown.duration(260)} style={[styles.card, { bottom: insets.bottom + 150 }]}>
          <T weight="bold" style={styles.cardLabel}>{t(lang, 'understoodAs').toUpperCase()}</T>
          <T weight="semibold" style={{ color: '#fff', fontSize: 15 }}>{card.title}</T>
          <T style={{ color: '#A7ACB4', fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>{card.body}</T>
        </Animated.View>
      )}
      {speech.error && (
        <Animated.View entering={FadeInDown} style={[styles.card, { bottom: insets.bottom + 150 }]}>
          <T weight="semibold" style={{ color: '#fff', fontSize: 14 }}>{speech.error.includes('permission') ? 'Microphone permission is off' : 'Voice did not work this time'}</T>
          <T style={{ color: '#A7ACB4', fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>{speech.error}</T>
          <Btn title="Type instead" kind="secondary" small onPress={() => replace({ name: 'assistant' })} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
        </Animated.View>
      )}

      <View style={[styles.mic, { bottom: insets.bottom + 34 }]}>
        <View style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}>
          <MicRings on={listening && !reduceMotion} />
          <Pressable accessibilityRole="button" accessibilityLabel={listening ? 'Release to send' : 'Hold to talk'} accessibilityHint="Hold while you speak, release to send. Or tap once to start and again to send."
            onPressIn={onPressIn} onPressOut={onPressOut} disabled={thinking}
            style={({ pressed }) => [styles.micBtn, (pressed || listening) && { transform: [{ scale: 1.06 }] }, thinking && { opacity: 0.6 }]}>
            <Icon name="mic" size={28} stroke="#fff" />
          </Pressable>
        </View>
        <T style={{ color: color.muted2, fontSize: 12 }}>{toggled ? t(lang, 'tapToStop') : t(lang, 'holdToTalk')}</T>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: 'rgba(14,16,21,0.9)' },
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)' },
  center: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 18 },
  state: { fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', color: color.blueText },
  transcript: { fontSize: 26, lineHeight: 33, letterSpacing: -0.5, color: '#fff', textAlign: 'center' },
  hint: { marginTop: 14, fontSize: 13, color: color.muted2, textAlign: 'center' },
  card: { position: 'absolute', left: 16, right: 16, padding: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  cardLabel: { fontSize: 11, letterSpacing: 0.6, color: color.muted2, marginBottom: 4 },
  mic: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 12 },
  ring: { position: 'absolute', width: 116, height: 116, borderRadius: 58, backgroundColor: 'rgba(37,99,235,0.3)' },
  micBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.blue, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
});

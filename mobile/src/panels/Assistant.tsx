import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { api, ApiError } from '../api/client';
import type { Answer, Lang } from '../api/types';
import { fmtMinutes } from '../ar/geo';
import { SUGGESTIONS, t } from '../i18n/strings';
import { useApp, useLocation } from '../state/app';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { availabilityText, availabilityTone, fmtDate } from '../ui/bits';
import { Avatar, Btn, Icon, IconBtn, Label, Notice, Sheet, StatusPill, T } from '../ui/kit';
import { categoryColor, color, font } from '../ui/theme';

type Turn = { role: 'user'; text: string } | { role: 'assistant'; answer: Answer } | { role: 'error'; text: string };

export default function Assistant({ ask }: { ask?: string }) {
  const insets = useSafeAreaInsets();
  const { lang, setLang, user, online } = useApp();
  const loc = useLocation();
  const nav = useNav();
  const { push, replace, pop } = usePanels();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const rtl = lang === 'ar';

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setText('');
    setTurns(ts => [...ts, { role: 'user', text: question }]);
    setBusy(true);
    try {
      type H = { role: 'user' | 'assistant'; text: string };
      const history = turns.flatMap((tu): H[] => (tu.role === 'user' ? [{ role: 'user', text: tu.text }] : tu.role === 'assistant' ? [{ role: 'assistant', text: tu.answer.text }] : []));
      const answer = await api.ask(question, lang, loc.reason === 'off-campus' ? null : loc.coord, history);
      setTurns(ts => [...ts, { role: 'assistant', answer }]);
      if (voiceReplies && answer.text && !(answer.intent === 'place' && answer.action?.type === 'route')) { Speech.stop(); Speech.speak(answer.text, { language: lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar' : 'en-US' }); }
      // a place: the directions are already open, no second tap
      if (answer.intent === 'place' && answer.action?.type === 'route' && answer.place) {
        const a = answer.action;
        const ready = await nav.preview({ placeId: answer.place.id, name: answer.place.name, coordinates: answer.place.coordinates, category: answer.place.category }, a.mode === 'step_free' ? 'step_free' : 'walk');
        if (a.mode === 'ar' && ready) { nav.start(); replace({ name: 'go' }); router.push('/ar'); }
        else { if (voiceReplies && answer.text) Speech.speak(answer.text, { language: lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar' : 'en-US' }); replace({ name: 'route', said: question, reply: answer.text }); }
      }
      if (answer.intent === 'help') push({ name: 'help', step: 0 });
    } catch (e) {
      setTurns(ts => [...ts, { role: 'error', text: e instanceof ApiError && e.status === 0 ? 'No connection. Asking GoMap needs the internet; the map still works.' : e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
    }
  };
  useEffect(() => { if (ask) send(ask); }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <View style={[styles.head, rtl && { flexDirection: 'row-reverse' }]}>
      <Icon name="sparkle" size={20} stroke={color.blue} />
      <T weight="bold" style={{ flex: 1, fontSize: 17, textAlign: rtl ? 'right' : 'left' }}>{t(lang, 'assistantTitle')}</T>
      <IconBtn icon={voiceReplies ? 'bolt' : 'ban'} label={voiceReplies ? 'Mute assistant voice' : 'Enable assistant voice'} onPress={() => { if (voiceReplies) Speech.stop(); setVoiceReplies(!voiceReplies); }} float={false} bg={color.surface} size={34} />
      <View style={styles.langs} accessibilityRole="radiogroup" accessibilityLabel="Language">
        {(['en', 'fr', 'ar'] as Lang[]).map(l => (
          <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => setLang(l)} style={[styles.lang, lang === l && { backgroundColor: color.ink }]}>
            <T weight="bold" style={{ fontSize: 12, color: lang === l ? '#fff' : color.ink2 }}>{l === 'ar' ? 'ع' : l.toUpperCase()}</T>
          </Pressable>
        ))}
      </View>
      <IconBtn icon="close" label="Close the assistant" onPress={pop} float={false} bg={color.surface} size={34} />
    </View>
  );

  return (
    <Sheet snaps={[0.94]} onClose={pop} header={header}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }} keyboardVerticalOffset={60}>
        {lang !== 'en' && <View style={styles.review}><T weight="semibold" style={{ fontSize: 11.5, color: color.warnText }}>{t(lang, 'review')}</T></View>}
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
          {!turns.length && (
            <Animated.View entering={FadeIn.duration(240)} style={{ gap: 12 }}>
              <T style={{ fontSize: 14, color: color.muted, lineHeight: 20, textAlign: rtl ? 'right' : 'left' }}>{t(lang, 'assistantHint')}</T>
              <Label>{t(lang, 'try')}</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(user.role === 'guest' ? ['Where can I park?', 'Where is the Main Auditorium?', 'Where can I eat?'] : SUGGESTIONS[lang]).map(s => (
                  <Pressable key={s} accessibilityRole="button" onPress={() => send(s)} style={styles.suggestion}><T weight="medium" style={{ fontSize: 13.5 }}>{s}</T></Pressable>
                ))}
              </View>
            </Animated.View>
          )}
          {turns.map((tu, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(280)} layout={LinearTransition}>
              {tu.role === 'user' ? (
                <View style={[styles.bubble, rtl ? { alignSelf: 'flex-start' } : { alignSelf: 'flex-end' }]}><T style={{ color: '#fff', fontSize: 14.5 }}>{tu.text}</T></View>
              ) : tu.role === 'error' ? <Notice tone="missing" icon="wifiOff" text={tu.text} /> : <AnswerCard a={tu.answer} onAsk={send} />}
            </Animated.View>
          ))}
          {busy && <View style={styles.typing} accessibilityLabel={t(lang, 'thinking')}><TypingDots /></View>}
        </ScrollView>
        <View style={[styles.composer, { paddingBottom: Math.max(10, insets.bottom ? 4 : 10) }, rtl && { flexDirection: 'row-reverse' }]}>
          <TextInput value={text} onChangeText={setText} onSubmitEditing={() => send(text)} placeholder={t(lang, 'typeHere')} placeholderTextColor={color.muted}
            style={[styles.input, { textAlign: rtl ? 'right' : 'left', fontFamily: rtl ? font.arabic : font.regular }]} returnKeyType="send" editable={online} accessibilityLabel={t(lang, 'typeHere')} />
          {text.trim() ? <IconBtn icon="send" label="Send" onPress={() => send(text)} size={44} bg={color.blue} stroke="#fff" float={false} />
            : <IconBtn icon="mic" label="Ask by voice" onPress={() => push({ name: 'voice' })} size={44} bg={color.ink} stroke="#fff" float={false} />}
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

function TypingDots() {
  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      {[0, 1, 2].map(i => <Animated.View key={i} entering={FadeIn.delay(i * 120)} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.muted, opacity: 0.6 }} />)}
    </View>
  );
}

/** One card per intent: place, person, procedure, help, unknown (boards 13–15). */
export function AnswerCard({ a, onAsk }: { a: Answer; onAsk: (q: string) => void }) {
  const { push } = usePanels();
  const nav = useNav();
  const { lang } = useApp();
  const guide = async (placeId: string, name: string, coordinates: [number, number], category?: string) => {
    await nav.preview({ placeId, name, coordinates, category });
    push({ name: 'route' });
  };
  return (
    <View style={styles.card}>
      <T style={{ fontSize: 15, lineHeight: 22 }}>{a.text}</T>

      {a.intent === 'procedure' && a.procedure && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {a.procedure.steps.map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 11 }}>
              <View style={styles.stepNum}><T weight="bold" style={{ color: '#fff', fontSize: 12 }}>{i + 1}</T></View>
              <View style={{ flex: 1 }}>
                <T weight="semibold" style={{ fontSize: 14 }}>{s.title}</T>
                <T style={{ fontSize: 13, color: color.muted, lineHeight: 18, marginTop: 1 }}>{s.body}</T>
              </View>
            </View>
          ))}
        </View>
      )}

      {a.place && a.intent !== 'place' && (
        <View style={styles.where}>
          <Label>Where this happens</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <View style={[styles.dot, { backgroundColor: categoryColor(a.place.category) }]}><Icon name="building" size={16} stroke="#fff" /></View>
            <View style={{ flex: 1 }}>
              <T weight="semibold" style={{ fontSize: 14.5 }}>{a.procedure?.owner_office ?? a.place.name}</T>
              <T style={{ fontSize: 12.5, color: color.muted }}>{[a.place.name, a.place.hours ?? 'hours not published', a.route ? `${fmtMinutes(a.route.duration_s)} walk` : null].filter(Boolean).join(' · ')}</T>
            </View>
          </View>
          {a.contact?.email && <Pressable onPress={() => Linking.openURL(`mailto:${a.contact!.email}`)} style={{ marginTop: 8 }}><T style={{ fontSize: 13 }}>More information: <T weight="semibold" style={{ color: color.blue }}>{a.contact.email}</T></T></Pressable>}
          {a.action?.type === 'route' && <Btn title={t(lang, 'guideMe')} icon="walk" small onPress={() => guide(a.place!.id, a.place!.name, a.place!.coordinates, a.place!.category)} style={{ marginTop: 10 }} />}
        </View>
      )}
      {a.intent === 'place' && a.place?.status === 'closed' && <Notice tone="missing" icon="ban" text={`${a.place.name} is closed${a.place.closed_reason ? `: ${a.place.closed_reason}` : ''}. Routes avoid it.`} />}

      {a.intent === 'person' && a.person && (
        <Pressable accessibilityRole="button" onPress={() => push({ name: 'person', id: a.person!.id })} style={styles.where}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={a.person.name} tone={availabilityTone(a.person.availability)} />
            <View style={{ flex: 1 }}>
              <T weight="semibold" style={{ fontSize: 14.5 }}>{a.person.name}</T>
              <T style={{ fontSize: 12.5, color: color.muted }}>{a.person.place ? `${a.person.place.name}${a.person.office_number ? `, office ${a.person.office_number}` : ''}` : 'Office not published'}</T>
            </View>
            <Icon name="chevron" size={16} stroke={color.muted} />
          </View>
          <StatusPill tone={availabilityTone(a.person.availability)} text={availabilityText(a.person.availability)} style={{ marginTop: 10 }} />
        </Pressable>
      )}

      {a.unverified && <Notice text={t(lang, 'unverified')} />}
      {a.source && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Icon name="shield" size={13} stroke={color.muted} />
          <T style={{ flex: 1, fontSize: 11.5, color: color.muted }}>{a.source}{a.verified_at ? ` · ${t(lang, 'verified')} ${fmtDate(a.verified_at)}` : ''}{a.answered_by === 'gemini' ? ' · answered with Gemini' : ''}</T>
        </View>
      )}
      {!!a.suggestions?.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {a.suggestions.map(s => <Pressable key={s} accessibilityRole="button" onPress={() => onAsk(s)} style={styles.suggestion}><T weight="medium" style={{ fontSize: 13 }}>{s}</T></Pressable>)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: color.hairline },
  langs: { flexDirection: 'row', backgroundColor: color.surface, borderRadius: 10, padding: 3, gap: 2 },
  lang: { minWidth: 34, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  review: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: color.warnBg },
  suggestion: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#E2E3DE', backgroundColor: '#fff' },
  bubble: { maxWidth: '84%', backgroundColor: color.blue, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 6 },
  typing: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: color.surface },
  card: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: color.page, borderWidth: 1, borderColor: color.hairline },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  where: { padding: 12, borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: color.hairline },
  dot: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: color.hairline, backgroundColor: '#fff' },
  input: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: color.surface2, fontSize: 15, color: color.ink },
});

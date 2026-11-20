import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { openAR } from '../ar/open';
import { api, ApiError } from '../api/client';
import type { Answer, Lang } from '../api/types';
import { fmtMinutesT } from '../ar/geo';
import { SUGGESTIONS } from '../i18n/strings';
import { formatHours, useLang, useT } from '../i18n';
import { useApp, useLocation } from '../state/app';
import { chat, useChat } from '../state/chat';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { whenText } from './Events';
import { availabilityText, availabilityTone, fmtDate } from '../ui/bits';
import { Avatar, Btn, Icon, IconBtn, Label, Notice, Sheet, StatusPill, T } from '../ui/kit';
import { categoryColor, color, font } from '../ui/theme';
import { speak, stopSpeaking, useSpeaking } from '../voice/speak';
import { StickyNote } from '../ui/StickyNote';
import { dayName } from '../i18n';

/** "where is…", "take me to…": the student wants to go there, so directions open by themselves. */
const GO = /\b(where|take me|bring me|guide me|directions?|way to|navigate|go to|get to)\b|ou est|emm[eè]ne|وين|أين|خذني|فين/i;

export default function Assistant({ ask }: { ask?: string }) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const { lang, setLang, user, online } = useApp();
  const loc = useLocation();
  const nav = useNav();
  const { push, replace, pop, top } = usePanels();
  const { turns, talk, voice, pending } = useChat();
  const t = useT();
  const speaking = useSpeaking();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const topRef = useRef(top);
  topRef.current = top;
  const rtl = lang === 'ar';

  /** Say it, and in hands-free mode listen again once GoMap has finished talking. */
  const say = (answerText: string, listenAfter: boolean) => {
    if (!chat.get().voice) { if (listenAfter && chat.get().talk) push({ name: 'voice', auto: true }); return; }
    speak(answerText, lang, { onDone: () => { if (listenAfter && chat.get().talk && topRef.current.name === 'assistant') push({ name: 'voice', auto: true }); } });
  };

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    stopSpeaking();
    setText('');
    Keyboard.dismiss();
    const history = chat.history();
    chat.add({ role: 'user', text: question });
    setBusy(true);
    try {
      const answer = await api.ask(question, lang, loc.reason === 'off-campus' ? null : loc.coord, history);
      chat.add({ role: 'assistant', answer });
      const target = answer.place;
      const wantsToGo = answer.action?.type === 'route' && target && (answer.intent === 'place' || (answer.intent === 'service' && GO.test(question)));
      if (wantsToGo) {
        // leaving the chat for directions: the conversation stays here for when they come back
        const a = answer.action as Extract<Answer['action'], { type: 'route' }>;
        const ready = await nav.preview({ placeId: target.id, name: target.name, coordinates: target.coordinates, category: target.category }, a.mode === 'step_free' ? 'step_free' : 'walk');
        if (a.mode === 'ar' && ready) { nav.start(); replace({ name: 'go' }); openAR(); }
        else { say(answer.text, false); push({ name: 'route', said: question, reply: answer.text }); }
      } else {
        say(answer.alert?.tone === 'urgent' ? `${answer.alert.text} ${answer.text}` : answer.text, true);
      }
      if (answer.intent === 'help') push({ name: 'help', step: 0 });
    } catch (e) {
      chat.add({ role: 'error', text: e instanceof ApiError && e.status === 0 ? t('No connection. Asking GoMap needs the internet; the map still works.') : e instanceof Error ? e.message : t('Something went wrong.') });
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
    }
  };
  useEffect(() => { if (ask) send(ask); }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  // a question spoken on the voice screen
  useEffect(() => { if (pending && top.name === 'assistant') { const p = chat.takePending(); if (p) send(p); } }, [pending, top.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopSpeaking(), []);

  const header = (
    <View style={styles.head}>
      <Icon name="sparkle" size={20} stroke={color.blue} />
      <T weight="bold" style={{ flex: 1, fontSize: 17 }}>{t("Ask GoMap")}</T>
      <IconBtn icon={voice ? 'volume' : 'mute'} label={voice ? t('Mute GoMap’s voice') : t('Let GoMap answer out loud')} onPress={() => { if (voice) stopSpeaking(); chat.setVoice(!voice); }} float={false} bg={voice ? '#EEF4FF' : color.surface} stroke={voice ? color.blue : color.ink} size={34} />
      <View style={styles.langs} accessibilityRole="radiogroup" accessibilityLabel={t("Language")}>
        {(['en', 'fr', 'ar'] as Lang[]).map(l => (
          <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => setLang(l)} style={[styles.lang, lang === l && { backgroundColor: color.ink }]}>
            <T weight="bold" style={{ fontSize: 12, color: lang === l ? '#fff' : color.ink2, textAlign: 'center' }}>{l === 'ar' ? 'ع' : l.toUpperCase()}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );

  // tap the dimmed map above (or swipe down) to put the chat away; the conversation is kept
  return (
    <Sheet snaps={[0.88]} scrim onClose={() => { stopSpeaking(); chat.setTalk(false); pop(); }} header={header}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 60 + Math.round(screenH * 0.06) : 0}>
                <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 20 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {!turns.length && (
            <Animated.View entering={FadeIn.duration(240)} style={{ gap: 12 }}>
              <T style={{ fontSize: 14, color: color.muted, lineHeight: 20 }}>{t("Places, people, offices and procedures at AUI. I name my source every time.")}</T>
              <Label>{t("Try")}</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(user.role === 'guest' ? [t('Where can I park?'), t('Where is the Main Auditorium?'), t('Where can I eat?'), t('Where is Admissions?')] : SUGGESTIONS[lang]).map(s => (
                  <Pressable key={s} accessibilityRole="button" onPress={() => send(s)} style={styles.suggestion}><T weight="medium" style={{ fontSize: 13.5 }}>{s}</T></Pressable>
                ))}
              </View>
            </Animated.View>
          )}
          {turns.map((tu, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(280)} layout={LinearTransition}>
              {tu.role === 'user' ? (
                <View style={[styles.bubble, { alignSelf: 'flex-end' }]}><T style={{ color: '#fff', fontSize: 14.5 }}>{tu.text}</T></View>
              ) : tu.role === 'error' ? <Notice tone="missing" icon="wifiOff" text={tu.text} /> : <AnswerCard a={tu.answer} onAsk={send} onReplay={() => speak(tu.answer.text, lang)} />}
            </Animated.View>
          ))}
          {busy && <View style={styles.typing} accessibilityLabel={t("Thinking")}><TypingDots /></View>}
        </ScrollView>
        {speaking && (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Stop GoMap talking')} onPress={stopSpeaking} style={styles.speaking}>
            <SpeakingBars />
            <T weight="semibold" style={{ fontSize: 12.5, color: color.blue, flex: 1 }}>{t('GoMap is answering · tap to stop')}</T>
          </Pressable>
        )}
        <View style={[styles.composer, { paddingBottom: Math.max(10, insets.bottom) }]}>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: talk }} accessibilityLabel={t('Hands-free conversation')}
            onPress={() => chat.setTalk(!talk)} style={[styles.talk, talk && { backgroundColor: color.ink }]}>
            <Icon name="sparkle" size={15} stroke={talk ? '#fff' : color.ink2} />
            <T weight="semibold" style={{ fontSize: 11.5, color: talk ? '#fff' : color.ink2, textAlign: 'center' }}>{t('Talk')}</T>
          </Pressable>
          <TextInput value={text} onChangeText={setText} onSubmitEditing={() => send(text)} placeholder={online ? t("Type a question") : t('Offline · the map still works')} placeholderTextColor={color.muted}
            style={[styles.input, { textAlign: rtl ? 'right' : 'left', fontFamily: rtl ? font.arabic : font.regular }]} returnKeyType="send" editable={online} accessibilityLabel={t("Type a question")}
            multiline={false} blurOnSubmit={false} />
          {text.trim() ? <IconBtn icon="send" label={t('Send')} onPress={() => send(text)} size={44} bg={color.blue} stroke="#fff" float={false} />
            : <IconBtn icon="mic" label={t('Ask by voice')} onPress={() => { Keyboard.dismiss(); stopSpeaking(); push({ name: 'voice', auto: talk }); }} size={44} bg={color.ink} stroke="#fff" float={false} />}
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

/** Three small bars that bounce while GoMap talks. */
function SpeakingBars() {
  const [t, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT(x => x + 1), 120); return () => clearInterval(id); }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 16 }}>
      {[0, 1, 2, 3].map(i => <View key={i} style={{ width: 3, borderRadius: 2, backgroundColor: color.blue, height: 5 + 10 * Math.abs(Math.sin(t * 0.8 + i * 1.3)) }} />)}
    </View>
  );
}


/** One card per intent: place, person, procedure, office/service, help, unknown (boards 13–15). */
export function AnswerCard({ a, onAsk, onReplay }: { a: Answer; onAsk: (q: string) => void; onReplay?: () => void }) {
  const { push } = usePanels();
  const nav = useNav();
  const lang = useLang();
  const t = useT();
  const guide = async (placeId: string, name: string, coordinates: [number, number], category?: string) => {
    await nav.preview({ placeId, name, coordinates, category });
    push({ name: 'route' });
  };
  const s = a.service;
  return (
    <View style={styles.card}>
      {a.alert && (
        <View style={[styles.alert, a.alert.tone === 'urgent' ? { backgroundColor: '#FDECEC', borderColor: '#F5C2C0' } : null]}>
          <Icon name={a.alert.tone === 'urgent' ? 'warn' : 'ban'} size={18} stroke={a.alert.tone === 'urgent' ? color.danger : color.warnText} />
          <T weight="semibold" style={{ flex: 1, fontSize: 13.5, color: a.alert.tone === 'urgent' ? color.danger : color.warnText }}>{a.alert.text}</T>
          {a.alert.tone === 'urgent' && <Btn title={t('Call')} icon="phone" small kind="dark" onPress={() => Linking.openURL('tel:+212535862222')} />}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <T style={{ flex: 1, fontSize: 15, lineHeight: 22 }}>{a.text}</T>
        {onReplay && !!a.text && <Pressable accessibilityRole="button" accessibilityLabel={t('Read this answer aloud')} onPress={onReplay} hitSlop={8} style={{ paddingTop: 2 }}><Icon name="volume" size={16} stroke={color.muted} /></Pressable>}
      </View>

      {a.intent === 'events' && !!a.events?.length && (
        <View style={{ gap: 8, marginTop: 4 }}>
          {a.events.slice(0, 4).map(e => (
            <Pressable key={e.id} accessibilityRole="button" onPress={() => push({ name: 'events', id: e.id })} style={({ pressed }) => [styles.eventRow, pressed && { opacity: 0.8 }]}>
              <View style={styles.eventDot}><Icon name="events" size={14} stroke="#fff" /></View>
              <View style={{ flex: 1 }}>
                <T weight="semibold" numberOfLines={1} style={{ fontSize: 14 }}>{e.title}</T>
                <T numberOfLines={1} style={{ fontSize: 12, color: color.muted }}>{whenText(e, lang, t)}{e.place ? ` · ${e.place.name}` : ''}</T>
              </View>
              <Icon name="chevron" size={14} stroke={color.muted} />
            </Pressable>
          ))}
          <Btn title={t('All events')} icon="events" small kind="secondary" onPress={() => push({ name: 'events' })} />
        </View>
      )}

      {a.intent === 'procedure' && a.procedure && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {a.procedure.steps.map((st, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 11 }}>
              <View style={styles.stepNum}><T weight="bold" style={{ color: '#fff', fontSize: 12 }}>{i + 1}</T></View>
              <View style={{ flex: 1 }}>
                <T weight="semibold" style={{ fontSize: 14 }}>{st.title}</T>
                <T style={{ fontSize: 13, color: color.muted, lineHeight: 18, marginTop: 1 }}>{st.body}</T>
              </View>
            </View>
          ))}
        </View>
      )}

      {s && (
        <View style={styles.where}>
          {a.issue && <T style={{ fontSize: 12, color: color.muted, marginBottom: 6 }}>{t('For: {issue}', { issue: a.issue.issue })}</T>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[styles.dot, { backgroundColor: color.blue }]}><Icon name="building" size={16} stroke="#fff" /></View>
            <View style={{ flex: 1 }}>
              <T weight="semibold" style={{ fontSize: 14.5 }}>{s.name}</T>
              <T style={{ fontSize: 12.5, color: color.muted }}>{[s.location_text, a.route ? t('{time} walk', { time: fmtMinutesT(a.route.duration_s, t) }) : null].filter(Boolean).join(' · ')}</T>
            </View>
            <StatusPill tone={s.open.state === 'open' ? 'open' : s.open.state === 'closed' ? 'closed' : 'missing'}
              text={s.open.state === 'open' ? (s.open.until === '23:59' ? t('Open 24/7') : t('Open · until {time}', { time: s.open.until })) : s.open.state === 'closed' ? (s.open.next ? t('Opens {day} {time}', { day: dayName(s.open.next.day, lang), time: s.open.next.time }) : t('Closed')) : t('Hours?')} />
          </View>
          {s.hours && s.hours_text !== 'Open 24/7' && <T style={{ fontSize: 12.5, color: color.ink2, marginTop: 8 }}>{formatHours(s.hours, lang, t)}</T>}
          {!!s.handles.length && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {s.handles.slice(0, 4).map(h => <View key={h} style={styles.handle}><T style={{ fontSize: 11.5, color: color.ink2 }}>{h}</T></View>)}
            </View>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {a.action?.type === 'route' && a.place && <Btn title={t("Guide me there")} icon="walk" small onPress={() => guide(a.place!.id, a.place!.name, a.place!.coordinates, a.place!.category)} />}
            {s.phone && <Btn title={s.extension ? t('Ext. {n}', { n: s.extension }) : t('Call')} icon="phone" small kind="secondary" onPress={() => Linking.openURL(`tel:${s.phone!.replace(/[^\d+]/g, '')}`)} />}
            {s.email && <Btn title={t('Email')} icon="mail" small kind="secondary" onPress={() => Linking.openURL(`mailto:${s.email!.split(/[ /,]/)[0]}`)} />}
          </View>
        </View>
      )}

      {a.place && !s && a.intent !== 'place' && (
        <View style={styles.where}>
          <Label>{t('Where this happens')}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <View style={[styles.dot, { backgroundColor: categoryColor(a.place.category) }]}><Icon name="building" size={16} stroke="#fff" /></View>
            <View style={{ flex: 1 }}>
              <T weight="semibold" style={{ fontSize: 14.5 }}>{a.procedure?.owner_office ?? a.place.name}</T>
              <T style={{ fontSize: 12.5, color: color.muted }}>{[a.place.name, a.place.hours ? null : t('hours not published'), a.route ? t('{time} walk', { time: fmtMinutesT(a.route.duration_s, t) }) : null].filter(Boolean).join(' · ')}</T>
            </View>
          </View>
          {a.contact?.email && <Pressable onPress={() => Linking.openURL(`mailto:${a.contact!.email}`)} style={{ marginTop: 8 }}><T style={{ fontSize: 13 }}>{t('More information:')} <T weight="semibold" style={{ color: color.blue }}>{a.contact.email}</T></T></Pressable>}
          {a.action?.type === 'route' && <Btn title={t("Guide me there")} icon="walk" small onPress={() => guide(a.place!.id, a.place!.name, a.place!.coordinates, a.place!.category)} style={{ marginTop: 10 }} />}
        </View>
      )}
      {a.intent === 'place' && a.place?.status === 'closed' && <Notice tone="missing" icon="ban" text={t('{place} is closed{reason}. Routes avoid it.', { place: a.place.name, reason: a.place.closed_reason ? `: ${a.place.closed_reason}` : '' })} />}
      {a.intent === 'place' && a.place && a.place.status !== 'closed' && !a.action && (
        <Btn title={t("Guide me there")} icon="walk" small kind="secondary" onPress={() => guide(a.place!.id, a.place!.name, a.place!.coordinates, a.place!.category)} style={{ alignSelf: 'flex-start' }} />
      )}

      {a.intent === 'person' && a.person && (
        <Pressable accessibilityRole="button" onPress={() => push({ name: 'person', id: a.person!.id })} style={styles.where}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={a.person.name} tone={availabilityTone(a.person.availability)} />
            <View style={{ flex: 1 }}>
              <T weight="semibold" style={{ fontSize: 14.5 }}>{a.person.name}</T>
              <T style={{ fontSize: 12.5, color: color.muted }}>{a.person.place ? `${a.person.place.name}${a.person.office_number ? `, ${t('office {n}', { n: a.person.office_number })}` : ''}` : t('Office not published')}</T>
            </View>
            <Icon name="chevron" size={16} stroke={color.muted} />
          </View>
          <StatusPill tone={availabilityTone(a.person.availability)} text={availabilityText(a.person.availability, t, lang, a.person.presence?.until)} style={{ marginTop: 10 }} />
          {(a.person.note || a.person.note_kind) && <View style={{ marginTop: 10 }}><StickyNote small kind={a.person.note_kind} text={a.person.note} /></View>}
        </Pressable>
      )}

      {a.unverified && <Notice text={t("Not yet verified — check with the office")} />}
      {a.source && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Icon name="shield" size={13} stroke={color.muted} />
          <T style={{ flex: 1, fontSize: 11.5, color: color.muted }}>{a.source}{a.verified_at ? ` · ${t("verified")} ${fmtDate(a.verified_at, lang)}` : ''}{a.answered_by === 'gemini' ? ` · ${t('answered with Gemini')}` : a.answered_by === 'claude' ? ` · ${t('answered with Claude')}` : ''}</T>
        </View>
      )}
      {!!a.suggestions?.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {a.suggestions.map(q => <Pressable key={q} accessibilityRole="button" onPress={() => onAsk(q)} style={styles.suggestion}><T weight="medium" style={{ fontSize: 13 }}>{q}</T></Pressable>)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: '#FDF4FF', borderWidth: 1, borderColor: '#F5D0FE' },
  eventDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#C026D3', alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: color.hairline },
  langs: { flexDirection: 'row', backgroundColor: color.surface, borderRadius: 10, padding: 3, gap: 2 },
  lang: { minWidth: 34, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  review: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: color.warnBg },
  suggestion: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#E2E3DE', backgroundColor: '#fff' },
  bubble: { maxWidth: '84%', backgroundColor: color.blue, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 6 },
  typing: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: color.surface },
  card: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: color.page, borderWidth: 1, borderColor: color.hairline },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: color.warnBg, borderWidth: 1, borderColor: color.warnLine },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  where: { padding: 12, borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: color.hairline },
  handle: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: color.surface },
  dot: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  speaking: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#EEF4FF' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: color.hairline, backgroundColor: '#fff' },
  talk: { height: 44, paddingHorizontal: 10, borderRadius: 22, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', gap: 1 },
  input: { flex: 1, minWidth: 0, height: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: color.surface2, fontSize: 15, color: color.ink },
});

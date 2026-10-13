import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { api, API_URL, type Place, type Service } from './src/api';

type Screen = 'home' | 'map' | 'search' | 'help' | 'saved' | 'report';
const green = '#138c67', dark = '#152b29';
const colors: Record<string, string> = { 'Dining Services': '#db686b', Residential: '#dc8500', Facilities: '#6c7a8c', 'Campus Services': '#119d97', Academic: '#3269d5', Administrative: '#6650dd', 'Athletics & Recreation': '#1da853' };
const categories = ['All', ...Object.keys(colors)];
const issues = ['Wrong pin', 'Office moved', 'Outdated hours', 'Blocked walkway', 'Other'];
const campus: Region = { latitude: 33.5396, longitude: -5.1059, latitudeDelta: 0.008, longitudeDelta: 0.008 };

function Button({ title, onPress, secondary = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && { opacity: 0.5 }]}><Text style={[styles.buttonText, secondary && { color: green }]}>{title}</Text></Pressable>;
}
function PlaceRow({ place, onPress }: { place: Place; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}><View style={[styles.rowIcon, { backgroundColor: colors[place.category] || green }]}><Text style={styles.rowIconText}>⌖</Text></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{place.name}</Text><Text style={styles.sub}>{place.category} · Sample pin</Text></View><Text style={styles.chevron}>›</Text></Pressable>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [places, setPlaces] = useState<Place[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issue, setIssue] = useState(issues[0]);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const map = useRef<MapView>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const [p, s] = await Promise.all([api.places(), api.services()]); setPlaces(p); setServices(s); }
    catch { setError(`Could not reach the GoMap API at ${API_URL}. Check the server and phone network.`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (screen !== 'search' || !query.trim()) return;
    let active = true;
    setSearchResults([]);
    const timer = setTimeout(() => { api.search(query.trim()).then(result => { if (active) setSearchResults(result); }).catch(() => { if (active) setSearchResults([]); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [screen, query]);
  const filtered = useMemo(() => places.filter(p => (category === 'All' || p.category === category) && (!query.trim() || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(query.trim().toLowerCase()))), [places, category, query]);
  const go = (next: Screen) => { setScreen(next); setSelected(null); setService(null); if (next === 'search') setQuery(''); };
  const openPlace = (p: Place) => {
    setSelected(p); setService(null); setScreen('map');
    setTimeout(() => map.current?.animateToRegion({ latitude: p.latitude, longitude: p.longitude, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 400), 150);
  };
  const openService = (s: Service) => {
    const p = places.find(item => item.id === s.destinationId);
    if (p) { openPlace(p); setService(s); }
  };
  const submit = async () => {
    if (!selected || !details.trim()) { Alert.alert('Add details', 'Tell us what should be checked.'); return; }
    setSending(true);
    try { const report = await api.report(selected.id, issue, details.trim()); Alert.alert('Report saved', `Report #${report.id} is stored for review. It does not change the published map.`); setDetails(''); setScreen('map'); }
    catch (e) { Alert.alert('Could not submit', e instanceof Error ? e.message : 'Try again.'); }
    finally { setSending(false); }
  };
  const header = (title: string) => <View style={styles.header}><Text style={styles.brand}>⌘</Text><Text style={styles.headerTitle}>{title}</Text><Pressable accessibilityLabel="Open campus map" onPress={() => go('map')}><Text style={styles.brand}>◈</Text></Pressable></View>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle={screen === 'map' ? 'light-content' : 'dark-content'} />
    {screen === 'home' && <ScrollView style={styles.page}>{header('Home')}<View style={styles.hero}><Text style={styles.heroSmall}>Good day,</Text><Text style={styles.heroTitle}>Welcome to GoCampus</Text><Text style={styles.heroSmall}>Your campus companion</Text></View><View style={styles.content}>
      <View style={styles.quickGrid}>{([['◈', 'Campus Map', 'map'], ['⌕', 'Search', 'search'], ['✦', 'Find Help', 'help']] as const).map(([icon, label, target]) => <Pressable key={target} onPress={() => go(target)} style={styles.quick}><Text style={styles.quickIcon}>{icon}</Text><Text style={styles.quickText}>{label}</Text></Pressable>)}</View>
      <Text style={styles.section}>Quick Access</Text><Text style={styles.muted}>Find a destination or the right service</Text><Button title="What do you need help with?" onPress={() => go('help')} />
      <Text style={styles.section}>Popular destinations</Text><Text style={styles.muted}>Curated examples; not search analytics</Text>
      {places.filter(p => ['financial-aid', 'm6-library', 'academic-building'].includes(p.id)).map(p => <PlaceRow key={p.id} place={p} onPress={() => openPlace(p)} />)}
    </View></ScrollView>}

    {screen === 'map' && <View style={styles.mapWrap}><MapView ref={map} style={StyleSheet.absoluteFill} initialRegion={campus} showsCompass>
      {filtered.map(p => <Marker key={p.id} coordinate={{ latitude: p.latitude, longitude: p.longitude }} title={p.name} description="Sample pin · pending verification" pinColor={colors[p.category]} onPress={() => { setSelected(p); setService(null); }} />)}
    </MapView><View style={styles.mapTop}><Pressable onPress={() => go('home')} style={styles.circle}><Text style={styles.circleText}>‹</Text></Pressable><Pressable onPress={() => go('search')} style={styles.mapSearch}><Text style={styles.mapSearchText}>⌕  Search campus</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>{categories.map(c => <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && { backgroundColor: green }]}><Text style={[styles.chipText, category === c && { color: '#fff' }]}>{c}</Text></Pressable>)}</ScrollView>
    {!selected && <View style={styles.mapBottom}><Text style={styles.sample}>Sample pins · confirm before visiting</Text><View style={styles.inline}><Pressable onPress={() => go('help')} style={styles.mapAction}><Text style={styles.mapActionText}>⌖  Find help</Text></Pressable><Pressable onPress={() => go('search')} style={styles.mapAction}><Text style={styles.mapActionText}>⌕  Search</Text></Pressable></View></View>}
    {selected && <View style={styles.sheet}><View style={styles.handle} /><Pressable onPress={() => { setSelected(null); setService(null); }} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable><Text style={styles.badge}>{selected.category}</Text><Text style={styles.sheetTitle}>{selected.name}</Text><Text style={styles.body}>{selected.description}</Text>
      {service && <View style={styles.notice}><Text style={styles.noticeTitle}>{service.title}</Text><Text style={styles.noticeText}>{service.note}</Text></View>}
      <Text style={styles.meta}>◷  {selected.hours || 'Hours awaiting verification'}</Text><Text style={styles.meta}>⌖  {selected.entrance || 'Sample pin · entrance to be confirmed'}</Text>
      <View style={styles.notice}><Text style={styles.noticeText}>Walking directions will be enabled after entrances and paths are checked on campus.</Text></View>
      <View style={styles.inline}><Button title={saved.includes(selected.id) ? '★ Saved' : '☆ Save'} secondary onPress={() => setSaved(current => current.includes(selected.id) ? current.filter(id => id !== selected.id) : [...current, selected.id])} /><Button title="Report an issue" secondary onPress={() => { setIssue(issues[0]); setDetails(''); setScreen('report'); }} /></View>
    </View>}</View>}

    {screen === 'search' && <View style={styles.page}>{header('Search')}<View style={styles.content}><Text style={styles.screenTitle}>Where are you going?</Text><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Building, service, office…" placeholderTextColor="#82918d" style={styles.input} accessibilityLabel="Search campus" /><Text style={styles.label}>{query ? 'SEARCH RESULTS' : 'QUICK DESTINATIONS'}</Text></View>
      <FlatList data={query ? searchResults : places.filter(p => ['financial-aid', 'm6-library', 'academic-building', 'it-service-desk'].includes(p.id))} keyExtractor={p => p.id} renderItem={({ item }) => <PlaceRow place={item} onPress={() => openPlace(item)} />} ListEmptyComponent={<Text style={styles.empty}>No matching destination. Try a service name or another spelling.</Text>} />
      <View style={styles.content}><Button title="Find a service by need" secondary onPress={() => go('help')} /></View></View>}

    {screen === 'help' && <ScrollView style={styles.page}>{header('Find help')}<View style={styles.content}><Text style={styles.screenTitle}>What problem do you have?</Text><Text style={styles.muted}>Choose a request to see its suggested contact and map location.</Text><Text style={styles.label}>CAMPUS SERVICES</Text>
      {services.map(s => <Pressable key={s.id} onPress={() => openService(s)} style={styles.service}><Text style={styles.serviceIcon}>✦</Text><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{s.title}</Text><Text style={styles.sub}>{s.description}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}
      <View style={styles.notice}><Text style={styles.noticeText}>These matches are suggestions from sample records. AUI staff need to confirm the offices and processes.</Text></View>
    </View></ScrollView>}

    {screen === 'saved' && <View style={styles.page}>{header('Saved places')}<View style={styles.content}><Text style={styles.screenTitle}>Saved places</Text><Text style={styles.muted}>Shortcuts saved for this app session</Text></View><FlatList data={places.filter(p => saved.includes(p.id))} keyExtractor={p => p.id} renderItem={({ item }) => <PlaceRow place={item} onPress={() => openPlace(item)} />} ListEmptyComponent={<Text style={styles.empty}>No saved places yet. Open a destination and tap Save.</Text>} /></View>}

    {screen === 'report' && selected && <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled">{header('Report an issue')}<View style={styles.content}><Pressable onPress={() => setScreen('map')}><Text style={styles.back}>‹  Back to destination</Text></Pressable><Text style={styles.screenTitle}>Report an issue</Text><Text style={styles.muted}>{selected.name}</Text><Text style={styles.label}>WHAT NEEDS UPDATING?</Text>
      {issues.map(option => <Pressable key={option} onPress={() => setIssue(option)} style={[styles.issue, option === issue && { borderColor: green, backgroundColor: '#eff8f3' }]}><Text style={styles.body}>{option === issue ? '◉' : '○'}  {option}</Text></Pressable>)}
      <Text style={styles.label}>DETAILS</Text><TextInput multiline value={details} onChangeText={setDetails} placeholder="Tell us what should be checked" placeholderTextColor="#82918d" style={[styles.input, styles.details]} accessibilityLabel="Issue details" />
      <Button title={sending ? 'Submitting…' : 'Submit report'} onPress={submit} disabled={sending} /><Text style={styles.muted}>Reports are stored locally for review. No map record changes automatically.</Text>
    </View></ScrollView></KeyboardAvoidingView>}

    {loading && <View style={styles.overlay}><ActivityIndicator size="large" color={green} /><Text style={styles.muted}>Loading campus information…</Text></View>}
    {!!error && <View style={styles.error}><Text style={styles.section}>Campus data unavailable</Text><Text style={styles.body}>{error}</Text><Button title="Retry" onPress={load} /></View>}
    {screen !== 'map' && screen !== 'report' && <View style={styles.nav}>{([['⌂', 'Home', 'home'], ['◈', 'GoMap', 'map'], ['✦', 'Help', 'help'], ['☆', 'Saved', 'saved']] as const).map(([icon, label, target]) => <Pressable key={target} onPress={() => go(target)} style={styles.navItem}><Text style={[styles.navIcon, screen === target && { color: green }]}>{icon}</Text><Text style={[styles.navLabel, screen === target && { color: green }]}>{label}</Text></Pressable>)}</View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7faf8', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }, page: { flex: 1, backgroundColor: '#f7faf8' },
  header: { height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, backgroundColor: '#fff', gap: 14, borderBottomWidth: 1, borderBottomColor: '#e6ece9' }, brand: { color: green, fontSize: 27, fontWeight: '700' }, headerTitle: { flex: 1, color: dark, fontSize: 20, fontWeight: '700' },
  hero: { backgroundColor: green, padding: 26, paddingTop: 35, paddingBottom: 49 }, heroSmall: { color: '#d9f6e8', fontSize: 15, marginTop: 4 }, heroTitle: { color: '#fff', fontSize: 27, fontWeight: '700', marginVertical: 5 }, content: { padding: 20 },
  quickGrid: { flexDirection: 'row', gap: 9, marginTop: -48, marginBottom: 22 }, quick: { flex: 1, height: 91, backgroundColor: '#fff', borderRadius: 14, alignItems: 'center', justifyContent: 'center', elevation: 3 }, quickIcon: { color: green, fontSize: 27 }, quickText: { color: dark, fontSize: 12, fontWeight: '700', marginTop: 4 },
  section: { color: dark, fontSize: 19, fontWeight: '700', marginTop: 15 }, screenTitle: { color: dark, fontSize: 24, fontWeight: '700', marginTop: 8, marginBottom: 9 }, muted: { color: '#6e807b', fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 14 }, body: { color: '#4c6259', fontSize: 14, lineHeight: 20, marginTop: 8 },
  button: { backgroundColor: green, borderRadius: 10, minHeight: 46, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, marginVertical: 5 }, secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#bdd9ce' }, buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: { backgroundColor: '#fff', marginVertical: 5, padding: 12, flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#e5ece8' }, rowIcon: { width: 43, height: 43, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 11 }, rowIconText: { color: '#fff', fontSize: 25 }, rowTitle: { color: dark, fontSize: 15, fontWeight: '700' }, sub: { color: '#73837d', fontSize: 12, marginTop: 3 }, chevron: { color: '#97a7a0', fontSize: 26, marginLeft: 8 },
  mapWrap: { flex: 1, backgroundColor: '#cbd7d0' }, mapTop: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', gap: 9 }, circle: { width: 46, height: 46, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 3 }, circleText: { fontSize: 31, color: dark }, mapSearch: { flex: 1, height: 46, borderRadius: 24, backgroundColor: '#fff', justifyContent: 'center', paddingHorizontal: 17, elevation: 3 }, mapSearchText: { color: '#596b64', fontSize: 15 },
  chipScroll: { position: 'absolute', top: 70, left: 0, right: 0, maxHeight: 45 }, chips: { paddingHorizontal: 14, gap: 7 }, chip: { backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, elevation: 2 }, chipText: { color: dark, fontSize: 12, fontWeight: '600' },
  mapBottom: { position: 'absolute', bottom: 20, left: 16, right: 16 }, sample: { alignSelf: 'center', overflow: 'hidden', backgroundColor: '#ffffffee', color: '#586b62', borderRadius: 8, padding: 6, fontSize: 11, marginBottom: 10 }, inline: { flexDirection: 'row', gap: 9 }, mapAction: { flex: 1, height: 48, backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center', alignItems: 'center', elevation: 3 }, mapActionText: { color: dark, fontWeight: '700' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 23, elevation: 8 }, handle: { width: 42, height: 4, backgroundColor: '#ced8d2', borderRadius: 4, alignSelf: 'center', marginBottom: 14 }, close: { position: 'absolute', top: 14, right: 18, zIndex: 1 }, closeText: { color: '#64766e', fontSize: 30 }, badge: { color: green, backgroundColor: '#e7f5ed', padding: 6, alignSelf: 'flex-start', borderRadius: 7, overflow: 'hidden', fontSize: 12, fontWeight: '700' }, sheetTitle: { color: dark, fontSize: 23, fontWeight: '700', marginTop: 10 }, meta: { color: '#657a70', fontSize: 13, marginTop: 9 },
  notice: { backgroundColor: '#f0f7f3', padding: 12, borderRadius: 10, marginTop: 13 }, noticeTitle: { color: dark, fontWeight: '700', marginBottom: 3 }, noticeText: { color: '#4d685b', fontSize: 12, lineHeight: 18 },
  input: { height: 50, backgroundColor: '#fff', borderColor: '#cddcd4', borderWidth: 1, borderRadius: 11, paddingHorizontal: 14, color: dark, fontSize: 15 }, label: { color: '#71877b', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 22, marginBottom: 9 }, empty: { color: '#697d73', margin: 25, lineHeight: 21 },
  service: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e3ede8', padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center' }, serviceIcon: { color: green, fontSize: 24, marginRight: 12 }, back: { color: green, fontWeight: '700', marginBottom: 15 }, issue: { backgroundColor: '#fff', padding: 11, borderRadius: 9, borderWidth: 1, borderColor: '#e2eae5', marginBottom: 6 }, details: { height: 116, textAlignVertical: 'top', paddingTop: 12, marginBottom: 11 },
  nav: { height: 62, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e9e5', flexDirection: 'row' }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' }, navIcon: { color: '#84948d', fontSize: 23 }, navLabel: { color: '#84948d', fontSize: 11, marginTop: 2 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: '#ffffffec', alignItems: 'center', justifyContent: 'center', zIndex: 10 }, error: { position: 'absolute', left: 20, right: 20, top: '27%', backgroundColor: '#fff', padding: 20, borderRadius: 13, elevation: 9, zIndex: 11 },
});

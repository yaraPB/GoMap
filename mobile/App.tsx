import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, API_URL, type Place } from './src/api';
import CampusMap from './src/CampusMap';

const filters = [
  { label: 'All', categories: null as string[] | null },
  { label: 'Academic', categories: ['Academic'] },
  { label: 'Services', categories: ['Campus Services', 'Administrative', 'Facilities'] },
  { label: 'Dining', categories: ['Dining Services'] },
  { label: 'Housing', categories: ['Residential'] },
];

export default function App() {
  return <SafeAreaProvider><GoMap /></SafeAreaProvider>;
}

function GoMap() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [selected, setSelected] = useState<Place | null>(null);
  const [focusPlaceId, setFocusPlaceId] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [tiltToken, setTiltToken] = useState(0);
  const [is3D, setIs3D] = useState(true);

  useEffect(() => {
    let active = true;
    api.places().then(data => { if (active) setPlaces(data); })
      .catch(() => { if (active) setError(`Could not reach the GoMap API at ${API_URL}.`); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visiblePlaces = useMemo(() => {
    const filter = filters.find(item => item.label === activeFilter);
    return filter?.categories ? places.filter(place => filter.categories?.includes(place.category)) : places;
  }, [activeFilter, places]);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return places.filter(place => `${place.name} ${place.category} ${place.description}`.toLocaleLowerCase().includes(needle)).slice(0, 5);
  }, [places, query]);

  const choosePlace = (place: Place) => {
    setSelected(place);
    setFocusPlaceId(place.id);
    setQuery(place.name);
  };

  const panelStyle: any = Platform.OS === 'web' ? { backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)' } : {};
  const glass = [styles.glass, panelStyle];

  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="light-content" />
    <CampusMap places={visiblePlaces} category="All" focusPlaceId={focusPlaceId} resetToken={resetToken} tiltToken={tiltToken}
      onSelect={id => { const place = places.find(item => item.id === id); if (place) choosePlace(place); }}
      onMapError={message => setError(message)} onMapReady={() => setError('')} />

    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.topStack}>
        <View style={[glass, styles.searchPanel]}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>G</Text></View>
            <View style={styles.brandCopy}><Text style={styles.brand}>GoMap</Text><Text style={styles.location}>AUI · IFRANE</Text></View>
            <Pressable accessibilityLabel="Center on campus" onPress={() => { setSelected(null); setFocusPlaceId(null); setResetToken(n => n + 1); }} style={styles.centerButton}><Text style={styles.centerGlyph}>◎</Text></Pressable>
            <Pressable accessibilityLabel={is3D ? 'Switch to 2D map' : 'Switch to 3D map'} onPress={() => { setIs3D(value => !value); setTiltToken(n => n + 1); }} style={[styles.modeButton, is3D && styles.modeButtonActive]}><Text style={[styles.modeText, is3D && styles.modeTextActive]}>{is3D ? '3D' : '2D'}</Text></Pressable>
          </View>
          <View style={styles.searchRow}><Text style={styles.searchIcon}>⌕</Text><TextInput value={query} onChangeText={value => { setQuery(value); setSelected(null); setFocusPlaceId(null); }} placeholder="Find a place on campus" placeholderTextColor="#d9e0e7a8" style={styles.searchInput} accessibilityLabel="Search campus destinations" returnKeyType="search" />{query.length > 0 && <Pressable accessibilityLabel="Clear search" onPress={() => { setQuery(''); setSelected(null); setFocusPlaceId(null); }} style={styles.clearSearch}><Text style={styles.clearSearchText}>×</Text></Pressable>}</View>
        </View>

        <View style={styles.filterRow}>{filters.map(filter => <Pressable key={filter.label} onPress={() => setActiveFilter(filter.label)} style={[glass, styles.filterChip, activeFilter === filter.label && styles.filterChipActive]}><Text style={[styles.filterText, activeFilter === filter.label && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}</View>

        {query.trim().length > 0 && !selected && <View style={[glass, styles.resultsPanel]}>{results.length ? results.map(place => <Pressable key={place.id} onPress={() => choosePlace(place)} style={styles.resultRow}><View style={styles.resultGlyph}><Text style={styles.resultGlyphText}>⌖</Text></View><View style={styles.resultCopy}><Text style={styles.resultName}>{place.name}</Text><Text style={styles.resultMeta}>{place.category} · demo location</Text></View><Text style={styles.resultArrow}>↗</Text></Pressable>) : <Text style={styles.noResults}>No matching campus destinations</Text>}</View>}
      </View>

      {loading && <View style={[glass, styles.loadingCard]}><ActivityIndicator color="#fff" /><Text style={styles.loadingText}>Loading campus map…</Text></View>}
      {!!error && <View style={[glass, styles.errorCard]}><Text style={styles.errorTitle}>Map unavailable</Text><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => { setError(''); setResetToken(n => n + 1); }}><Text style={styles.retryText}>Try again</Text></Pressable></View>}

      {selected ? <View style={[glass, styles.placeCard]}>
        <View style={styles.placeCardTop}><View style={styles.placeType}><Text style={styles.placeTypeText}>{selected.category.toUpperCase()}</Text></View><Pressable accessibilityLabel="Close destination" onPress={() => { setSelected(null); setFocusPlaceId(null); setQuery(''); }} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        <Text numberOfLines={2} style={styles.placeName}>{selected.name}</Text>
        <View style={styles.demoNotice}><View style={styles.demoDot} /><Text style={styles.demoText}>Approximate demo pin · needs AUI verification</Text></View>
      </View> : <View style={[glass, styles.footerPill]}><View style={styles.liveDot} /><Text style={styles.footerText}>AUI CAMPUS</Text><View style={styles.footerDivider} /><Text style={styles.footerSub}>{places.length} demo places</Text></View>}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#18212a' },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18 },
  topStack: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 10 },
  glass: { backgroundColor: 'rgba(25, 37, 49, 0.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)', borderTopColor: 'rgba(255,255,255,0.48)', shadowColor: '#060c12', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  searchPanel: { borderRadius: 23, padding: 13 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 11 },
  brandMark: { width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  brandCopy: { flex: 1 }, brand: { color: '#fff', fontSize: 16, lineHeight: 19, fontWeight: '700' }, location: { color: '#d4e0e8bd', fontSize: 9, letterSpacing: 1.6, fontWeight: '700', marginTop: 2 },
  centerButton: { width: 36, height: 36, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }, centerGlyph: { color: '#f4f8fb', fontSize: 22 },
  modeButton: { minWidth: 40, height: 36, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }, modeButtonActive: { backgroundColor: '#f2f6fa', borderColor: '#fff' }, modeText: { color: '#f4f8fb', fontSize: 12, fontWeight: '800' }, modeTextActive: { color: '#263545' },
  searchRow: { height: 43, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.11)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 8 }, searchIcon: { color: '#edf4fa', fontSize: 23 }, searchInput: { flex: 1, color: '#fff', fontSize: 13, outlineStyle: 'none' as any, paddingVertical: 0 }, clearSearch: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.16)' }, clearSearchText: { color: '#fff', fontSize: 18, lineHeight: 20 },
  filterRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' }, filterChip: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: 'rgba(26,35,46,0.62)' }, filterChipActive: { backgroundColor: 'rgba(248,250,252,0.93)', borderColor: 'rgba(255,255,255,0.8)' }, filterText: { color: '#edf3f8', fontSize: 11, fontWeight: '600' }, filterTextActive: { color: '#233343', fontWeight: '700' },
  resultsPanel: { borderRadius: 19, paddingVertical: 5, overflow: 'hidden' }, resultRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' }, resultGlyph: { width: 31, height: 31, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.17)', alignItems: 'center', justifyContent: 'center' }, resultGlyphText: { color: '#fff', fontSize: 20 }, resultCopy: { flex: 1 }, resultName: { color: '#fff', fontSize: 13, fontWeight: '700' }, resultMeta: { color: '#d0dbe4bd', fontSize: 10, marginTop: 3 }, resultArrow: { color: '#d0dbe4bd', fontSize: 17 }, noResults: { color: '#e1e8ee', fontSize: 12, padding: 15 },
  loadingCard: { alignSelf: 'center', borderRadius: 18, paddingVertical: 12, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 9 }, loadingText: { color: '#fff', fontSize: 12 }, errorCard: { alignSelf: 'center', maxWidth: 380, borderRadius: 19, padding: 16 }, errorTitle: { color: '#fff', fontSize: 14, fontWeight: '700' }, errorText: { color: '#e1e8ee', fontSize: 11, lineHeight: 16, marginTop: 5 }, retryText: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 10 },
  footerPill: { alignSelf: 'center', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#b5edcf' }, footerText: { color: '#fff', fontSize: 10, letterSpacing: 1.1, fontWeight: '800' }, footerDivider: { width: 1, height: 13, backgroundColor: 'rgba(255,255,255,0.28)' }, footerSub: { color: '#e3eaf0d9', fontSize: 10 },
  placeCard: { alignSelf: 'center', width: '100%', maxWidth: 560, borderRadius: 22, padding: 16 }, placeCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, placeType: { backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }, placeTypeText: { color: '#ecf3f8', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }, closeButton: { width: 29, height: 29, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }, closeText: { color: '#fff', fontSize: 20, lineHeight: 22 }, placeName: { color: '#fff', fontSize: 19, lineHeight: 24, fontWeight: '700', marginTop: 8 }, demoNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }, demoDot: { width: 6, height: 6, borderRadius: 4, backgroundColor: '#ffcd79' }, demoText: { color: '#e3eaf0c9', fontSize: 10 },
});

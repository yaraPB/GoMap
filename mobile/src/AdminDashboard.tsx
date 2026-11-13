import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Place, Service } from './api';

type Section = 'Overview' | 'Places' | 'Actions' | 'Faculty' | 'Reports';
type Props = { places: Place[]; services: Service[]; onBack: () => void; onOpenPlace: (place: Place) => void };

const green = '#138c67';
const dark = '#152b29';
const sections: Section[] = ['Overview', 'Places', 'Actions', 'Faculty', 'Reports'];

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{detail && <Text style={styles.sectionDetail}>{detail}</Text>}</View>;
}

function EmptyArea({ title, text, fields }: { title: string; text: string; fields: string[] }) {
  return <View style={styles.emptyCard}>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.body}>{text}</Text>
    <Text style={styles.fieldHeading}>PLANNED FIELDS</Text>
    <Text style={styles.fieldList}>{fields.join('  ·  ')}</Text>
  </View>;
}

export default function AdminDashboard({ places, services, onBack, onOpenPlace }: Props) {
  const [section, setSection] = useState<Section>('Overview');
  const [search, setSearch] = useState('');
  const missingHours = places.filter(place => !place.hours).length;
  const matchingPlaces = places.filter(place => `${place.name} ${place.category} ${place.description}`.toLowerCase().includes(search.trim().toLowerCase()));

  const placeRow = (place: Place) => <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={`View ${place.name} on map`} onPress={() => onOpenPlace(place)} style={styles.row}>
    <View style={styles.rowMain}><Text style={styles.rowTitle}>{place.name}</Text><Text style={styles.rowSubtitle}>{place.category} · {place.verificationStatus === 'sample' ? 'Sample record' : place.verificationStatus}</Text></View>
    <Text style={styles.rowAction}>Map ›</Text>
  </Pressable>;

  const actionRow = (service: Service) => {
    const destination = places.find(place => place.id === service.destinationId);
    return <View key={service.id} style={styles.row}>
      <View style={styles.rowMain}><Text style={styles.rowTitle}>{service.title}</Text><Text style={styles.rowSubtitle}>{destination?.name || 'Destination unavailable'}</Text><Text style={styles.rowNote}>{service.note}</Text></View>
    </View>;
  };

  return <View style={styles.page}>
    <View style={styles.header}><Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable><View><Text style={styles.headerTitle}>Admin dashboard</Text><Text style={styles.headerSubtitle}>View-only preview</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.banner}><Text style={styles.bannerTitle}>Campus information</Text><Text style={styles.bannerText}>Preview the records and sections the admin dashboard will manage. Editing and publishing are not connected yet.</Text></View>
      <View style={styles.tabs}>{sections.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: section === item }} onPress={() => setSection(item)} style={[styles.tab, section === item && styles.activeTab]}><Text style={[styles.tabText, section === item && styles.activeTabText]}>{item}</Text></Pressable>)}</View>

      {section === 'Overview' && <>
        <SectionTitle title="At a glance" detail="Current API records" />
        <View style={styles.metrics}>
          <View style={styles.metric}><Text style={styles.metricNumber}>{places.length}</Text><Text style={styles.metricLabel}>Map places</Text></View>
          <View style={styles.metric}><Text style={styles.metricNumber}>{services.length}</Text><Text style={styles.metricLabel}>Student actions</Text></View>
          <View style={styles.metric}><Text style={styles.metricNumber}>{missingHours}</Text><Text style={styles.metricLabel}>Places without hours</Text></View>
        </View>
        <SectionTitle title="What this dashboard will manage" />
        <View style={styles.summaryCard}><Text style={styles.summaryTitle}>Buildings and locations</Text><Text style={styles.body}>Add buildings, rename them, place their pins, and record entrances. Current map places are sample records.</Text></View>
        <View style={styles.summaryCard}><Text style={styles.summaryTitle}>Offices and faculty</Text><Text style={styles.body}>Connect people and offices to buildings, rooms, contact details, and office hours.</Text></View>
        <View style={styles.summaryCard}><Text style={styles.summaryTitle}>Student actions</Text><Text style={styles.body}>Maintain the responsible office, steps, forms, and destination for requests such as minor declaration.</Text></View>
        <View style={styles.summaryCard}><Text style={styles.summaryTitle}>Correction reports</Text><Text style={styles.body}>Review issues sent from the app. The review queue is not connected in this preview.</Text></View>
      </>}

      {section === 'Places' && <>
        <SectionTitle title="Map places" detail={`${places.length} current records`} />
        <Text style={styles.body}>These are the current map records. Buildings and offices will become separate editable records later.</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search map places" placeholderTextColor="#82918d" style={styles.search} accessibilityLabel="Search map places in admin preview" />
        {matchingPlaces.length ? matchingPlaces.map(placeRow) : <Text style={styles.emptyText}>No matching places.</Text>}
      </>}

      {section === 'Actions' && <>
        <SectionTitle title="Student actions" detail={`${services.length} current suggestions`} />
        <Text style={styles.body}>These suggestions still need confirmation before they become official instructions.</Text>
        {services.map(actionRow)}
        <EmptyArea title="Action details" text="The editor will hold the information students need to complete each request." fields={['Responsible office', 'Building', 'Contact', 'Steps', 'Form link', 'Verified date']} />
      </>}

      {section === 'Faculty' && <EmptyArea title="Faculty and offices" text="The faculty JSON has not been imported into the app yet. This preview does not show its people or imply that their hours are current." fields={['Name', 'Department', 'Building', 'Room', 'Office hours', 'Email', 'Profile source']} />}

      {section === 'Reports' && <EmptyArea title="Correction reports" text="The app stores submitted reports on the server, but there is no review endpoint yet. A future admin queue will show reports here." fields={['Place', 'Issue type', 'Details', 'Submitted date', 'Status']} />}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7faf8' },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e6ece9' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#f0f7f3' },
  backText: { color: green, fontSize: 30, lineHeight: 34 },
  headerTitle: { color: dark, fontSize: 19, fontWeight: '700' }, headerSubtitle: { color: '#6d8075', fontSize: 12, marginTop: 2 },
  content: { padding: 18, paddingBottom: 38 },
  banner: { backgroundColor: '#e6f5ed', borderRadius: 16, padding: 18 }, bannerTitle: { color: dark, fontSize: 22, fontWeight: '700' }, bannerText: { color: '#456454', fontSize: 13, lineHeight: 19, marginTop: 6 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 18, marginBottom: 8 },
  tab: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: '#d6e5dc', backgroundColor: '#fff' }, activeTab: { backgroundColor: green, borderColor: green },
  tabText: { color: '#50685a', fontSize: 12, fontWeight: '600' }, activeTabText: { color: '#fff' },
  sectionHeading: { marginTop: 18, marginBottom: 10 }, sectionTitle: { color: dark, fontSize: 18, fontWeight: '700' }, sectionDetail: { color: '#70847a', fontSize: 12, marginTop: 3 },
  metrics: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, minHeight: 96, backgroundColor: '#fff', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#e4ece7' },
  metricNumber: { color: green, fontSize: 25, fontWeight: '700' }, metricLabel: { color: '#587164', fontSize: 11, lineHeight: 15, marginTop: 5 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e4ece7', padding: 14, marginBottom: 8 }, summaryTitle: { color: dark, fontSize: 15, fontWeight: '700' },
  body: { color: '#546b5d', fontSize: 13, lineHeight: 19, marginTop: 5 },
  search: { height: 46, borderWidth: 1, borderColor: '#d0ddd3', borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, color: dark, marginVertical: 14 },
  row: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e4ece7', padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1 }, rowTitle: { color: dark, fontSize: 15, fontWeight: '700' }, rowSubtitle: { color: '#677c70', fontSize: 12, marginTop: 4 }, rowNote: { color: '#73867b', fontSize: 12, lineHeight: 17, marginTop: 8 }, rowAction: { color: green, fontSize: 13, fontWeight: '700', marginLeft: 8 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e4ece7', padding: 16, marginTop: 18 },
  emptyTitle: { color: dark, fontSize: 17, fontWeight: '700' }, fieldHeading: { color: '#73887a', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 20 }, fieldList: { color: '#365b45', fontSize: 13, lineHeight: 22, marginTop: 7 }, emptyText: { color: '#6f8175', fontSize: 13, marginTop: 12 },
});

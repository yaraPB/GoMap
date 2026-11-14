import type { Category } from '../api/types';

/** Tokens from design/README.md §4. */
export const color = {
  ink: '#15171A',
  ink2: '#3A3D42',
  muted: '#6B7280',
  muted2: '#8E949C',
  hairline: '#EFEFEC',
  line: '#DEDFDA',
  panel: '#FFFFFF',
  surface: '#F2F3F0',
  surface2: '#F4F5F2',
  page: '#FAFAF8',
  map: '#3E4C44',
  night: '#0E1015',
  blue: '#2563EB',
  blueSoft: '#4F8BF0',
  blueText: '#6FA0F2',
  green: '#16A34A',
  greenDeep: '#0B6B3F',
  danger: '#B5342B',
  warnBg: '#FFF7E8',
  warnLine: '#F3E2BE',
  warnText: '#6B4A05',
  crowd: ['#FDE68A', '#F59E0B', '#B45309'] as const,
};

export const status = {
  open: { fg: '#0B6B3F', bg: '#E6F4EC' },
  busy: { fg: '#6B4A05', bg: '#FFF3DB' },
  closed: { fg: '#5F6368', bg: '#F2F3F0' },
  missing: { fg: '#9A2B23', bg: '#FFF1F0' },
};

export const categories: { id: Category | 'all'; name: string; icon: IconName; color: string }[] = [
  { id: 'all', name: 'All', icon: 'all', color: '#15171A' },
  { id: 'academic', name: 'Academic', icon: 'cap', color: '#2563EB' },
  { id: 'residential', name: 'Residential', icon: 'home', color: '#E0841F' },
  { id: 'dining', name: 'Dining', icon: 'fork', color: '#D1473F' },
  { id: 'athletics', name: 'Athletics', icon: 'gym', color: '#11864F' },
  { id: 'admin', name: 'Administrative', icon: 'doc', color: '#6D5BD0' },
  { id: 'services', name: 'Services', icon: 'info', color: '#0E7490' },
  { id: 'facilities', name: 'Facilities', icon: 'gear', color: '#6B7280' },
];
export const categoryColor = (c: string) => categories.find(x => x.id === c)?.color ?? color.blue;
export const categoryName = (c: string) => categories.find(x => x.id === c)?.name ?? c;
export const categoryIcon = (c: string): IconName => categories.find(x => x.id === c)?.icon ?? 'pin';

export const schools: { id: 'all' | 'sba' | 'sse' | 'shss' | 'lc'; name: string }[] = [
  { id: 'all', name: 'All schools' },
  { id: 'sba', name: 'Business Administration' },
  { id: 'sse', name: 'Science & Engineering' },
  { id: 'shss', name: 'Humanities & Social Sciences' },
  { id: 'lc', name: 'Language Center' },
];

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  arabic: 'NotoSansArabic_500Medium',
  arabicBold: 'NotoSansArabic_700Bold',
  display: 'SpaceGrotesk_700Bold',
};

export const shadow = {
  float: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 5 },
  sheet: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 28, shadowOffset: { width: 0, height: -8 }, elevation: 16 },
  pill: { shadowColor: '#000', shadowOpacity: 0.38, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
};

/** Paths from the design boards (24×24 viewBox, stroked). */
export const icons = {
  all: 'M4 6h16M4 12h16M4 18h16',
  cap: 'M2 9l10-5 10 5-10 5-10-5zM6 11.5V16c0 1.6 3 3 6 3s6-1.4 6-3v-4.5',
  home: 'M4 11l8-7 8 7M6 10v9h12v-9',
  fork: 'M7 3v8M10 3v8M8.5 11v10M16 3c-1.5 2-1.5 6 0 8v10',
  gym: 'M4 9v6M20 9v6M7 7v10M17 7v10M7 12h10',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4',
  info: 'M12 7h.01M12 11v6',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6M12 3v2M12 19v2M5 12H3M21 12h-2',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  mic: 'M9 3h6v11H9zM5 11a7 7 0 0014 0M12 18v3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 100 8 4 4 0 000-8z',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z',
  walk: 'M13 4a2 2 0 100 4 2 2 0 000-4zM10 22l2-7 3 3v6M8 12l3-3 3 1 2 3M7 22l2-6',
  wheel: 'M10 4a2 2 0 100 4 2 2 0 000-4zM10 9v5h6l2 6M8 11a6 6 0 108 8',
  ar: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M9 14l3-5 3 5',
  car: 'M5 11l2-5h10l2 5M4 11h16v6H4zM7 17v2M17 17v2M7.5 14h.01M16.5 14h.01',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  check: 'M5 12l5 5L20 7',
  warn: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  send: 'M4 12l16-8-6 16-2-7z',
  building: 'M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5',
  classroom: 'M3 7h18v12H3zM3 11h18M9 11v8',
  pin: 'M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11zM12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  turnRight: 'M5 20v-7a4 4 0 014-4h10M15 5l4 4-4 4',
  turnLeft: 'M19 20v-7a4 4 0 00-4-4H5M9 5L5 9l4 4',
  slightRight: 'M8 20v-6l8-8M10 6h6v6',
  slightLeft: 'M16 20v-6L8 6M14 6H8v6',
  stairs: 'M4 20h4v-4h4v-4h4V8h4',
  crossing: 'M5 4v16M19 4v16M9 6h6M9 10h6M9 14h6M9 18h6',
  flagEnd: 'M6 21V4h10l-1.5 3.5L16 11H6',
  door: 'M6 21V4h10v17M13 12h.01M4 21h16',
  calibrate: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 100 8 4 4 0 000-8z',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  user: 'M12 4a4 4 0 100 8 4 4 0 000-8zM4 21a8 8 0 0116 0',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  bolt: 'M13 3L4 14h7l-1 7 9-11h-7z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z',
  wrench: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4L15 12l-3-3z',
  ban: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8',
  plus: 'M12 5v14M5 12h14',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 017 0M5 13a10 10 0 015-2.7M12 20h.01M16.7 11.3A10 10 0 0119 13M2 9a15 15 0 014.5-2.8M10.7 5.1A15 15 0 0122 9',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;
export type IconName = keyof typeof icons;

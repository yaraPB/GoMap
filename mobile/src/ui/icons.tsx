/**
 * One icon set for the whole app: Lucide (consistent 24px line icons, 2px stroke).
 * Screens use names; this file decides the glyph, so swapping a glyph is a one-line change.
 * (The in-map pins keep their own path strings in theme.ts because they render in the WebView.)
 */
import type { LucideIcon } from 'lucide-react-native';
import {
  Accessibility, ArrowUp, CalendarDays, Ticket, PencilRuler, Volume, RotateCcw, Smartphone, PartyPopper, MoveUp, ArrowUpLeft, ArrowUpRight, Backpack, Ban, BookOpen, BriefcaseBusiness, Building2, Calendar, CalendarClock,
  Camera, Car, ChartNoAxesColumnIncreasing, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Compass, CornerUpLeft, CornerUpRight,
  DoorOpen, Dumbbell, Ellipsis, Eye, FileText, Flag, FlagTriangleRight, Flame, Footprints, Globe, GraduationCap, Hourglass, House, Info,
  Keyboard, Laptop, Layers, LayoutGrid, Lightbulb, LocateFixed, Mail, LockKeyhole, Map, MapPin, Mic, Moon, Navigation, Palmtree, Phone, Plane, Plus,
  Presentation, Satellite, ScanEye, School, Search, SendHorizontal, Settings, ShieldCheck, Signpost, Soup, Sparkles, StickyNote, Sun,
  Sunrise, Sunset, Thermometer, TrafficCone, TriangleAlert, User, Users, Utensils, Volume2, VolumeX, WifiOff, Wrench, X, Contrast, Armchair, Mountain,
} from 'lucide-react-native';

export const LUCIDE = {
  all: LayoutGrid, cap: GraduationCap, home: House, fork: Utensils, gym: Dumbbell, doc: FileText, info: Info, gear: Settings,
  search: Search, back: ChevronLeft, close: X, chevron: ChevronRight, down: ChevronDown, mic: Mic, sparkle: Sparkles, layers: Layers,
  locate: LocateFixed, flame: Flame, walk: Footprints, wheel: Accessibility, ar: ScanEye, car: Car, mail: Mail, lock: LockKeyhole, phone: Phone,
  clock: Clock, shield: ShieldCheck, check: Check, warn: TriangleAlert, flag: Flag, globe: Globe, send: SendHorizontal,
  building: Building2, classroom: School, pin: MapPin, arrowUp: ArrowUp, turnRight: CornerUpRight, turnLeft: CornerUpLeft,
  slightRight: ArrowUpRight, slightLeft: ArrowUpLeft, stairs: ChartNoAxesColumnIncreasing, crossing: TrafficCone, flagEnd: FlagTriangleRight,
  door: DoorOpen, calibrate: Compass, map: Map, user: User, users: Users, camera: Camera, bolt: Volume2, volume: Volume2, mute: VolumeX,
  eye: Eye, light: Lightbulb, wrench: Wrench, ban: Ban, plus: Plus, wifiOff: WifiOff, dots: Ellipsis, keyboard: Keyboard,
  // role views and widgets
  student: Backpack, faculty: Presentation, staff: BriefcaseBusiness, visitor: Compass, calendar: Calendar, calendarClock: CalendarClock,
  sunrise: Sunrise, sun: Sun, sunset: Sunset, moon: Moon, lunch: Soup, book: BookOpen, sofa: Armchair, sign: Signpost, nav: Navigation,
  // door notes
  sick: Thermometer, laptop: Laptop, hourglass: Hourglass, note: StickyNote, plane: Plane, leave: Palmtree,
  satellite: Satellite, contrast: Contrast, slope: Mountain,
  // events, AR, door notes (new)
  events: CalendarDays, ticket: Ticket, party: PartyPopper, moved: PencilRuler, turnAround: RotateCcw, phone2: Smartphone, up: MoveUp, sound: Volume,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof LUCIDE;

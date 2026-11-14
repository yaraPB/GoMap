import type { Feature, LineString, Point, Polygon, MultiPolygon } from 'geojson';

/** What a line is, for drawing and for routing. */
export type WayKind = 'walkway' | 'road' | 'crossing' | 'stairs' | 'ramp';
/** Who may use it. Walking routes can use `both`; driving routes never use `walk`. */
export type WayModes = 'walk' | 'drive' | 'both';

export type WayProps = {
  id: string;
  kind: WayKind;
  modes: WayModes;
  step_free: boolean;
  lit: boolean | null;
  covered: boolean | null;
  name: string | null;
  /** Mapbox/OSM road class, kept for styling and route cost (e.g. 'service', 'primary'). */
  road_class: string | null;
  source: 'mapbox' | 'osm' | 'mock';
};
export type WayFeature = Feature<LineString, WayProps>;

export type PoiProps = {
  name: string;
  /** Mapbox poi class / OSM amenity, e.g. 'building', 'food_and_drink'. */
  poi_class: string | null;
  maki: string | null;
  source: 'mapbox' | 'osm' | 'mock';
};
export type PoiFeature = Feature<Point, PoiProps>;

export type BuildingFeature = Feature<Polygon | MultiPolygon, { height: number | null; source: string }>;

/** The campus box everything is cut to. Generous around AUI, Ifrane. [w, s, e, n] */
export const CAMPUS_BBOX: [number, number, number, number] = [-5.1135, 33.5325, -5.0985, 33.5455];
export const CAMPUS_CENTER: [number, number] = [-5.1066, 33.5393];

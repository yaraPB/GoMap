/**
 * Al Akhawayn University, as the map shows it: the outline of campus (convex hull of every building
 * and place, plus 90 m) and the box the camera may not leave. Generated from data/campus by
 * server/src/scripts (turf.convex + buffer); regenerate if the campus grows.
 */
export const CAMPUS_OUTLINE: [number, number][] = [[-5.11049,33.53842],[-5.10921,33.53412],[-5.10752,33.53297],[-5.10651,33.53271],[-5.10548,33.53286],[-5.10361,33.5359],[-5.10242,33.53882],[-5.10227,33.54062],[-5.10328,33.54295],[-5.10774,33.54418],[-5.109,33.54403],[-5.11039,33.54222],[-5.11068,33.53976],[-5.11049,33.53842]];
/** The camera stays inside this box (outline + ~250 m), in every view. */
export const CAMPUS_MAX_BOUNDS: [[number, number], [number, number]] = [[-5.1134,33.5305],[-5.0996,33.5464]];
/** Zoomed out further, campus would be a speck: this is the widest view. */
export const CAMPUS_MIN_ZOOM = 15.2;

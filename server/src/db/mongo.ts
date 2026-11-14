/**
 * MongoDB holds the map data: places, entrances, walkways and report pins.
 * Everything geographic is stored as GeoJSON with a 2dsphere index.
 *
 * MONGODB_URI set   → connect to it (Atlas free tier or a local mongod).
 * MONGODB_URI unset → start an in-memory MongoDB (data resets on restart; seeds itself).
 */
import mongoose, { Schema, model, type InferSchemaType } from 'mongoose';

let memoryServer: { stop: () => Promise<boolean> } | null = null;

export async function connectMongo(uri: string) {
  let target = uri;
  if (!target) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    memoryServer = server;
    target = server.getUri('gomap');
    console.log('MongoDB: in-memory (set MONGODB_URI to keep data between restarts)');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(target, { serverSelectionTimeoutMS: 8000 });
  await Promise.all([Place, Entrance, Walkway, Report].map(m => m.syncIndexes()));
  return mongoose.connection;
}

export async function disconnectMongo() {
  await mongoose.disconnect();
  if (memoryServer) { await memoryServer.stop(); memoryServer = null; }
}

const point = new Schema({ type: { type: String, enum: ['Point'], required: true }, coordinates: { type: [Number], required: true } }, { _id: false });
const shape = new Schema({ type: { type: String, enum: ['Polygon', 'MultiPolygon', 'LineString'], required: true }, coordinates: { type: Schema.Types.Mixed, required: true } }, { _id: false });

export const CATEGORIES = ['academic', 'residential', 'dining', 'athletics', 'admin', 'services', 'facilities'] as const;
export const SCHOOLS = ['sba', 'sse', 'shss', 'lc'] as const;

const placeSchema = new Schema({
  _id: { type: String, required: true },          // 'building-11'
  name: { type: String, required: true },
  number: { type: String, default: null },        // '11', '8B'
  category: { type: String, enum: CATEGORIES, required: true },
  schools: { type: [String], default: [] },       // schools with offices here
  aliases: { type: [String], default: [] },
  description: { type: String, default: null },
  location: { type: point, required: true },
  footprint: { type: shape, default: null },
  height: { type: Number, default: null },
  /** Weekly hours. A missing day key = not published; [] = explicitly closed. null = nothing published. */
  hours: { type: Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  closed_reason: { type: String, default: null },
  closed_from: { type: String, default: null },
  closed_until: { type: String, default: null },
  source: { type: String, default: 'mapbox' },
  position_estimated: { type: Boolean, default: false },
  verified_at: { type: String, default: null },
  review_months: { type: Number, default: 6 },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true },
}, { versionKey: false });
placeSchema.index({ location: '2dsphere' });
placeSchema.index({ category: 1 });

const entranceSchema = new Schema({
  _id: { type: String, required: true },
  place_id: { type: String, required: true, index: true },
  name: { type: String, required: true },
  location: { type: point, required: true },
  step_free: { type: Boolean, default: true },
  /** true until someone confirms where the door really is */
  estimated: { type: Boolean, default: true },
}, { versionKey: false });
entranceSchema.index({ location: '2dsphere' });

const walkwaySchema = new Schema({
  _id: { type: String, required: true },
  kind: { type: String, enum: ['walkway', 'road', 'crossing', 'stairs', 'ramp'], required: true },
  modes: { type: String, enum: ['walk', 'drive', 'both'], required: true },
  step_free: { type: Boolean, default: true },
  lit: { type: Boolean, default: null },
  covered: { type: Boolean, default: null },
  name: { type: String, default: null },
  road_class: { type: String, default: null },
  source: { type: String, required: true },
  geometry: { type: shape, required: true },
}, { versionKey: false });
walkwaySchema.index({ geometry: '2dsphere' });

const reportSchema = new Schema({
  _id: { type: String, required: true },
  kind: { type: String, enum: ['closed', 'broken', 'info', 'hazard', 'light', 'access'], required: true },
  location: { type: point, required: true },
  place_id: { type: String, default: null },
  note: { type: String, default: null },
  photo_path: { type: String, default: null },
  duration: { type: String, enum: ['today', 'days', 'unknown'], default: 'unknown' },
  reporter: { type: String, default: null },
  reporter_name: { type: String, default: null },
  status: { type: String, enum: ['new', 'confirmed', 'dismissed', 'resolved'], default: 'new', index: true },
  /** reports within 20 m share a cluster: one decision, not four */
  cluster_id: { type: String, required: true, index: true },
  closure: {
    type: new Schema({ from: String, until: { type: String, default: null }, reason: String, radius_m: { type: Number, default: 15 } }, { _id: false }),
    default: null,
  },
  created_at: { type: String, required: true },
  decided_at: { type: String, default: null },
}, { versionKey: false });
reportSchema.index({ location: '2dsphere' });

export const Place = model('Place', placeSchema);
export const Entrance = model('Entrance', entranceSchema);
export const Walkway = model('Walkway', walkwaySchema);
export const Report = model('Report', reportSchema);

export type PlaceDoc = InferSchemaType<typeof placeSchema>;
export type EntranceDoc = InferSchemaType<typeof entranceSchema>;
export type WalkwayDoc = InferSchemaType<typeof walkwaySchema>;
export type ReportDoc = InferSchemaType<typeof reportSchema>;

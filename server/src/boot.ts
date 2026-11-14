import { Assistant } from './assistant/assistant.js';
import { Gemini } from './assistant/gemini.js';
import { config, DATA_DIR } from './config.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';
import { openSqlite } from './db/sqlite.js';
import { seedCrowding, seedMongo, seedSqlite } from './seed/seed.js';
import { Campus } from './services/campus.js';

export type BootOptions = { mongoUri?: string; sqliteFile?: string; dataDir?: string; geminiKey?: string; fetchImpl?: typeof fetch; quiet?: boolean };

/** Connects both stores, seeds whatever is empty, builds the routing graph and the assistant index. */
export async function boot(opts: BootOptions = {}) {
  const log = opts.quiet ? () => {} : console.log;
  await connectMongo(opts.mongoUri ?? config.mongoUri);
  const db = openSqlite(opts.sqliteFile ?? config.sqliteFile);
  const stamp = new Date().toISOString();
  const geoSource = await seedMongo(stamp, opts.dataDir ?? DATA_DIR);
  seedSqlite(db, stamp, opts.dataDir ?? DATA_DIR);
  const campus = new Campus();
  await campus.rebuild();
  seedCrowding(db, campus.walkways.map(w => ({ id: w.properties.id, coords: w.geometry.coordinates, modes: w.properties.modes })));
  const gemini = new Gemini(opts.geminiKey ?? config.geminiKey, config.geminiModel, opts.fetchImpl);
  const assistant = new Assistant(db, campus, gemini);
  await assistant.refresh();
  log(`Campus network from ${geoSource}`);
  log(campus.report());
  return {
    db, campus, assistant,
    async close() { db.close(); await disconnectMongo(); },
  };
}

import { Assistant } from './assistant/assistant.js';
import { Claude } from './assistant/claude.js';
import { Gemini } from './assistant/gemini.js';
import type { Llm } from './assistant/llm.js';
import { config, DATA_DIR } from './config.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';
import { openSqlite } from './db/sqlite.js';
import { seedCrowding, seedMongo, seedSqlite } from './seed/seed.js';
import { Campus } from './services/campus.js';
import { Events } from './services/events.js';
import { seedAssistantAdmin } from './services/assistantAdmin.js';

export type BootOptions = { mongoUri?: string; sqliteFile?: string; dataDir?: string; geminiKey?: string; anthropicKey?: string; provider?: 'auto' | 'claude' | 'gemini'; fetchImpl?: typeof fetch; quiet?: boolean };

/** Connects both stores, seeds whatever is empty, builds the routing graph and the assistant index. */
export async function boot(opts: BootOptions = {}) {
  const log = opts.quiet ? () => {} : console.log;
  await connectMongo(opts.mongoUri ?? config.mongoUri);
  const db = openSqlite(opts.sqliteFile ?? config.sqliteFile);
  const stamp = new Date().toISOString();
  const geoSource = await seedMongo(stamp, opts.dataDir ?? DATA_DIR);
  seedSqlite(db, stamp, opts.dataDir ?? DATA_DIR);
  new Events(db).seedSamples();
  seedAssistantAdmin(db, stamp);
  const campus = new Campus();
  await campus.rebuild();
  seedCrowding(db, campus.walkways.map(w => ({ id: w.properties.id, coords: w.geometry.coordinates, modes: w.properties.modes })));
  const gemini = new Gemini(opts.geminiKey ?? config.geminiKey, config.geminiModel, opts.fetchImpl, config.geminiFallbacks);
  const claude = new Claude(opts.anthropicKey ?? config.anthropicKey, config.claudeModel, opts.fetchImpl);
  const provider = opts.provider ?? config.assistantProvider;
  // the model that resolves open questions; Gemini also stays the voice fallback (Claude has no audio input)
  const llm: Llm = provider === 'claude' ? claude : provider === 'gemini' ? gemini : claude.configured ? claude : gemini;
  const assistant = new Assistant(db, campus, llm, gemini);
  await assistant.refresh();
  log(`Campus network from ${geoSource}`);
  log(`Accounts: email + password${config.sessionSecretIsGenerated ? ' (set SESSION_SECRET or everyone signs in again after each restart)' : ''}; test accounts like s.student@aui.ma / 123abc while the dev dashboard keeps them on`);
  log(`Assistant model: ${llm.configured ? `${llm.provider} (${llm.model})` : 'none configured (local answers only)'}`);
  log(campus.report());
  return {
    db, campus, assistant,
    async close() { db.close(); await disconnectMongo(); },
  };
}

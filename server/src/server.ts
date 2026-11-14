import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { boot } from './boot.js';
import { config, loadEnv } from './config.js';
import { clearExpiredPresence } from './services/directory.js';

export { createApp };

const entry = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (entry === import.meta.url) {
  loadEnv();
  const ctx = await boot();
  // "I'm in / I'm out" is today-only and clears at 18:30; closures also start and end on their own dates
  setInterval(() => { clearExpiredPresence(ctx.db); void ctx.campus.refreshClosures(); }, 5 * 60 * 1000).unref();
  createApp(ctx).listen(config.port, '0.0.0.0', () => {
    console.log(`GoMap API on http://localhost:${config.port}  (admin token: ${config.adminToken === 'dev-admin-token' ? 'dev-admin-token — set ADMIN_TOKEN' : 'from ADMIN_TOKEN'})`);
    if (!config.geminiKey) console.log('Assistant: local answers only (set GEMINI_API_KEY for open questions and voice in Expo Go)');
  });
}

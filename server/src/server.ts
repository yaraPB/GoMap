import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { boot } from './boot.js';
import { config, loadEnv } from './config.js';
import { clearExpiredPresence } from './services/directory.js';

export { createApp };

const entry = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (entry === import.meta.url) {
  loadEnv();
  // A dropped database connection (Atlas ECONNRESET) must not take the whole API down: the driver
  // reconnects and retries by itself; one failed request returns an error, the server keeps running.
  process.on('unhandledRejection', e => console.error(`Background task failed (the server keeps running): ${e instanceof Error ? e.message : String(e)}`));
  process.on('uncaughtException', e => {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT') { console.error(`Network error ignored (${code}): the database driver reconnects by itself.`); return; }
    console.error(e); process.exit(1);
  });
  const ctx = await boot();
  // "I'm in / I'm out" is today-only and clears at 18:30; closures also start and end on their own dates
  setInterval(() => {
    try { clearExpiredPresence(ctx.db); } catch (e) { console.error('presence reset failed', e); }
    ctx.campus.refreshClosures().catch(e => console.error(`closures refresh failed (will retry): ${e instanceof Error ? e.message : e}`));
  }, 5 * 60 * 1000).unref();
  createApp(ctx).listen(config.port, '0.0.0.0', () => {
    console.log(`GoMap API on http://localhost:${config.port}  (admin token: ${config.adminToken === 'dev-admin-token' ? 'dev-admin-token — set ADMIN_TOKEN' : 'from ADMIN_TOKEN'})`);
    if (!config.geminiKey) console.log('Assistant: local answers only (set GEMINI_API_KEY for open questions and voice in Expo Go)');
  });
}

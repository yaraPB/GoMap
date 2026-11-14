/** npm run graph:check — run after every edit of the campus geometry. */
import { loadEnv } from '../config.js';
import { boot } from '../boot.js';

loadEnv();
const ctx = await boot({ mongoUri: '', sqliteFile: ':memory:', quiet: true });
console.log(ctx.campus.report());
const lonely = [...ctx.campus.entrances.values()].flat().filter(e => e.node.walk == null);
console.log(`  places without a walkable entrance: ${lonely.length}${lonely.length ? ' — ' + lonely.map(e => e.place_id).join(', ') : ''}`);
await ctx.close();

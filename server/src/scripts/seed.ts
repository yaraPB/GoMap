/** npm run seed — fill a persistent MongoDB (MONGODB_URI) and SQLite file if they are empty. */
import { loadEnv } from '../config.js';
import { boot } from '../boot.js';

loadEnv();
const ctx = await boot();
await ctx.close();

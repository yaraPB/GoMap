import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = resolve(here, '..');
/** Repo-level data/ folder: faculty JSON, mock GeoJSON, imported campus geometry. */
export const DATA_DIR = resolve(SERVER_DIR, '..', 'data');

export function loadEnv() {
  const file = join(SERVER_DIR, '.env');
  if (existsSync(file)) loadEnvFile(file);
}

/** Server-side Mapbox token for the geo importer. Falls back to the mobile app's public token. */
export function mapboxToken(): string | undefined {
  if (process.env.MAPBOX_TOKEN) return process.env.MAPBOX_TOKEN;
  const mobileEnv = resolve(SERVER_DIR, '..', 'mobile', '.env.local');
  if (!existsSync(mobileEnv)) return undefined;
  const line = readFileSync(mobileEnv, 'utf8').split(/\r?\n/).find(l => l.startsWith('EXPO_PUBLIC_MAPBOX_TOKEN='));
  const value = line?.slice('EXPO_PUBLIC_MAPBOX_TOKEN='.length).trim();
  return value?.startsWith('pk.') ? value : undefined;
}

export const config = {
  get port() { return Number(process.env.PORT || 4000); },
  get mongoUri() { return process.env.MONGODB_URI || ''; },
  get sqliteFile() { return process.env.GOMAP_DB || join(SERVER_DIR, 'data', 'gomap.sqlite'); },
  get geminiKey() { return process.env.GEMINI_API_KEY || ''; },
  get geminiModel() { return process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'; },
  get sonioxKey() { return process.env.SONIOX_API_KEY || ''; },
  get sonioxModel() { return process.env.SONIOX_MODEL || 'stt-async-v6'; },
  // TODO: replace with GoCampus SSO
  get adminToken() { return process.env.ADMIN_TOKEN || 'dev-admin-token'; },
  get timezone() { return process.env.CAMPUS_TZ || 'Africa/Casablanca'; },
};

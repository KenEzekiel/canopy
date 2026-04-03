import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CanopyConfig {
  apiKey: string | null;
  hetznerToken: string | null;
}

export const CANOPY_DIR: string = path.join(os.homedir(), '.canopy');
const CONFIG_PATH: string = path.join(CANOPY_DIR, 'config.json');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadConfig(): CanopyConfig {
  ensureDir(CANOPY_DIR);
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { apiKey: null, hetznerToken: null };
  }
}

export function saveConfig(config: CanopyConfig): void {
  ensureDir(CANOPY_DIR);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Returns Hetzner token: user's own (Model C) or env var (Model B).
 */
export function getHetznerToken(): string {
  const config = loadConfig();
  if (config.hetznerToken) return config.hetznerToken;
  const envToken = process.env.CANOPY_HETZNER_TOKEN;
  if (!envToken) throw new Error('No Hetzner token configured. Set CANOPY_HETZNER_TOKEN env var or run canopy init.');
  return envToken;
}

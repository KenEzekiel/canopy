import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CanopyConfig {
  apiKey: string | null;
  hetznerToken: string | null;
  domain: string | null;
}

export const CANOPY_DIR: string = path.join(os.homedir(), '.canopy');
const CONFIG_PATH: string = path.join(CANOPY_DIR, 'config.json');
const CONFIG_TMP_PATH: string = path.join(CANOPY_DIR, 'config.json.tmp');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadConfig(): CanopyConfig {
  ensureDir(CANOPY_DIR);
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { apiKey: null, hetznerToken: null, domain: null };
  }
}

export function saveConfig(config: CanopyConfig): void {
  ensureDir(CANOPY_DIR);
  const data = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(CONFIG_TMP_PATH, data);
  fs.renameSync(CONFIG_TMP_PATH, CONFIG_PATH);
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

/**
 * Returns the base domain for app subdomains.
 * Config > CANOPY_DOMAIN env var. No hardcoded default.
 */
export function getDomain(): string {
  const config = loadConfig();
  if (config.domain) return config.domain;
  const envDomain = process.env.CANOPY_DOMAIN;
  if (!envDomain) throw new Error('No domain configured. Set CANOPY_DOMAIN env var or add "domain" to ~/.canopy/config.json.');
  return envDomain;
}

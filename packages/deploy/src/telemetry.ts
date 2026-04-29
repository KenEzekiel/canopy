import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { CANOPY_DIR } from './config';

const ENDPOINT = 'https://meshterm-telemetry.ken35kiel.workers.dev/ping';
const ID_FILE = path.join(CANOPY_DIR, '.telemetry-id');

let cachedId: string | null = null;

function isDisabled(): boolean {
  if (process.env.CANOPY_TELEMETRY === '0') return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(CANOPY_DIR, 'config.json'), 'utf-8'));
    if (cfg.telemetry === false) return true;
  } catch {}
  return false;
}

function getId(): string {
  if (cachedId) return cachedId;
  try {
    cachedId = fs.readFileSync(ID_FILE, 'utf-8').trim();
  } catch {
    cachedId = randomUUID();
    try {
      fs.mkdirSync(CANOPY_DIR, { recursive: true });
      fs.writeFileSync(ID_FILE, cachedId);
    } catch {}
  }
  return cachedId!;
}

export function track(event: string, extra?: Record<string, unknown>): void {
  if (isDisabled()) return;
  const payload = {
    product: 'canopy',
    event,
    version: process.env.npm_package_version ?? 'unknown',
    id: getId(),
    os: process.platform,
    node: process.versions.node,
    ...extra,
  };
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

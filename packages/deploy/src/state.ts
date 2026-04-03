import fs from 'fs';
import path from 'path';
import { CANOPY_DIR } from './config';

export interface AppInfo {
  serverId: string;
  serverIp: string;
  port: number;
  domain: string;
  framework: string;
  lastDeploy: string;
  createdAt: string;
}

export interface ServerInfo {
  id: number;
  ip: string;
  location: string;
  createdAt: string;
  apps: string[];
}

export interface CanopyState {
  servers: Record<string, ServerInfo>;
  apps: Record<string, AppInfo>;
}

const STATE_PATH = path.join(CANOPY_DIR, 'deployments.json');
const STATE_TMP_PATH = path.join(CANOPY_DIR, 'deployments.json.tmp');

function ensureDir(): void {
  if (!fs.existsSync(CANOPY_DIR)) fs.mkdirSync(CANOPY_DIR, { recursive: true });
}

function loadState(): CanopyState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    // Migrate old flat format to new format
    if (raw && !raw.servers && !raw.apps) {
      return migrateOldState(raw);
    }
    return { servers: raw.servers || {}, apps: raw.apps || {} };
  } catch {
    return { servers: {}, apps: {} };
  }
}

/** Migrate old flat { appName: DeploymentInfo } to new { servers, apps } format */
function migrateOldState(old: Record<string, any>): CanopyState {
  const state: CanopyState = { servers: {}, apps: {} };
  for (const [name, info] of Object.entries(old)) {
    if (!info || !info.serverId) continue;
    const srvKey = `srv-${info.serverId}`;
    if (!state.servers[srvKey]) {
      state.servers[srvKey] = {
        id: info.serverId,
        ip: info.serverIp,
        location: 'unknown',
        createdAt: info.createdAt || new Date().toISOString(),
        apps: [],
      };
    }
    state.servers[srvKey].apps.push(name);
    state.apps[name] = {
      serverId: srvKey,
      serverIp: info.serverIp,
      port: 3000, // old format didn't track port
      domain: info.domain,
      framework: info.framework,
      lastDeploy: info.lastDeploy,
      createdAt: info.createdAt || new Date().toISOString(),
    };
  }
  // Save migrated state
  writeState(state);
  return state;
}

function writeState(state: CanopyState): void {
  ensureDir();
  const data = JSON.stringify(state, null, 2) + '\n';
  fs.writeFileSync(STATE_TMP_PATH, data);
  fs.renameSync(STATE_TMP_PATH, STATE_PATH);
}

// ─── App operations ─────────────────────────────────────────────────────────

export function getDeployment(name: string): AppInfo | null {
  return loadState().apps[name] || null;
}

export function saveDeployment(name: string, info: AppInfo): void {
  const state = loadState();
  state.apps[name] = info;
  // Ensure server tracks this app
  const srv = state.servers[info.serverId];
  if (srv && !srv.apps.includes(name)) {
    srv.apps.push(name);
  }
  writeState(state);
}

export function removeDeployment(name: string): void {
  const state = loadState();
  const app = state.apps[name];
  if (app) {
    // Remove app from server's app list
    const srv = state.servers[app.serverId];
    if (srv) {
      srv.apps = srv.apps.filter((a) => a !== name);
    }
    delete state.apps[name];
  }
  writeState(state);
}

export function listDeployments(): CanopyState {
  return loadState();
}

// ─── Server operations ──────────────────────────────────────────────────────

export function getServerInfo(serverId: string): ServerInfo | null {
  return loadState().servers[serverId] || null;
}

export function saveServer(serverId: string, info: ServerInfo): void {
  const state = loadState();
  state.servers[serverId] = info;
  writeState(state);
}

export function removeServer(serverId: string): void {
  const state = loadState();
  // Remove all apps on this server
  const srv = state.servers[serverId];
  if (srv) {
    for (const appName of srv.apps) {
      delete state.apps[appName];
    }
  }
  delete state.servers[serverId];
  writeState(state);
}

/**
 * Find a server with capacity for another app.
 * Returns null if no server available.
 */
export function findAvailableServer(maxAppsPerServer: number = 5): ServerInfo | null {
  const state = loadState();
  for (const srv of Object.values(state.servers)) {
    if (srv.apps.length < maxAppsPerServer) return srv;
  }
  return null;
}

/**
 * Get the next available port on a server.
 * Starts at 3001, increments per app.
 */
export function getNextPort(serverId: string): number {
  const state = loadState();
  const usedPorts = Object.values(state.apps)
    .filter((a) => a.serverId === serverId)
    .map((a) => a.port);
  let port = 3001;
  while (usedPorts.includes(port)) port++;
  return port;
}

/**
 * Get the server ID for a given app, or null.
 */
export function getServerForApp(name: string): { serverId: string; server: ServerInfo } | null {
  const state = loadState();
  const app = state.apps[name];
  if (!app) return null;
  const server = state.servers[app.serverId];
  if (!server) return null;
  return { serverId: app.serverId, server };
}

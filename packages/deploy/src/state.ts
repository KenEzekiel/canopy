import fs from 'fs';
import path from 'path';
import { CANOPY_DIR } from './config';

export interface DeploymentInfo {
  serverId: number;
  serverIp: string;
  domain: string;
  framework: string;
  lastDeploy: string;
  createdAt: string;
}

export interface DeploymentState {
  [name: string]: DeploymentInfo;
}

const STATE_PATH: string = path.join(CANOPY_DIR, 'deployments.json');
const STATE_TMP_PATH: string = path.join(CANOPY_DIR, 'deployments.json.tmp');

function loadState(): DeploymentState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeState(state: DeploymentState): void {
  const data = JSON.stringify(state, null, 2) + '\n';
  fs.writeFileSync(STATE_TMP_PATH, data);
  fs.renameSync(STATE_TMP_PATH, STATE_PATH);
}

export function getDeployment(name: string): DeploymentInfo | null {
  return loadState()[name] || null;
}

export function saveDeployment(name: string, info: DeploymentInfo): void {
  const state = loadState();
  state[name] = info;
  writeState(state);
}

export function listDeployments(): DeploymentState {
  return loadState();
}

export function removeDeployment(name: string): void {
  const state = loadState();
  delete state[name];
  writeState(state);
}

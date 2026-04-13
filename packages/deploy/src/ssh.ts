import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { Client } from 'ssh2';
import { CANOPY_DIR } from './config';

export interface SSHKey {
  publicKey: string;
  privateKey: string;
  path: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const KEYS_DIR: string = path.join(CANOPY_DIR, 'keys');
const PRIVATE_KEY_PATH: string = path.join(KEYS_DIR, 'canopy_ed25519');
const PUBLIC_KEY_PATH: string = path.join(KEYS_DIR, 'canopy_ed25519.pub');

/**
 * Generate an ed25519 SSH key pair using ssh-keygen (OpenSSH format).
 * ssh2 requires OpenSSH format, not PKCS8 PEM.
 */
function generateSSHKeyPair(): SSHKey {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

  // Remove old keys if they exist (might be in wrong format)
  if (fs.existsSync(PRIVATE_KEY_PATH)) fs.unlinkSync(PRIVATE_KEY_PATH);
  if (fs.existsSync(PUBLIC_KEY_PATH)) fs.unlinkSync(PUBLIC_KEY_PATH);

  execSync(`ssh-keygen -t ed25519 -f "${PRIVATE_KEY_PATH}" -N "" -C "canopy@canopy.sh"`, {
    stdio: 'pipe',
  });

  const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim();
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');

  return { publicKey, privateKey, path: PRIVATE_KEY_PATH };
}

/**
 * Ensure SSH key exists, generate if not.
 */
export function ensureSSHKey(): SSHKey {
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    // Ensure correct permissions
    fs.chmodSync(PRIVATE_KEY_PATH, 0o600);
    return {
      publicKey: fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim(),
      privateKey: fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8'),
      path: PRIVATE_KEY_PATH,
    };
  }
  return generateSSHKeyPair();
}


// Module-level SSH config overrides
let sshConfig: { port?: number; username?: string } = {};

export function setSSHConfig(config: { port?: number; username?: string }): void {
  sshConfig = config;
}

/**
 * Get an SSH connection to a server.
 */
function getConnection(ip: string): Promise<Client> {
  const key = ensureSSHKey();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({
      host: ip,
      port: sshConfig.port || 22,
      username: sshConfig.username || 'root',
      privateKey: key.privateKey,
      readyTimeout: 30000,
    });
  });
}

/**
 * Execute a command on a remote server via SSH.
 */
export async function sshExec(ip: string, command: string): Promise<ExecResult> {
  const conn = await getConnection(ip);
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) { conn.end(); return reject(err); }
      let stdout = '';
      let stderr = '';
      stream.on('data', (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      stream.on('close', (code: number) => {
        conn.end();
        resolve({ stdout, stderr, exitCode: code });
      });
    });
  });
}

/**
 * Upload a directory using rsync (fast for redeploys — only transfers changed files).
 * Falls back to tar+scp if rsync is not available.
 */
export async function rsyncUpload(ip: string, localPath: string, remotePath: string): Promise<void> {
  const excludes = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.env', '.env.local', '.env.production']
    .map(e => `--exclude='${e}'`).join(' ');

  const user = sshConfig.username || 'root';
  const port = sshConfig.port || 22;

  try {
    execSync(
      `rsync -azq --delete ${excludes} -e "ssh -i '${PRIVATE_KEY_PATH}' -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" "${localPath}/" ${user}@${ip}:${remotePath}/`,
      { stdio: 'pipe' }
    );
  } catch (err: any) {
    // Only fallback to tar+scp if rsync binary is not found
    const msg = err.stderr?.toString() || err.message || '';
    if (msg.includes('command not found') || msg.includes('No such file') || err.status === 127) {
      await sshUpload(ip, localPath, remotePath);
    } else {
      throw new Error(`rsync failed: ${msg}`);
    }
  }
}

/**
 * Upload a directory to a remote server using tar + native scp.
 * Much faster than ssh2 SFTP. Excludes node_modules, .git, dist, build, .next, .cache.
 */
export async function sshUpload(ip: string, localPath: string, remotePath: string): Promise<void> {
  const tarPath = path.join(os.tmpdir(), `canopy-upload-${Date.now()}.tar.gz`);

  try {
    // Create tar locally
    execSync(
      `tar -czf "${tarPath}" --exclude=node_modules --exclude=.git --exclude=dist --exclude=build --exclude=.next --exclude=.cache --exclude='.env' --exclude='.env.*' -C "${localPath}" .`,
      { stdio: 'pipe' }
    );

    // Create remote dir
    await sshExec(ip, `mkdir -p ${remotePath}`);

    // Upload via native scp (fast, uses system SSH)
    const user = sshConfig.username || 'root';
    const port = sshConfig.port || 22;
    execSync(
      `scp -P ${port} -i "${PRIVATE_KEY_PATH}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${tarPath}" ${user}@${ip}:/tmp/canopy-upload.tar.gz`,
      { stdio: 'pipe' }
    );

    // Extract on server
    await sshExec(ip, `cd ${remotePath} && tar -xzf /tmp/canopy-upload.tar.gz && rm /tmp/canopy-upload.tar.gz`);
  } finally {
    try { fs.unlinkSync(tarPath); } catch { /* ignore */ }
  }
}

/**
 * Wait for SSH to become available on a server.
 */
export async function waitForSSH(ip: string, timeoutMs: number = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const conn = await getConnection(ip);
      conn.end();
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`SSH not available on ${ip} after ${timeoutMs / 1000}s`);
}

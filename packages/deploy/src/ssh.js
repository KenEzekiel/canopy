'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { CANOPY_DIR } = require('./config');

const KEYS_DIR = path.join(CANOPY_DIR, 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'canopy_ed25519');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'canopy_ed25519.pub');

/**
 * Generate an ed25519 SSH key pair using ssh-keygen (OpenSSH format).
 * ssh2 requires OpenSSH format, not PKCS8 PEM.
 */
function generateSSHKeyPair() {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

  // Remove old keys if they exist (might be in wrong format)
  if (fs.existsSync(PRIVATE_KEY_PATH)) fs.unlinkSync(PRIVATE_KEY_PATH);
  if (fs.existsSync(PUBLIC_KEY_PATH)) fs.unlinkSync(PUBLIC_KEY_PATH);

  const { execSync } = require('child_process');
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
function ensureSSHKey() {
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    return {
      publicKey: fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim(),
      privateKey: fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8'),
      path: PRIVATE_KEY_PATH,
    };
  }
  return generateSSHKeyPair();
}

/**
 * Get an SSH connection to a server.
 */
function getConnection(ip) {
  const key = ensureSSHKey();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({
      host: ip,
      port: 22,
      username: 'root',
      privateKey: key.privateKey,
      readyTimeout: 30000,
    });
  });
}

/**
 * Execute a command on a remote server via SSH.
 */
async function sshExec(ip, command) {
  const conn = await getConnection(ip);
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) { conn.end(); return reject(err); }
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => {
        conn.end();
        resolve({ stdout, stderr, exitCode: code });
      });
    });
  });
}

/**
 * Upload a directory to a remote server via SFTP.
 * Excludes node_modules, .git, dist, build.
 */
/**
 * Upload a directory to a remote server using tar + scp (via ssh2).
 * Much faster than SFTP file-by-file for projects with many files.
 * Excludes node_modules, .git, dist, build, .next, .cache.
 */
/**
 * Upload a directory to a remote server using tar + native scp.
 * Much faster than ssh2 SFTP. Excludes node_modules, .git, dist, build, .next, .cache.
 */
async function sshUpload(ip, localPath, remotePath) {
  const { execSync } = require('child_process');
  const os = require('os');
  const tarPath = path.join(os.tmpdir(), `canopy-upload-${Date.now()}.tar.gz`);

  try {
    // Create tar locally
    execSync(
      `tar -czf "${tarPath}" --exclude=node_modules --exclude=.git --exclude=dist --exclude=build --exclude=.next --exclude=.cache -C "${localPath}" .`,
      { stdio: 'pipe' }
    );

    // Create remote dir
    await sshExec(ip, `mkdir -p ${remotePath}`);

    // Upload via native scp (fast, uses system SSH)
    execSync(
      `scp -i "${PRIVATE_KEY_PATH}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${tarPath}" root@${ip}:/tmp/canopy-upload.tar.gz`,
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
async function waitForSSH(ip, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const conn = await getConnection(ip);
      conn.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`SSH not available on ${ip} after ${timeoutMs / 1000}s`);
}

module.exports = { generateSSHKeyPair, ensureSSHKey, sshExec, sshUpload, waitForSSH };

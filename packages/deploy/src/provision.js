'use strict';

const { getHetznerToken } = require('./config');

const API_BASE = 'https://api.hetzner.cloud/v1';

const CLOUD_INIT = `#!/bin/bash
apt-get update
apt-get install -y docker.io docker-compose nginx certbot python3-certbot-nginx
systemctl enable docker
systemctl start docker
systemctl enable nginx
systemctl start nginx
mkdir -p /home/canopy
`;

async function hetznerFetch(endpoint, opts = {}) {
  const token = getHetznerToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = body.error?.message || JSON.stringify(body);
    throw new Error(`Hetzner API ${res.status}: ${msg}`);
  }
  return body;
}

/**
 * Upload SSH public key to Hetzner. Returns key ID.
 * Reuses existing key named "canopy-master" if found.
 */
async function uploadSSHKey(publicKey) {
  // Check if already exists
  const { ssh_keys } = await hetznerFetch('/ssh_keys');
  const existing = ssh_keys.find((k) => k.name === 'canopy-master');
  if (existing) return existing.id;

  const { ssh_key } = await hetznerFetch('/ssh_keys', {
    method: 'POST',
    body: JSON.stringify({ name: 'canopy-master', public_key: publicKey }),
  });
  return ssh_key.id;
}

/**
 * Create a CX22 server on Hetzner.
 * @returns {{ serverId: number, ip: string }}
 */
async function createServer({ name, sshKeyId, location = 'sin' }) {
  const { server } = await hetznerFetch('/servers', {
    method: 'POST',
    body: JSON.stringify({
      name: `canopy-${name}`,
      server_type: 'cpx12',
      image: 'ubuntu-24.04',
      ssh_keys: [sshKeyId],
      location,
      user_data: CLOUD_INIT,
      labels: { 'managed-by': 'canopy', app: name },
    }),
  });
  return {
    serverId: server.id,
    ip: server.public_net.ipv4.ip,
  };
}

/**
 * Delete a server by ID.
 */
async function deleteServer(serverId) {
  await hetznerFetch(`/servers/${serverId}`, { method: 'DELETE' });
}

/**
 * Get server info by ID.
 */
async function getServer(serverId) {
  const { server } = await hetznerFetch(`/servers/${serverId}`);
  return server;
}

/**
 * List all Canopy-managed servers.
 */
async function listServers() {
  const { servers } = await hetznerFetch('/servers?label_selector=managed-by%3Dcanopy');
  return servers;
}

module.exports = { uploadSSHKey, createServer, deleteServer, getServer, listServers };

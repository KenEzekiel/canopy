import { getHetznerToken } from './config';

const API_BASE = 'https://api.hetzner.cloud/v1';

const CLOUD_INIT = `#!/bin/bash
apt-get update
apt-get install -y docker.io docker-compose nginx certbot python3-certbot-nginx curl
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 51820/udp
ufw --force enable
systemctl enable docker
systemctl start docker
systemctl enable nginx
systemctl start nginx
mkdir -p /home/canopy
# Install Docker BuildKit (buildx) for secret mounts
BUILDX_VERSION=v0.19.3
mkdir -p /usr/libexec/docker/cli-plugins
curl -fsSL https://github.com/docker/buildx/releases/download/\${BUILDX_VERSION}/buildx-\${BUILDX_VERSION}.linux-amd64 -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx
`;

interface HetznerSSHKey {
  id: number;
  name: string;
  public_key: string;
}

interface HetznerServer {
  id: number;
  public_net: {
    ipv4: { ip: string };
  };
  [key: string]: unknown;
}

interface HetznerErrorBody {
  error?: { message?: string };
}

async function hetznerFetch<T>(endpoint: string, opts: RequestInit = {}): Promise<T> {
  const token = getHetznerToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  const body = await res.json() as T & HetznerErrorBody;
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
export async function uploadSSHKey(publicKey: string): Promise<number> {
  const { ssh_keys } = await hetznerFetch<{ ssh_keys: HetznerSSHKey[] }>('/ssh_keys');
  const existing = ssh_keys.find((k) => k.name === 'canopy-master');
  if (existing) return existing.id;

  const { ssh_key } = await hetznerFetch<{ ssh_key: HetznerSSHKey }>('/ssh_keys', {
    method: 'POST',
    body: JSON.stringify({ name: 'canopy-master', public_key: publicKey }),
  });
  return ssh_key.id;
}


interface CreateServerOpts {
  name: string;
  sshKeyId: number;
  location?: string;
  serverType?: string;
}

interface CreateServerResult {
  serverId: number;
  ip: string;
}

// MVP defaults — configurable later
const DEFAULT_LOCATION = 'hel1';
const DEFAULT_SERVER_TYPE = 'cx23';

/**
 * Create a cx23 server on Hetzner.
 */
export async function createServer({ name, sshKeyId, location = DEFAULT_LOCATION, serverType = DEFAULT_SERVER_TYPE }: CreateServerOpts): Promise<CreateServerResult> {
  const { server } = await hetznerFetch<{ server: HetznerServer }>('/servers', {
    method: 'POST',
    body: JSON.stringify({
      name: `canopy-${name}`,
      server_type: serverType,
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
export async function deleteServer(serverId: number): Promise<void> {
  await hetznerFetch(`/servers/${serverId}`, { method: 'DELETE' });
}

/**
 * Get server info by ID.
 */
export async function getServer(serverId: number): Promise<HetznerServer> {
  const { server } = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
  return server;
}

/**
 * List all Canopy-managed servers.
 */
export async function listServers(): Promise<HetznerServer[]> {
  const { servers } = await hetznerFetch<{ servers: HetznerServer[] }>('/servers?label_selector=managed-by%3Dcanopy');
  return servers;
}

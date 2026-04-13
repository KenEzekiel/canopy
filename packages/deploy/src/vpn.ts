import { sshExec } from './ssh';
import { getDomain } from './config';

/** Strip all characters except alphanumeric, dash, and underscore. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Validate domain format: alphanumeric segments separated by dots/hyphens. */
function validateDomain(domain: string): string {
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain)) {
    throw new Error(`Invalid domain format: ${domain}`);
  }
  return domain;
}

/**
 * Install WireGuard on a server and configure the server-side interface.
 */
export async function setupVPN(ip: string): Promise<{ serverPublicKey: string }> {
  // Install WireGuard
  await sshExec(ip, 'apt-get install -y wireguard');

  // Generate server keys
  await sshExec(ip, `
    mkdir -p /etc/wireguard
    wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
    chmod 600 /etc/wireguard/server_private.key
  `);

  const { stdout: serverPrivKey } = await sshExec(ip, 'cat /etc/wireguard/server_private.key');
  const { stdout: serverPubKey } = await sshExec(ip, 'cat /etc/wireguard/server_public.key');

  // Write server config
  const serverConf = `[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = ${serverPrivKey.trim()}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
`;

  await sshExec(ip, `cat > /etc/wireguard/wg0.conf << 'WG_EOF'\n${serverConf}WG_EOF`);
  await sshExec(ip, 'chmod 600 /etc/wireguard/wg0.conf');

  // Enable IP forwarding (idempotent — only append if not already set)
  await sshExec(ip, 'grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf || echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf');
  await sshExec(ip, 'sysctl -p');
  await sshExec(ip, 'systemctl enable wg-quick@wg0 && systemctl restart wg-quick@wg0');

  // Install dnsmasq for VPN DNS resolution (resolves app domains to VPN IP)
  await sshExec(ip, 'apt-get install -y dnsmasq');
  await sshExec(ip, `cat > /etc/dnsmasq.d/canopy-vpn.conf << 'DNS_EOF'
# Listen only on WireGuard interface
interface=wg0
bind-interfaces
# Upstream DNS for everything else
server=1.1.1.1
server=8.8.8.8
DNS_EOF`);
  await sshExec(ip, 'systemctl enable dnsmasq && systemctl restart dnsmasq');

  return { serverPublicKey: serverPubKey.trim() };
}

/**
 * Add a VPN client peer and return the client config file content.
 * Each client gets a unique IP in the 10.0.0.x range.
 */
export async function addVPNClient(
  ip: string,
  clientName: string,
  clientIndex: number = 2,
): Promise<{ config: string; clientIp: string }> {
  const safeClientName = sanitizeName(clientName);

  // Validate clientIndex range (1 = server, 0 = network, 255 = broadcast)
  if (!Number.isInteger(clientIndex) || clientIndex < 2 || clientIndex > 254) {
    throw new Error(`clientIndex must be between 2 and 254, got: ${clientIndex}`);
  }

  // Generate client keys in a secure temp directory with restricted permissions
  const { stdout: tmpDir } = await sshExec(ip, 'mktemp -d');
  const secureTmp = tmpDir.trim();
  if (!/^\/tmp\/[a-zA-Z0-9._-]+$/.test(secureTmp)) {
    throw new Error(`Unexpected mktemp output: ${secureTmp}`);
  }
  await sshExec(ip, `chmod 700 "${secureTmp}" && wg genkey > "${secureTmp}/client.key" && chmod 600 "${secureTmp}/client.key" && cat "${secureTmp}/client.key" | wg pubkey > "${secureTmp}/client.pub"`);
  const { stdout: clientPrivKey } = await sshExec(ip, `cat "${secureTmp}/client.key"`);
  const { stdout: clientPubKey } = await sshExec(ip, `cat "${secureTmp}/client.pub"`);
  await sshExec(ip, `rm -rf "${secureTmp}"`);

  const clientIp = `10.0.0.${clientIndex}`;

  // Get server public key
  const { stdout: serverPubKey } = await sshExec(ip, 'cat /etc/wireguard/server_public.key');

  // Add peer to server config (idempotent — skip if peer with same name exists)
  const { exitCode: peerExists } = await sshExec(ip, `grep -q "# ${safeClientName}$" /etc/wireguard/wg0.conf`);
  if (peerExists !== 0) {
    const peerBlock = `
[Peer]
# ${safeClientName}
PublicKey = ${clientPubKey.trim()}
AllowedIPs = ${clientIp}/32
`;
    await sshExec(ip, `cat >> /etc/wireguard/wg0.conf << 'PEER_EOF'\n${peerBlock}PEER_EOF`);
  }
  await sshExec(ip, 'bash -c \'wg syncconf wg0 <(wg-quick strip wg0)\' 2>/dev/null || systemctl restart wg-quick@wg0');

  // Build client config
  const config = `[Interface]
PrivateKey = ${clientPrivKey.trim()}
Address = ${clientIp}/24
DNS = 10.0.0.1

[Peer]
PublicKey = ${serverPubKey.trim()}
Endpoint = ${ip}:51820
AllowedIPs = 10.0.0.0/24
PersistentKeepalive = 25
`;

  return { config, clientIp };
}

/**
 * Configure nginx to only listen on the WireGuard interface for a given app.
 * This makes the app only accessible via VPN.
 */
export async function restrictToVPN(ip: string, appName: string, appPort: number): Promise<void> {
  const safeAppName = sanitizeName(appName);
  const domain = validateDomain(`${safeAppName}.${getDomain()}`);

  // Register this domain in dnsmasq (idempotent — only add if not already present)
  const dnsEntry = `address=/${domain}/10.0.0.1`;
  await sshExec(ip, `grep -qF "${dnsEntry}" /etc/dnsmasq.d/canopy-vpn.conf || echo "${dnsEntry}" >> /etc/dnsmasq.d/canopy-vpn.conf`);
  await sshExec(ip, 'systemctl restart dnsmasq');

  // Check if SSL certs exist for this domain
  const { exitCode: certExists } = await sshExec(ip,
    `test -f /etc/letsencrypt/live/${domain}/fullchain.pem`
  );

  const proxyBlock = [
    '    location / {',
    `        proxy_pass http://localhost:${appPort};`,
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '    }',
  ];

  const allowBlock = [
    '    # Allow VPN clients only',
    '    allow 10.0.0.0/24;',
    '    allow 127.0.0.1;',
    '    deny all;',
  ];

  const lines: string[] = [];

  if (certExists === 0) {
    lines.push(
      '# VPN-only app — only listens on WireGuard interface',
      'server {',
      '    listen 10.0.0.1:443 ssl;',
      `    server_name ${domain} 10.0.0.1;`,
      `    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;`,
      `    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;`,
      '    include /etc/letsencrypt/options-ssl-nginx.conf;',
      '    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;',
      ...allowBlock,
      ...proxyBlock,
      '}',
      '',
      'server {',
      '    listen 10.0.0.1:80;',
      `    server_name ${domain} 10.0.0.1;`,
      ...allowBlock,
      '    return 301 https://$host$request_uri;',
      '}',
    );
  } else {
    lines.push(
      'server {',
      '    listen 10.0.0.1:80;',
      `    server_name ${domain} 10.0.0.1;`,
      ...allowBlock,
      ...proxyBlock,
      '}',
    );
  }

  const nginxConf = lines.join('\n');
  await sshExec(ip, `cat > /etc/nginx/sites-available/${safeAppName} << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`);
  await sshExec(ip, `ln -sf /etc/nginx/sites-available/${safeAppName} /etc/nginx/sites-enabled/${safeAppName}`);
  await sshExec(ip, `nginx -t && systemctl reload nginx`);
}

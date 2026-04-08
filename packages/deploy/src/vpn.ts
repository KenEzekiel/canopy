import { sshExec } from './ssh';
import { getDomain } from './config';

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

  // Enable IP forwarding and start WireGuard
  await sshExec(ip, 'echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf && sysctl -p');
  await sshExec(ip, 'systemctl enable wg-quick@wg0 && systemctl start wg-quick@wg0');

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
  // Generate client keys on server (single pipeline, no shell interpolation)
  await sshExec(ip, 'wg genkey > /tmp/canopy-client.key && cat /tmp/canopy-client.key | wg pubkey > /tmp/canopy-client.pub');
  const { stdout: clientPrivKey } = await sshExec(ip, 'cat /tmp/canopy-client.key');
  const { stdout: clientPubKey } = await sshExec(ip, 'cat /tmp/canopy-client.pub');
  await sshExec(ip, 'rm -f /tmp/canopy-client.key /tmp/canopy-client.pub');

  const clientIp = `10.0.0.${clientIndex}`;

  // Get server public key
  const { stdout: serverPubKey } = await sshExec(ip, 'cat /etc/wireguard/server_public.key');

  // Add peer to server config
  const peerBlock = `
[Peer]
# ${clientName}
PublicKey = ${clientPubKey.trim()}
AllowedIPs = ${clientIp}/32
`;
  await sshExec(ip, `echo '${peerBlock}' >> /etc/wireguard/wg0.conf`);
  await sshExec(ip, 'wg syncconf wg0 <(wg-quick strip wg0) 2>/dev/null || systemctl restart wg-quick@wg0');

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
  const domain = `${appName}.${getDomain()}`;

  // Register this domain in dnsmasq to resolve to VPN IP
  await sshExec(ip, `echo "address=/${domain}/10.0.0.1" >> /etc/dnsmasq.d/canopy-vpn.conf`);
  await sshExec(ip, 'systemctl restart dnsmasq');

  // Check if SSL certs exist for this domain
  const { exitCode: certExists } = await sshExec(ip,
    `test -f /etc/letsencrypt/live/${domain}/fullchain.pem`
  );

  // Strategy: nginx listens normally on all interfaces with SSL.
  // We use iptables to only allow port 443/80 traffic for this domain
  // from the wg0 interface (VPN) and drop public traffic.
  // This works because WireGuard clients route 10.0.0.0/24 through the tunnel,
  // and we add a PREROUTING rule to mark VPN traffic.

  // Actually, the simplest reliable approach:
  // 1. Nginx listens on all interfaces (SSL works, domain works)
  // 2. Use nginx's $remote_addr + geo module to check if client is on VPN
  // 3. VPN clients connect to 10.0.0.1 (the server's VPN IP) directly
  // 4. We tell the user to add a /etc/hosts entry OR use the VPN IP

  // For production: nginx allows both VPN subnet (10.0.0.0/24) AND
  // connections arriving on the wg0 interface. We use realip module
  // to check the actual source.

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
      '# VPN-only app — accessible via https://10.0.0.1 when connected to VPN',
      'server {',
      '    listen 443 ssl;',
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
      '    listen 80;',
      '    listen 10.0.0.1:80;',
      `    server_name ${domain} 10.0.0.1;`,
      ...allowBlock,
      '    return 301 https://$host$request_uri;',
      '}',
    );
  } else {
    lines.push(
      'server {',
      '    listen 80;',
      '    listen 10.0.0.1:80;',
      `    server_name ${domain} 10.0.0.1;`,
      ...allowBlock,
      ...proxyBlock,
      '}',
    );
  }

  const nginxConf = lines.join('\n');
  await sshExec(ip, `cat > /etc/nginx/sites-available/${appName} << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`);
  await sshExec(ip, `nginx -t && systemctl reload nginx`);
}

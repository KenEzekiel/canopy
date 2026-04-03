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
DNS = 1.1.1.1

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
  const nginxConf = `server {
    listen 10.0.0.1:80;
    server_name ${appName}.${getDomain()};
    location / {
        proxy_pass http://localhost:${appPort};
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
    }
}`;
  await sshExec(ip, `cat > /etc/nginx/sites-available/${appName} << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`);
  await sshExec(ip, `nginx -t && systemctl reload nginx`);
}

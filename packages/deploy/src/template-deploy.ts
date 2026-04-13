import { loadTemplate, type Template } from './templates';
import { ensureSSHKey, sshExec, waitForSSH, setSSHConfig } from './ssh';
import { uploadSSHKey, createServer } from './provision';
import { getDomain } from './config';
import {
  getDeployment, saveDeployment, findAvailableServer,
  getNextPort, saveServer, getServerInfo,
} from './state';
import { setupVPN, addVPNClient, restrictToVPN } from './vpn';
import { validateAppName, validateDomain, validateEnvKey, validateEmail } from './validation';

const noop = (): void => {};

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export interface TemplateDeployOpts {
  templateName: string;
  appName: string;
  env?: Record<string, string>;
  serverIp?: string;
  sshPort?: number;
  sshUser?: string;
  region?: string;
  private?: boolean;
  log?: (phase: string, message: string) => void;
}

export interface DeployResult {
  status: string;
  url?: string;
  ip?: string;
  port?: number;
  template?: string;
  error?: string;
  vpnConfig?: string;
}

export async function deployTemplate({
  templateName, appName, env = {}, serverIp: existingIp, sshPort, sshUser, region,
  private: isPrivate = false, log = noop,
}: TemplateDeployOpts): Promise<DeployResult> {
  validateAppName(appName);
  const template = loadTemplate(templateName);
  const domain = getDomain();
  validateDomain(domain);
  const appDomain = `${appName}.${domain}`;

  // Validate required env vars
  const missing = template.env_required.filter((e) => !env[e.name]);
  if (missing.length > 0) {
    return {
      status: 'missing-env',
      error: `Missing required env vars: ${missing.map((e) => `${e.name} (${e.description})`).join(', ')}`,
    };
  }

  // Merge defaults from optional env vars
  const fullEnv = { ...env };
  for (const opt of template.env_optional) {
    if (!fullEnv[opt.name] && opt.default) fullEnv[opt.name] = opt.default;
  }
  for (const key of Object.keys(fullEnv)) validateEnvKey(key);

  // Apply SSH config if provided
  if (existingIp) {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(existingIp)) {
      throw new Error(`Invalid server IP address: ${existingIp}`);
    }
    setSSHConfig({ port: sshPort, username: sshUser });
  }

  // Resolve server
  let serverIp: string;
  let serverId: string;
  let appPort: number;

  if (existingIp) {
    // Reuse provided server
    try { await sshExec(existingIp, 'echo ok'); } catch {
      throw new Error(`Server ${existingIp} is unreachable. Verify the IP, SSH port, and SSH user.`);
    }
    // Find serverId from state by IP, or create external entry
    const available = findAvailableServer();
    if (available && available.ip === existingIp) {
      serverId = `srv-${available.id}`;
      appPort = getNextPort(serverId);
    } else {
      serverId = `ext-${existingIp.replace(/\./g, '-')}`;
      const existingServer = getServerInfo(serverId);
      if (existingServer) {
        appPort = getNextPort(serverId);
      } else {
        appPort = 3001;
        saveServer(serverId, {
          id: 0, ip: existingIp, location: 'external',
          createdAt: new Date().toISOString(), apps: [],
        });
      }
    }
    serverIp = existingIp;
    log('state', `Reusing server ${serverIp} (port ${appPort})`);
  } else {
    const available = findAvailableServer();
    if (available) {
      try {
        await sshExec(available.ip, 'echo ok');
        serverIp = available.ip;
        serverId = `srv-${available.id}`;
        appPort = getNextPort(serverId);
        log('state', `Adding ${appName} to existing server ${serverIp} (port ${appPort})`);
      } catch {
        log('state', `Existing server unreachable, provisioning new...`);
        const r = await provisionNew(appName, log, region);
        serverIp = r.serverIp; serverId = r.serverId; appPort = 3001;
      }
    } else {
      const r = await provisionNew(appName, log, region);
      serverIp = r.serverIp; serverId = r.serverId; appPort = 3001;
    }
  }

  // Save state early
  saveDeployment(appName, {
    serverId, serverIp, port: appPort, domain: appDomain,
    framework: `template:${templateName}`, lastDeploy: '',
    createdAt: new Date().toISOString(),
  });

  // Clone repo
  const remotePath = `/home/canopy/${appName}`;
  log('clone', `Cloning ${template.repo}...`);
  await sshExec(serverIp, `rm -rf ${remotePath}`);
  const cloneResult = await sshExec(serverIp, `git clone --depth 1 ${shellEscape(template.repo)} ${remotePath}`);
  if (cloneResult.exitCode !== 0) {
    return { status: 'clone-failed', error: cloneResult.stderr || cloneResult.stdout };
  }

  // Write env file via base64
  if (Object.keys(fullEnv).length > 0) {
    const content = Object.entries(fullEnv).map(([k, v]) => {
      const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return `${k}="${escaped}"`;
    }).join('\n');
    const encoded = Buffer.from(content).toString('base64');
    await sshExec(serverIp, `echo ${shellEscape(encoded)} | base64 -d > ${remotePath}/.env`);
    await sshExec(serverIp, `chmod 600 ${remotePath}/.env`);
    log('env', 'Env file written');
  }

  // Create volumes
  for (const vol of template.volumes) {
    await sshExec(serverIp, `mkdir -p ${shellEscape(vol.host)}`);
  }

  // Deploy based on type
  const containerPort = template.ports[0] || 3000;

  if (template.type === 'docker-compose') {
    log('deploy', 'Running docker compose up...');
    const composeFile = template.compose_file || 'docker-compose.yml';
    const result = await sshExec(serverIp, `cd ${remotePath} && docker compose -f ${shellEscape(composeFile)} up -d`);
    if (result.exitCode !== 0) {
      return { status: 'deploy-failed', error: result.stderr || result.stdout };
    }
  } else if (template.type === 'image') {
    log('deploy', 'Running docker container...');
    await sshExec(serverIp, `docker stop ${appName} 2>/dev/null; docker rm ${appName} 2>/dev/null`);
    const volFlags = template.volumes.map((v) => `-v ${shellEscape(v.host)}:${shellEscape(v.container)}`).join(' ');
    const envFileFlag = Object.keys(fullEnv).length > 0 ? `--env-file ${remotePath}/.env` : '';
    const result = await sshExec(serverIp,
      `docker run -d --name ${appName} --restart unless-stopped ${envFileFlag} ${volFlags} -p ${appPort}:${containerPort} ${template.repo.split('/').pop()}:latest`
    );
    if (result.exitCode !== 0) {
      // Try pulling the image first
      log('deploy', 'Pulling image...');
      const imageName = template.repo.replace('https://github.com/', 'ghcr.io/');
      await sshExec(serverIp, `docker pull ${imageName}:latest 2>/dev/null || docker pull ${template.repo.split('/').pop()}:latest 2>/dev/null`);
      const retry = await sshExec(serverIp,
        `docker run -d --name ${appName} --restart unless-stopped ${envFileFlag} ${volFlags} -p ${appPort}:${containerPort} ${template.repo.split('/').pop()}:latest`
      );
      if (retry.exitCode !== 0) {
        return { status: 'deploy-failed', error: retry.stderr || retry.stdout };
      }
    }
  }
  log('deploy', 'Container(s) running');

  // Configure nginx
  log('nginx', 'Configuring reverse proxy...');
  const nginxConf = [
    'server {',
    '    listen 80;',
    `    server_name ${appDomain};`,
    '    location / {',
    `        proxy_pass http://localhost:${appPort};`,
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '    }',
    '}',
  ].join('\n');
  await sshExec(serverIp, `mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled`);
  await sshExec(serverIp, `cat > /etc/nginx/sites-available/${appName} << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`);
  await sshExec(serverIp, `ln -sf /etc/nginx/sites-available/${appName} /etc/nginx/sites-enabled/`);
  await sshExec(serverIp, `nginx -t && systemctl reload nginx`);
  log('nginx', 'Nginx configured');

  // SSL
  log('ssl', `Setting up SSL for ${appDomain}...`);
  const sslEmail = process.env.CANOPY_SSL_EMAIL || `admin@${domain}`;
  validateEmail(sslEmail);
  const sslResult = await sshExec(serverIp,
    `certbot --nginx -d ${shellEscape(appDomain)} --non-interactive --agree-tos -m ${shellEscape(sslEmail)} 2>&1`
  );
  if (sslResult.exitCode !== 0) {
    log('ssl', `SSL setup failed (non-blocking): ${sslResult.stdout.slice(-200)}`);
  } else {
    log('ssl', 'SSL configured');
  }

  // VPN
  let vpnConfig: string | undefined;
  if (isPrivate) {
    log('vpn', 'Setting up WireGuard VPN...');
    const srvState = getServerInfo(serverId);
    if (!srvState?.vpnSetup) {
      await setupVPN(serverIp);
      if (srvState) {
        srvState.vpnSetup = true;
        srvState.vpnNextClientIndex = 2;
        saveServer(serverId, srvState);
      }
    }
    const clientIndex = srvState?.vpnNextClientIndex || 2;
    const vpnResult = await addVPNClient(serverIp, appName, clientIndex);
    vpnConfig = vpnResult.config;
    const updatedSrv = getServerInfo(serverId);
    if (updatedSrv) {
      updatedSrv.vpnNextClientIndex = clientIndex + 1;
      saveServer(serverId, updatedSrv);
    }
    await restrictToVPN(serverIp, appName, appPort);
    log('vpn', 'App is now VPN-only');
  }

  // Update state
  saveDeployment(appName, {
    serverId, serverIp, port: appPort, domain: appDomain,
    framework: `template:${templateName}`, lastDeploy: new Date().toISOString(),
    createdAt: getDeployment(appName)?.createdAt || new Date().toISOString(),
    private: isPrivate,
  });
  log('state', 'Deployment state saved');

  return {
    status: 'deployed',
    url: `https://${appDomain}`,
    ip: serverIp,
    port: appPort,
    template: templateName,
    vpnConfig,
  };
}

async function provisionNew(
  name: string,
  log: (phase: string, msg: string) => void,
  region?: string,
): Promise<{ serverIp: string; serverId: string }> {
  log('provision', 'Generating SSH key...');
  const sshKey = ensureSSHKey();
  log('provision', 'Uploading SSH key to Hetzner...');
  const sshKeyId = await uploadSSHKey(sshKey.publicKey);
  const loc = region || 'hel1';
  log('provision', `Creating server (cx23, ${loc})...`);
  const server = await createServer({ name, sshKeyId, location: loc });
  const serverIp = server.ip;
  const serverId = `srv-${server.serverId}`;
  log('provision', `Server created: ${serverIp}`);
  saveServer(serverId, {
    id: server.serverId, ip: serverIp, location: loc,
    createdAt: new Date().toISOString(), apps: [],
  });
  log('provision', 'Waiting for SSH...');
  await waitForSSH(serverIp, 180000);
  log('provision', 'Server ready');
  return { serverIp, serverId };
}

import fs from 'fs';
import path from 'path';
import { scan, type ScanResult } from '@canopy/scanner';
import { detectFramework } from './detect';
import { generateDockerfile, getContainerPort } from './dockerfile';
import {
  getDeployment, saveDeployment, findAvailableServer,
  getNextPort, saveServer, getServerInfo, type AppInfo,
} from './state';
import { ensureSSHKey, sshExec, sshUpload, rsyncUpload, waitForSSH, setSSHConfig } from './ssh';
import { uploadSSHKey, createServer } from './provision';
import { getDomain } from './config';
import { setupVPN, addVPNClient, restrictToVPN } from './vpn';
import { validateAppName } from './validation';
import type { Framework } from './detect';

const noop = (): void => {};

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function validateEnvVars(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    if (!ENV_KEY_REGEX.test(key)) {
      throw new Error(`Invalid env var key "${key}". Use letters, numbers, and underscores only.`);
    }
  }
}

function failWithCleanupHint(name: string, status: string, error: string): DeployResult {
  return {
    status,
    error: `${error}\n\nServer was provisioned but deploy failed. Run \`canopy destroy ${name}\` to clean up, or retry with \`canopy deploy\`.`,
  };
}

export interface DeployOpts {
  projectPath: string;
  name: string;
  env?: Record<string, string>;
  force?: boolean;
  newServer?: boolean;
  region?: string;
  noSsl?: boolean;
  private?: boolean;
  server?: string;
  sshPort?: number;
  sshUser?: string;
  log?: (phase: string, message: string) => void;
}

export interface DeployResult {
  status: string;
  reason?: string;
  scan?: ScanResult;
  url?: string;
  ip?: string;
  port?: number;
  framework?: Framework;
  error?: string;
  vpnConfig?: string;
  sslFailed?: boolean;
  newServer?: boolean;
}

export async function deploy({ projectPath, name, env, force = false, newServer = false, region, noSsl = false, private: isPrivate = false, server, sshPort, sshUser, log = noop }: DeployOpts): Promise<DeployResult> {
  validateAppName(name);
  if (env) validateEnvVars(env);

  // Validate and apply SSH config for existing server
  if (server) {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(server)) {
      throw new Error(`Invalid server IP address: ${server}`);
    }
    setSSHConfig({ port: sshPort, username: sshUser });
  }

  const absPath = path.resolve(projectPath);
  const domain = getDomain();
  const appDomain = `${name}.${domain}`;

  // 1. Scan
  log('scan', 'Running security scan...');
  const scanResult: ScanResult = scan(absPath);
  log('scan', `Score: ${scanResult.score}/100 (${scanResult.findings.length} findings)`);

  if (scanResult.findings.some((f) => f.severity === 'critical') && !force) {
    log('scan', 'Blocked — critical issues found (use --force to override)');
    return { status: 'blocked', reason: 'Critical security issues found. Fix them or use --force.', scan: scanResult };
  }
  if (force && scanResult.findings.some((f) => f.severity === 'critical')) {
    log('scan', 'Warning: deploying with critical issues (--force)');
  }

  // 2. Detect framework
  const framework: Framework = detectFramework(absPath);
  log('detect', `Framework: ${framework}`);

  // 3. Resolve server — existing app, existing server with capacity, or new
  const existingApp = getDeployment(name);
  let serverIp: string;
  let serverId: string;
  let appPort: number;
  let isRedeploy = false;

  if (existingApp) {
    // Redeploy to same server + same port — verify server is reachable
    serverIp = existingApp.serverIp;
    serverId = existingApp.serverId;
    appPort = existingApp.port;
    isRedeploy = true;
    log('state', `Redeploying ${name} to ${serverIp}:${appPort}`);
    try {
      await sshExec(serverIp, 'echo ok');
    } catch {
      throw new Error(`Server ${serverIp} is unreachable. It may have been deleted. Run \`canopy destroy ${name}\` to clean up state, then redeploy.`);
    }
  } else if (server) {
    // --server flag: use existing server, skip provisioning
    serverIp = server;
    serverId = `ext-${server.replace(/\./g, '-')}`;
    log('state', `Using existing server ${serverIp}...`);
    try {
      await sshExec(serverIp, 'echo ok');
    } catch {
      throw new Error(`Server ${serverIp} is unreachable. Verify the IP, SSH port, and SSH user.`);
    }
    // Find or assign port
    const existingServer = getServerInfo(serverId);
    if (existingServer) {
      appPort = getNextPort(serverId);
    } else {
      appPort = 3001;
      saveServer(serverId, {
        id: 0, ip: serverIp, location: 'external',
        createdAt: new Date().toISOString(), apps: [],
      });
    }
    log('state', `Deploying ${name} to ${serverIp}:${appPort}`);
  } else if (!newServer) {
    // Try to find an existing server with capacity
    const available = findAvailableServer();
    if (available) {
      // Verify the server is actually reachable before assigning
      try {
        await sshExec(available.ip, 'echo ok');
        serverIp = available.ip;
        serverId = `srv-${available.id}`;
        appPort = getNextPort(serverId);
        log('state', `Adding ${name} to existing server ${serverIp} (port ${appPort})`);
      } catch {
        log('state', `Existing server ${available.ip} unreachable, provisioning new...`);
        const result = await provisionNewServer(name, log, region);
        serverIp = result.serverIp;
        serverId = result.serverId;
        appPort = 3001;
      }
    } else {
      // No server available — provision new
      const result = await provisionNewServer(name, log, region);
      serverIp = result.serverIp;
      serverId = result.serverId;
      appPort = 3001;
    }
  } else {
    // --new flag: force new server
    const result = await provisionNewServer(name, log, region);
    serverIp = result.serverIp;
    serverId = result.serverId;
    appPort = 3001;
  }

  // Save app state early (so server is tracked even if deploy fails)
  if (!isRedeploy) {
    saveDeployment(name, {
      serverId,
      serverIp,
      port: appPort,
      domain: appDomain,
      framework,
      lastDeploy: '',
      createdAt: new Date().toISOString(),
    });
    log('state', 'App tracked in state');
  }

  // 4. Generate Dockerfile if not present
  const hasDockerfile = fs.existsSync(path.join(absPath, 'Dockerfile'));
  let generatedDockerfile: string | null = null;
  if (!hasDockerfile) {
    generatedDockerfile = generateDockerfile(framework, absPath);
    log('dockerfile', `Generated Dockerfile for ${framework}`);
  } else {
    log('dockerfile', 'Using existing Dockerfile');
  }

  // 5. Upload project
  const remotePath = `/home/canopy/${name}`;
  if (isRedeploy) {
    log('upload', 'Uploading changes (rsync)...');
    const t = Date.now();
    await rsyncUpload(serverIp, absPath, remotePath);
    log('upload', `Upload complete (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } else {
    log('upload', 'Uploading project (tar + scp)...');
    await sshExec(serverIp, `rm -rf ${remotePath}`);
    const t = Date.now();
    await sshUpload(serverIp, absPath, remotePath);
    log('upload', `Upload complete (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }

  if (generatedDockerfile) {
    await sshExec(serverIp, `cat > ${remotePath}/Dockerfile << 'DOCKERFILE_EOF'\n${generatedDockerfile}DOCKERFILE_EOF`);
    log('dockerfile', 'Dockerfile written to server');
  }

  // 5b. Write env vars as a BuildKit secret file (never touches Docker layers)
  const hasEnvVars = env && Object.keys(env).length > 0;
  const envSecretPath = `/tmp/canopy-${name}-build.env`;
  if (hasEnvVars) {
    const envContent = Object.entries(env!).map(([k, v]) => `${k}=${v}`).join('\n');
    const encoded = Buffer.from(envContent).toString('base64');
    await sshExec(serverIp, `(umask 077; echo ${shellEscape(encoded)} | base64 -d > ${envSecretPath})`);
    log('env', 'Env secret file created for build');
  }

  // 6. Build Docker image (with BuildKit secret mount if env vars present)
  log('build', 'Building Docker image...');
  const buildStart = Date.now();
  const secretFlag = hasEnvVars ? `--secret id=env,src=${envSecretPath}` : '';
  const buildResult = await sshExec(serverIp,
    `cd ${remotePath} && DOCKER_BUILDKIT=1 docker build ${secretFlag} -t ${name} .`
  );

  // Clean up secret file immediately after build
  if (hasEnvVars) {
    await sshExec(serverIp, `rm -f ${envSecretPath}`);
    log('env', 'Build secret file cleaned up');
  }
  const buildTime = ((Date.now() - buildStart) / 1000).toFixed(1);

  if (buildResult.exitCode !== 0) {
    log('build', `Build failed after ${buildTime}s`);
    return failWithCleanupHint(name, 'build-failed', buildResult.stderr || buildResult.stdout);
  }
  log('build', `Build complete (${buildTime}s)`);

  // 7. Stop old container + start new
  log('container', 'Stopping old container (if any)...');
  await sshExec(serverIp, `docker stop ${name} 2>/dev/null; docker rm ${name} 2>/dev/null`);

  const internalPort = getContainerPort(framework);

  // Write env vars to file on server
  let envFileFlag = '';
  if (env && Object.keys(env).length > 0) {
    const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
    const encoded = Buffer.from(content).toString('base64');
    await sshExec(serverIp, `(umask 077; echo ${shellEscape(encoded)} | base64 -d > /tmp/${name}.env)`);
    envFileFlag = `--env-file /tmp/${name}.env`;
  }

  log('container', `Starting container (${appPort}:${internalPort})...`);
  const runResult = await sshExec(serverIp,
    `docker run -d --name ${name} --restart unless-stopped ${envFileFlag} -p ${appPort}:${internalPort} ${name}`
  );

  if (envFileFlag) await sshExec(serverIp, `rm -f /tmp/${name}.env`);

  if (runResult.exitCode !== 0) {
    log('container', 'Container failed to start');
    return failWithCleanupHint(name, 'run-failed', runResult.stderr || runResult.stdout);
  }

  // Post-deploy health check: wait, verify container is running, check HTTP response
  log('container', 'Verifying container health...');
  await new Promise<void>((r) => setTimeout(r, 4000));
  const inspectResult = await sshExec(serverIp,
    `docker inspect --format='{{.State.Status}}' ${name} 2>/dev/null`
  );
  const containerState = inspectResult.stdout.trim();
  if (containerState !== 'running') {
    const logsResult = await sshExec(serverIp, `docker logs --tail 20 ${name} 2>&1`);
    return failWithCleanupHint(name, 'run-failed',
      `Container exited (state: ${containerState}).\n\nLast 20 lines of logs:\n${logsResult.stdout}`);
  }
  const curlResult = await sshExec(serverIp,
    `curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:${appPort} 2>/dev/null || echo "000"`
  );
  const httpCode = curlResult.stdout.trim();
  if (httpCode === '000') {
    log('container', `Container running but not responding on port ${appPort} (may still be starting)`);
  } else {
    log('container', `Container healthy (HTTP ${httpCode})`);
  }
  log('container', 'Container running');

  // 8. Configure nginx for this app
  log('nginx', 'Configuring reverse proxy...');
  const nginxConf = [
    'server {',
    '    listen 80;',
    `    server_name ${appDomain} ${serverIp};`,
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
  // Remove Ubuntu's default nginx config and any stale defaults to avoid default_server conflict
  await sshExec(serverIp, `rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default`);
  await sshExec(serverIp, `cat > /etc/nginx/sites-available/${name} << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`);
  await sshExec(serverIp, `ln -sf /etc/nginx/sites-available/${name} /etc/nginx/sites-enabled/`);

  // Ensure a default catch-all exists (drops unmatched requests)
  await sshExec(serverIp, `cat > /etc/nginx/sites-available/00-default << 'NGINX_EOF'
server {
    listen 80 default_server;
    server_name _;
    return 444;
}
NGINX_EOF`);
  await sshExec(serverIp, `ln -sf /etc/nginx/sites-available/00-default /etc/nginx/sites-enabled/`);

  await sshExec(serverIp, `nginx -t && systemctl reload nginx`);
  log('nginx', 'Nginx configured');

  // 9. SSL via certbot (unless --no-ssl)
  let sslFailed = false;
  if (!noSsl) {
    log('ssl', `Setting up SSL for ${appDomain}...`);
    const sslEmail = process.env.CANOPY_SSL_EMAIL || `admin@${domain}`;
    const sslResult = await sshExec(serverIp,
      `certbot --nginx -d ${appDomain} --non-interactive --agree-tos -m ${sslEmail} 2>&1`
    );
    if (sslResult.exitCode !== 0) {
      sslFailed = true;
      log('ssl', `SSL setup failed (non-blocking): ${sslResult.stdout.slice(-200)}`);
    } else {
      log('ssl', 'SSL configured');
    }
  } else {
    log('ssl', 'SSL skipped (--no-ssl)');
  }

  // 10. VPN setup (if --private)
  let vpnConfig: string | undefined;
  if (isPrivate) {
    log('vpn', 'Setting up WireGuard VPN...');

    // Check if VPN is already set up on this server
    const srvState = getServerInfo(serverId);
    if (!srvState?.vpnSetup) {
      log('vpn', 'Installing WireGuard on server...');
      await setupVPN(serverIp);
      // Update server state
      if (srvState) {
        srvState.vpnSetup = true;
        srvState.vpnNextClientIndex = 2;
        saveServer(serverId, srvState);
      }
      log('vpn', 'WireGuard installed');
    }

    // Add VPN client for this app
    const clientIndex = srvState?.vpnNextClientIndex || 2;
    log('vpn', `Adding VPN client (10.0.0.${clientIndex})...`);
    const vpnResult = await addVPNClient(serverIp, name, clientIndex);
    vpnConfig = vpnResult.config;

    // Update server state with next client index
    const updatedSrv = getServerInfo(serverId);
    if (updatedSrv) {
      updatedSrv.vpnNextClientIndex = clientIndex + 1;
      saveServer(serverId, updatedSrv);
    }

    // Restrict nginx to VPN interface only
    log('vpn', 'Restricting app to VPN access only...');
    await restrictToVPN(serverIp, name, appPort);
    log('vpn', 'App is now VPN-only');
  }

  // 11. Update state
  saveDeployment(name, {
    serverId,
    serverIp,
    port: appPort,
    domain: appDomain,
    framework,
    lastDeploy: new Date().toISOString(),
    createdAt: getDeployment(name)?.createdAt || new Date().toISOString(),
    private: isPrivate,
  });
  log('state', 'Deployment state saved');

  const protocol = (noSsl || sslFailed) ? 'http' : 'https';
  return {
    status: 'deployed',
    url: `${protocol}://${appDomain}`,
    ip: serverIp,
    port: appPort,
    framework,
    scan: scanResult,
    vpnConfig,
    sslFailed,
    newServer: !isRedeploy && !server,
  };
}

async function provisionNewServer(
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
  log('provision', `Server created: ${serverIp} (ID: ${server.serverId})`);

  // Save server to state immediately
  saveServer(serverId, {
    id: server.serverId,
    ip: serverIp,
    location: loc,
    createdAt: new Date().toISOString(),
    apps: [],
  });

  log('provision', 'Waiting for SSH (cloud-init)...');
  await waitForSSH(serverIp, 180000);
  log('provision', 'Server ready');

  return { serverIp, serverId };
}

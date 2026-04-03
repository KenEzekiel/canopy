import fs from 'fs';
import path from 'path';
import { scan, type ScanResult } from '@canopy/scanner';
import { detectFramework } from './detect';
import { generateDockerfile, getContainerPort } from './dockerfile';
import {
  getDeployment, saveDeployment, findAvailableServer,
  getNextPort, saveServer, type AppInfo,
} from './state';
import { ensureSSHKey, sshExec, sshUpload, rsyncUpload, waitForSSH } from './ssh';
import { uploadSSHKey, createServer } from './provision';
import type { Framework } from './detect';

const noop = (): void => {};

const APP_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function validateAppName(name: string): void {
  if (!APP_NAME_REGEX.test(name) || name.length > 63) {
    throw new Error(`Invalid app name "${name}". Use lowercase letters, numbers, and hyphens only (e.g. "my-app").`);
  }
}

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
}

export async function deploy({ projectPath, name, env, force = false, newServer = false, region, log = noop }: DeployOpts): Promise<DeployResult> {
  validateAppName(name);
  if (env) validateEnvVars(env);
  const absPath = path.resolve(projectPath);

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
    // Redeploy to same server + same port
    serverIp = existingApp.serverIp;
    serverId = existingApp.serverId;
    appPort = existingApp.port;
    isRedeploy = true;
    log('state', `Redeploying ${name} to ${serverIp}:${appPort}`);
  } else if (!newServer) {
    // Try to find an existing server with capacity
    const available = findAvailableServer();
    if (available) {
      serverIp = available.ip;
      serverId = `srv-${available.id}`;
      appPort = getNextPort(serverId);
      log('state', `Adding ${name} to existing server ${serverIp} (port ${appPort})`);
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
      domain: `${name}.canopy.sh`,
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

  // 6. Build Docker image
  log('build', 'Building Docker image...');
  const buildStart = Date.now();
  const buildResult = await sshExec(serverIp, `cd ${remotePath} && docker build -t ${name} .`);
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
    await sshExec(serverIp, `cat > /tmp/${name}.env << 'ENVFILE_EOF'\n${content}\nENVFILE_EOF`);
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
  log('container', 'Container running');

  // 8. Configure nginx for this app
  log('nginx', 'Configuring reverse proxy...');
  const nginxConf = `server {
    listen 80;
    server_name ${name}.canopy.sh;
    location / {
        proxy_pass http://localhost:${appPort};
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
    }
}`;
  await sshExec(serverIp, `mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled`);
  await sshExec(serverIp, `cat > /etc/nginx/sites-available/${name} << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`);
  await sshExec(serverIp, `ln -sf /etc/nginx/sites-available/${name} /etc/nginx/sites-enabled/`);
  await sshExec(serverIp, `nginx -t && systemctl reload nginx`);
  log('nginx', 'Nginx configured');

  // 9. Update state
  saveDeployment(name, {
    serverId,
    serverIp,
    port: appPort,
    domain: `${name}.canopy.sh`,
    framework,
    lastDeploy: new Date().toISOString(),
    createdAt: getDeployment(name)?.createdAt || new Date().toISOString(),
  });
  log('state', 'Deployment state saved');

  return {
    status: 'deployed',
    url: `https://${name}.canopy.sh`,
    ip: serverIp,
    port: appPort,
    framework,
    scan: scanResult,
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

import fs from 'fs';
import path from 'path';
import { scan, type ScanResult } from '@canopy/scanner';
import { detectFramework } from './detect';
import { generateDockerfile, getContainerPort } from './dockerfile';
import { getDeployment, saveDeployment } from './state';
import { ensureSSHKey, sshExec, sshUpload, waitForSSH } from './ssh';
import { uploadSSHKey, createServer } from './provision';
import type { DeploymentInfo } from './state';
import type { Framework } from './detect';

const noop = (): void => {};

interface DeployOpts {
  projectPath: string;
  name: string;
  env?: Record<string, string>;
  log?: (phase: string, message: string) => void;
}

interface DeployResult {
  status: string;
  reason?: string;
  scan?: ScanResult;
  url?: string;
  ip?: string;
  framework?: Framework;
  error?: string;
}

/**
 * Deploy a project to a Hetzner VPS.
 */
export async function deploy({ projectPath, name, env, log = noop }: DeployOpts): Promise<DeployResult> {
  const absPath = path.resolve(projectPath);

  // 1. Scan
  log('scan', 'Running security scan...');
  const scanResult: ScanResult = scan(absPath);
  log('scan', `Score: ${scanResult.score}/100 (${scanResult.findings.length} findings)`);

  if (scanResult.findings.some((f) => f.severity === 'critical')) {
    log('scan', 'Blocked — critical issues found');
    return {
      status: 'blocked',
      reason: 'Critical security issues found. Fix them before deploying.',
      scan: scanResult,
    };
  }

  // 2. Detect framework
  const framework: Framework = detectFramework(absPath);
  log('detect', `Framework: ${framework}`);

  // 3. Check state
  let deployment = getDeployment(name);
  let serverIp: string;
  let serverId: number;

  if (deployment) {
    serverIp = deployment.serverIp;
    serverId = deployment.serverId;
    log('state', `Redeploying to existing server ${serverIp}`);
  } else {
    log('provision', 'Generating SSH key...');
    const sshKey = ensureSSHKey();

    log('provision', 'Uploading SSH key to Hetzner...');
    const sshKeyId = await uploadSSHKey(sshKey.publicKey);

    log('provision', 'Creating server (cpx12, Singapore)...');
    const server = await createServer({ name, sshKeyId });
    serverIp = server.ip;
    serverId = server.serverId;
    log('provision', `Server created: ${serverIp} (ID: ${serverId})`);

    log('provision', 'Waiting for SSH (cloud-init installing Docker + nginx)...');
    await waitForSSH(serverIp, 180000);
    log('provision', 'Server ready');
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
  log('upload', 'Cleaning remote directory...');
  await sshExec(serverIp, `rm -rf ${remotePath}`);

  log('upload', 'Uploading project (tar + scp)...');
  const uploadStart = Date.now();
  await sshUpload(serverIp, absPath, remotePath);
  log('upload', `Upload complete (${((Date.now() - uploadStart) / 1000).toFixed(1)}s)`);

  if (generatedDockerfile) {
    await sshExec(serverIp, `cat > ${remotePath}/Dockerfile << 'DOCKERFILE_EOF'\n${generatedDockerfile}DOCKERFILE_EOF`);
    log('dockerfile', 'Dockerfile written to server');
  }

  // 6. Build Docker image
  log('build', 'Building Docker image (this may take a few minutes)...');
  const buildStart = Date.now();
  const buildResult = await sshExec(serverIp, `cd ${remotePath} && docker build -t ${name} .`);
  const buildTime = ((Date.now() - buildStart) / 1000).toFixed(1);

  if (buildResult.exitCode !== 0) {
    log('build', `Build failed after ${buildTime}s`);
    return { status: 'build-failed', error: buildResult.stderr || buildResult.stdout };
  }
  log('build', `Build complete (${buildTime}s)`);

  // 7. Stop old container + start new
  log('container', 'Stopping old container (if any)...');
  await sshExec(serverIp, `docker stop ${name} 2>/dev/null; docker rm ${name} 2>/dev/null`);

  const port = getContainerPort(framework);
  const envFlags = env
    ? Object.entries(env).map(([k, v]) => `-e ${k}="${v}"`).join(' ')
    : '';

  log('container', `Starting container (port ${port})...`);
  const runResult = await sshExec(serverIp,
    `docker run -d --name ${name} --restart unless-stopped ${envFlags} -p ${port}:${port} ${name}`
  );
  if (runResult.exitCode !== 0) {
    log('container', 'Container failed to start');
    return { status: 'run-failed', error: runResult.stderr || runResult.stdout };
  }
  log('container', 'Container running');

  // 8. Configure nginx
  log('nginx', 'Configuring reverse proxy...');
  const nginxConf = `server {
    listen 80;
    server_name ${name}.canopy.sh;
    location / {
        proxy_pass http://localhost:${port};
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

  // 9. Save state
  saveDeployment(name, {
    serverId,
    serverIp,
    domain: `${name}.canopy.sh`,
    framework,
    lastDeploy: new Date().toISOString(),
    createdAt: deployment?.createdAt || new Date().toISOString(),
  });
  log('state', 'Deployment state saved');

  return {
    status: 'deployed',
    url: `https://${name}.canopy.sh`,
    ip: serverIp,
    framework,
    scan: scanResult,
  };
}

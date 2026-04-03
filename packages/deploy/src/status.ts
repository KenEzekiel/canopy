import { getDeployment } from './state';
import { sshExec } from './ssh';

const APP_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

interface StatusResult {
  status: string;
  name?: string;
  url?: string;
  ip?: string;
  port?: number;
  container?: string;
  framework?: string;
  lastDeploy?: string;
}

export async function getStatus(name: string): Promise<StatusResult> {
  if (!APP_NAME_REGEX.test(name)) throw new Error(`Invalid app name "${name}".`);
  const deployment = getDeployment(name);
  if (!deployment) return { status: 'not-found' };

  const containerStatus = await sshExec(deployment.serverIp,
    `docker inspect --format='{{.State.Status}}' ${name} 2>/dev/null || echo "not-running"`
  );

  return {
    name,
    status: 'ok',
    url: deployment.domain,
    ip: deployment.serverIp,
    port: deployment.port,
    container: containerStatus.stdout.trim(),
    framework: deployment.framework,
    lastDeploy: deployment.lastDeploy,
  };
}

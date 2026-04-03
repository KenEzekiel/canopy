import { getDeployment } from './state';
import { sshExec } from './ssh';

interface StatusResult {
  status: string;
  name?: string;
  url?: string;
  ip?: string;
  container?: string;
  framework?: string;
  lastDeploy?: string;
}

export async function getStatus(name: string): Promise<StatusResult> {
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
    container: containerStatus.stdout.trim(),
    framework: deployment.framework,
    lastDeploy: deployment.lastDeploy,
  };
}

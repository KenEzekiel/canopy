import { getDeployment } from './state';
import { sshExec } from './ssh';
import { validateAppName } from './validation';

interface LogsResult {
  status?: string;
  name?: string;
  logs?: string;
}

export async function getLogs(name: string, lines: number = 100): Promise<LogsResult> {
  validateAppName(name);
  const deployment = getDeployment(name);
  if (!deployment) return { status: 'not-found' };

  const result = await sshExec(deployment.serverIp,
    `docker logs --tail ${lines} ${name} 2>&1`
  );

  return { name, logs: result.stdout };
}

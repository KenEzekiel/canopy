import { getDeployment } from './state';
import { sshExec } from './ssh';

const APP_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

interface LogsResult {
  status?: string;
  name?: string;
  logs?: string;
}

export async function getLogs(name: string, lines: number = 100): Promise<LogsResult> {
  if (!APP_NAME_REGEX.test(name)) throw new Error(`Invalid app name "${name}".`);
  const deployment = getDeployment(name);
  if (!deployment) return { status: 'not-found' };

  const result = await sshExec(deployment.serverIp,
    `docker logs --tail ${lines} ${name} 2>&1`
  );

  return { name, logs: result.stdout };
}

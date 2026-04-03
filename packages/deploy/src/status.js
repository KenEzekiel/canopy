'use strict';

const { getDeployment } = require('./state');
const { sshExec } = require('./ssh');

async function getStatus(name) {
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

module.exports = { getStatus };

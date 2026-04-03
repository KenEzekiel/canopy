'use strict';

const { getDeployment } = require('./state');
const { sshExec } = require('./ssh');

async function getLogs(name, lines = 100) {
  const deployment = getDeployment(name);
  if (!deployment) return { status: 'not-found' };

  const result = await sshExec(deployment.serverIp,
    `docker logs --tail ${lines} ${name} 2>&1`
  );

  return { name, logs: result.stdout };
}

module.exports = { getLogs };

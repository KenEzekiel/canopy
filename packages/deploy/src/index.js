'use strict';

const { deploy } = require('./deploy');
const { getStatus } = require('./status');
const { getLogs } = require('./logs');
const { loadConfig, saveConfig, getHetznerToken } = require('./config');
const { getDeployment, saveDeployment, listDeployments, removeDeployment } = require('./state');
const { deleteServer } = require('./provision');
const { detectFramework } = require('./detect');
const { generateDockerfile } = require('./dockerfile');

module.exports = {
  deploy,
  getStatus,
  getLogs,
  loadConfig,
  saveConfig,
  getHetznerToken,
  getDeployment,
  listDeployments,
  removeDeployment,
  deleteServer,
  detectFramework,
  generateDockerfile,
};

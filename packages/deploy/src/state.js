'use strict';

const fs = require('fs');
const path = require('path');
const { CANOPY_DIR } = require('./config');

const STATE_PATH = path.join(CANOPY_DIR, 'deployments.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function getDeployment(name) {
  return loadState()[name] || null;
}

function saveDeployment(name, info) {
  const state = loadState();
  state[name] = info;
  writeState(state);
}

function listDeployments() {
  return loadState();
}

function removeDeployment(name) {
  const state = loadState();
  delete state[name];
  writeState(state);
}

module.exports = { getDeployment, saveDeployment, listDeployments, removeDeployment };

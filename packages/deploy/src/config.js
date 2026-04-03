'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CANOPY_DIR = path.join(os.homedir(), '.canopy');
const CONFIG_PATH = path.join(CANOPY_DIR, 'config.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadConfig() {
  ensureDir(CANOPY_DIR);
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { apiKey: null, hetznerToken: null };
  }
}

function saveConfig(config) {
  ensureDir(CANOPY_DIR);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Returns Hetzner token: user's own (Model C) or env var (Model B).
 */
function getHetznerToken() {
  const config = loadConfig();
  if (config.hetznerToken) return config.hetznerToken;
  const envToken = process.env.CANOPY_HETZNER_TOKEN;
  if (!envToken) throw new Error('No Hetzner token configured. Set CANOPY_HETZNER_TOKEN env var or run canopy init.');
  return envToken;
}

module.exports = { CANOPY_DIR, loadConfig, saveConfig, getHetznerToken };

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Detect the framework used in a project.
 * @param {string} projectPath
 * @returns {'nextjs'|'vite-react'|'node-api'|'generic-node'|'static'}
 */
function detectFramework(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'static';

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return 'static';
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps['next']) return 'nextjs';
  if (deps['vite'] || deps['@vitejs/plugin-react']) return 'vite-react';
  if (deps['express'] || deps['hono'] || deps['fastify'] || deps['koa']) return 'node-api';
  if (pkg.scripts?.build) return 'generic-node';
  return 'static';
}

/**
 * Detect the entry point for a node-api project.
 */
function detectEntryPoint(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'src/index.js';

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.main) return pkg.main;
    // Parse scripts.start for "node xxx"
    const start = pkg.scripts?.start;
    if (start) {
      const match = start.match(/node\s+(\S+)/);
      if (match) return match[1];
    }
  } catch { /* fallback */ }

  return 'src/index.js';
}

/**
 * Detect the package manager used in a project.
 * @param {string} projectPath
 * @returns {'pnpm'|'yarn'|'npm'}
 */
function detectPackageManager(projectPath) {
  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

module.exports = { detectFramework, detectEntryPoint, detectPackageManager };

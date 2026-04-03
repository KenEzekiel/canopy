import fs from 'fs';
import path from 'path';

export type Framework = 'nextjs' | 'vite-react' | 'node-api' | 'generic-node' | 'static';
export type PackageManager = 'pnpm' | 'yarn' | 'npm';

/**
 * Detect the framework used in a project.
 */
export function detectFramework(projectPath: string): Framework {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'static';

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return 'static';
  }

  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps['next']) return 'nextjs';
  if (deps['vite'] || deps['@vitejs/plugin-react']) return 'vite-react';
  if (deps['express'] || deps['hono'] || deps['fastify'] || deps['koa']) return 'node-api';
  if (pkg.scripts?.build) return 'generic-node';
  return 'static';
}

/**
 * Detect the entry point for a node-api project.
 */
export function detectEntryPoint(projectPath: string): string {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'src/index.js';

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.main) return pkg.main;
    const start: string | undefined = pkg.scripts?.start;
    if (start) {
      const match = start.match(/node\s+(\S+)/);
      if (match) return match[1];
    }
  } catch { /* fallback */ }

  return 'src/index.js';
}

/**
 * Detect the package manager used in a project.
 */
export function detectPackageManager(projectPath: string): PackageManager {
  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

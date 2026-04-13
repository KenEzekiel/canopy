#!/usr/bin/env node

import { program } from 'commander';
import { scan } from '@canopy/scanner';
import {
  deploy, getStatus, getLogs, loadConfig, saveConfig,
  listDeployments, removeDeployment, deleteServer, getDeployment,
  getServerForApp, removeServer, sshExec, validateAppName,
  deployTemplate, listTemplates, loadTemplate,
} from '@canopy/deploy';
import type { CanopyState } from '@canopy/deploy';
import * as path from 'path';
import * as fs from 'fs';
import type { Finding, ScanSummary, ScanMeta, Severity } from '@canopy/scanner';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', white: '\x1b[37m',
  bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: c.red, high: c.yellow, medium: c.cyan, low: c.dim,
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: `${c.bgRed}${c.white}${c.bold} CRITICAL ${c.reset}`,
  high: `${c.bgYellow}${c.bold} HIGH ${c.reset}`,
  medium: `${c.cyan}${c.bold}MEDIUM${c.reset}`,
  low: `${c.dim}LOW${c.reset}`,
};

function scoreColor(score: number): string {
  if (score < 40) return c.red;
  if (score < 70) return c.yellow;
  return c.green;
}

function printScore(score: number): void {
  console.log();
  console.log(`  ${scoreColor(score)}${c.bold}${score}${c.reset}${c.dim}/100${c.reset}  Security Score`);
  console.log();
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(`  ${c.green}✓${c.reset} No security issues found.`);
    console.log();
    return;
  }
  const groups: Record<Severity, Finding[]> = { critical: [], high: [], medium: [], low: [] };
  for (const f of findings) groups[f.severity].push(f);

  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const items = groups[severity];
    if (items.length === 0) continue;
    console.log(`  ${SEVERITY_LABELS[severity]}  ${c.dim}(${items.length})${c.reset}`);
    console.log();
    for (const f of items) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      console.log(`  ${SEVERITY_COLORS[severity]}●${c.reset} ${c.bold}${f.title}${c.reset}`);
      console.log(`    ${c.dim}${loc}${c.reset}`);
      if (f.snippet) { console.log(); for (const line of f.snippet.split('\n')) console.log(`    ${c.dim}${line}${c.reset}`); }
      console.log(); console.log(`    ${f.description.split('\n\n')[0]}`);
      console.log(); console.log(`    ${c.green}Fix:${c.reset} ${f.fix}`); console.log();
    }
  }
}

function printMeta(meta: ScanMeta, summary: ScanSummary): void {
  const parts = [`${meta.filesScanned} files scanned`, `${meta.timeMs}ms`];
  const counts: string[] = [];
  if (summary.critical > 0) counts.push(`${c.red}${summary.critical} critical${c.reset}`);
  if (summary.high > 0) counts.push(`${c.yellow}${summary.high} high${c.reset}`);
  if (summary.medium > 0) counts.push(`${c.cyan}${summary.medium} medium${c.reset}`);
  if (summary.low > 0) counts.push(`${c.dim}${summary.low} low${c.reset}`);
  console.log(counts.length > 0
    ? `  ${c.dim}${parts.join(' · ')} · ${c.reset}${counts.join(', ')}`
    : `  ${c.dim}${parts.join(' · ')}${c.reset}`);
  console.log();
}

const PHASE_ICONS: Record<string, string> = {
  scan: '🔍', detect: '🔎', state: '💾', provision: '☁️ ',
  dockerfile: '🐳', upload: '📦', build: '🔨', container: '▶️ ',
  nginx: '🌐', ssl: '🔒', env: '🔑', vpn: '🛡️ ', clone: '📥',
  deploy: '🚀', default: '  ',
};

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
program.name('canopy').description('Security scanner & deploy tool for vibecoded apps').version(pkg.version);

program.command('scan [path]').description('Scan a project for security issues')
  .option('--json', 'Output raw JSON')
  .action((targetPath: string | undefined, opts: { json?: boolean }) => {
    const resolved = path.resolve(targetPath || process.cwd());
    try {
      const result = scan(resolved);
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); process.exit(result.summary.critical > 0 ? 1 : 0); }
      console.log(); console.log(`  ${c.bold}canopy scan${c.reset}  ${c.dim}${resolved}${c.reset}`);
      printScore(result.score); printFindings(result.findings); printMeta(result.meta, result.summary);
      process.exit(result.summary.critical > 0 ? 1 : 0);
    } catch (err: any) { console.error(`${c.red}Error:${c.reset} ${err.message}`); process.exit(2); }
  });

program.command('init').description('Initialize Canopy config').action(() => {
  const config = loadConfig();
  const token = process.env.CANOPY_HETZNER_TOKEN;
  if (token) console.log(`  ${c.green}✓${c.reset} Hetzner token found in CANOPY_HETZNER_TOKEN env var`);
  else if (config.hetznerToken) console.log(`  ${c.green}✓${c.reset} Hetzner token found in config`);
  else console.log(`  ${c.yellow}!${c.reset} No Hetzner token. Set CANOPY_HETZNER_TOKEN env var to deploy.`);
  saveConfig(config);
  console.log(`  ${c.green}✓${c.reset} Config saved to ~/.canopy/config.json`);
});

program.command('deploy [path]').description('Deploy a project (or a template with --template) to a Hetzner VPS')
  .requiredOption('--name <name>', 'App name (used for subdomain)')
  .option('--template <template>', 'Deploy from a predefined template (run `canopy templates` to list)')
  .option('--json', 'Output raw JSON')
  .option('--verbose', 'Show detailed deploy progress')
  .option('--force', 'Skip scanner gate (deploy with critical findings)')
  .option('--new', 'Force new server (don\'t reuse existing)')
  .option('--region <region>', 'Server region (fsn1, nbg1, hel1, ash, hil, sin)', 'hel1')
  .option('--env-file <path>', 'Path to .env file to load')
  .option('--no-ssl', 'Skip SSL/certbot setup')
  .option('--private', 'Make app VPN-only (WireGuard)')
  .action(async (targetPath: string | undefined, opts: {
    name: string; template?: string; json?: boolean; verbose?: boolean; force?: boolean;
    new?: boolean; region?: string; envFile?: string; ssl?: boolean; private?: boolean;
  }) => {
    // Load env vars from --env-file if provided
    let envVars: Record<string, string> | undefined;
    if (opts.envFile) {
      const envPath = path.resolve(opts.envFile);
      if (!fs.existsSync(envPath)) { console.error(`  ${c.red}Error:${c.reset} Env file not found: ${envPath}`); process.exit(2); }
      envVars = {};
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) envVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }

    const verboseLog = opts.verbose
      ? (phase: string, msg: string) => { const icon = PHASE_ICONS[phase] || PHASE_ICONS.default; console.log(`  ${c.dim}${icon}${c.reset} ${c.dim}[${phase}]${c.reset} ${msg}`); }
      : undefined;

    // Template deploy path
    if (opts.template) {
      try {
        const tmpl = loadTemplate(opts.template);
        console.log(); console.log(`  ${c.bold}canopy deploy${c.reset}  ${c.dim}template: ${tmpl.name}${c.reset}`);
        console.log(`  ${c.dim}name: ${opts.name}${c.reset}`); console.log();

        // Collect required env vars from env-file or process.env
        const templateEnv: Record<string, string> = { ...(envVars || {}) };
        for (const req of tmpl.env_required) {
          if (!templateEnv[req.name] && process.env[req.name]) {
            templateEnv[req.name] = process.env[req.name]!;
          }
        }
        for (const opt of tmpl.env_optional) {
          if (!templateEnv[opt.name] && process.env[opt.name]) {
            templateEnv[opt.name] = process.env[opt.name]!;
          }
        }

        const result = await deployTemplate({
          templateName: opts.template, appName: opts.name, env: templateEnv,
          region: opts.region, private: opts.private, log: verboseLog,
        });
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); process.exit(result.status === 'deployed' ? 0 : 1); }
        if (result.status === 'missing-env') { console.error(`  ${c.red}✗${c.reset} ${result.error}`); process.exit(1); }
        if (result.status !== 'deployed') { console.error(`  ${c.red}✗${c.reset} ${result.status}: ${result.error}`); process.exit(1); }
        console.log(`  ${c.green}✓${c.reset} Deployed (template: ${opts.template})`);
        console.log(`  ${c.dim}URL:${c.reset}      ${result.url}`);
        console.log(`  ${c.dim}IP:${c.reset}       ${result.ip}:${result.port}`);
        console.log(`  ${c.dim}Template:${c.reset} ${opts.template}`);
        if (result.vpnConfig) {
          console.log();
          console.log(`  ${c.bold}🔒 VPN Config${c.reset} (import into WireGuard app):`);
          console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
          for (const line of result.vpnConfig.split('\n')) console.log(`  ${c.dim}${line}${c.reset}`);
          console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
          console.log(`  ${c.yellow}This app is VPN-only.${c.reset}`);
        }
        console.log();
      } catch (err: any) { console.error(`  ${c.red}Error:${c.reset} ${err.message}`); process.exit(2); }
      return;
    }

    // Regular deploy path
    const projectPath = path.resolve(targetPath || process.cwd());
    try {
      console.log(); console.log(`  ${c.bold}canopy deploy${c.reset}  ${c.dim}${projectPath}${c.reset}`);
      console.log(`  ${c.dim}name: ${opts.name}${c.reset}`); console.log();
      const result = await deploy({
        projectPath, name: opts.name, env: envVars,
        force: opts.force, newServer: opts.new, region: opts.region,
        noSsl: opts.ssl === false, private: opts.private, log: verboseLog,
      });
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); process.exit(result.status === 'deployed' ? 0 : 1); }
      if (result.status === 'blocked') { console.log(`  ${c.red}✗${c.reset} Deploy blocked: ${result.reason}`); if (result.scan) { printScore(result.scan.score); printFindings(result.scan.findings); } process.exit(1); }
      if (result.status === 'build-failed') { console.log(`  ${c.red}✗${c.reset} Build failed:`); console.log(result.error); process.exit(1); }
      if (result.status === 'run-failed') { console.log(`  ${c.red}✗${c.reset} Container failed to start:`); console.log(result.error); process.exit(1); }
      console.log(`  ${c.green}✓${c.reset} Deployed`);
      console.log(`  ${c.dim}URL:${c.reset}       ${result.url}`);
      console.log(`  ${c.dim}IP:${c.reset}        ${result.ip}:${result.port}`);
      console.log(`  ${c.dim}Framework:${c.reset} ${result.framework}`);
      console.log(`  ${c.dim}Score:${c.reset}     ${result.scan?.score}/100`);
      if (result.vpnConfig) {
        console.log();
        console.log(`  ${c.bold}🔒 VPN Config${c.reset} (import into WireGuard app):`);
        console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
        for (const line of result.vpnConfig.split('\n')) {
          console.log(`  ${c.dim}${line}${c.reset}`);
        }
        console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
        console.log(`  ${c.yellow}This app is VPN-only.${c.reset}`);
        console.log(`  ${c.dim}1. Import config into WireGuard app${c.reset}`);
        console.log(`  ${c.dim}2. Activate the tunnel${c.reset}`);
        console.log(`  ${c.dim}3. Access via: ${result.url}${c.reset}`);
        console.log(`  ${c.dim}Note: If using Chrome, disable "Use secure DNS" in chrome://settings/security${c.reset}`);
      }
      console.log();
    } catch (err: any) { console.error(`  ${c.red}Error:${c.reset} ${err.message}`); process.exit(2); }
  });

program.command('status <name>').description('Check app status').option('--json', 'Output raw JSON')
  .action(async (name: string, opts: { json?: boolean }) => {
    try {
      const result = await getStatus(name);
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
      if (result.status === 'not-found') { console.log(`  ${c.yellow}!${c.reset} No deployment found for "${name}"`); process.exit(1); }
      console.log(); console.log(`  ${c.bold}${name}${c.reset}`);
      console.log(`  ${c.dim}Container:${c.reset} ${result.container}`); console.log(`  ${c.dim}URL:${c.reset}       ${result.url}`);
      console.log(`  ${c.dim}IP:${c.reset}        ${result.ip}`); console.log(`  ${c.dim}Framework:${c.reset} ${result.framework}`);
      console.log(`  ${c.dim}Deployed:${c.reset}  ${result.lastDeploy}`); console.log();
    } catch (err: any) { console.error(`  ${c.red}Error:${c.reset} ${err.message}`); process.exit(2); }
  });

program.command('logs <name>').description('Get app logs').option('--lines <n>', 'Number of lines', '100')
  .action(async (name: string, opts: { lines: string }) => {
    try {
      const result = await getLogs(name, parseInt(opts.lines, 10));
      if (result.status === 'not-found') { console.log(`  ${c.yellow}!${c.reset} No deployment found for "${name}"`); process.exit(1); }
      console.log(result.logs);
    } catch (err: any) { console.error(`  ${c.red}Error:${c.reset} ${err.message}`); process.exit(2); }
  });

program.command('list').description('List all deployments').option('--json', 'Output raw JSON')
  .action((opts: { json?: boolean }) => {
    const state = listDeployments();
    if (opts.json) { console.log(JSON.stringify(state, null, 2)); return; }
    const appNames = Object.keys(state.apps || {});
    if (appNames.length === 0) { console.log(`  ${c.dim}No deployments yet.${c.reset}`); return; }

    console.log();
    // Group apps by server
    const serverApps: Record<string, string[]> = {};
    for (const [name, app] of Object.entries(state.apps)) {
      if (!serverApps[app.serverId]) serverApps[app.serverId] = [];
      serverApps[app.serverId].push(name);
    }

    for (const [srvId, apps] of Object.entries(serverApps)) {
      const srv = state.servers?.[srvId];
      const ip = srv?.ip || 'unknown';
      const loc = srv?.location || '?';
      console.log(`  ${c.dim}${srvId}${c.reset}  ${c.dim}${ip} (${loc})${c.reset}  ${c.dim}${apps.length} app(s)${c.reset}`);
      for (const name of apps) {
        const app = state.apps[name];
        console.log(`    ${c.bold}${name}${c.reset}  ${c.dim}:${app.port}  ${app.framework}  ${app.private ? '🔒 private' : 'public'}  ${app.lastDeploy || 'pending'}${c.reset}`);
      }
      console.log();
    }
  });

program.command('destroy <name>').description('Remove an app (deletes server if last app)')
  .action(async (name: string) => {
    try {
      validateAppName(name);
      const app = getDeployment(name);
      if (!app) { console.log(`  ${c.yellow}!${c.reset} No deployment found for "${name}"`); process.exit(1); }

      const srvInfo = getServerForApp(name);
      const isLastApp = srvInfo ? srvInfo.server.apps.length <= 1 : false;

      // Step 1: If last app, delete Hetzner server FIRST (before touching local state)
      if (isLastApp && srvInfo) {
        console.log(`  Last app on server — deleting server ${srvInfo.server.id} (${srvInfo.server.ip})...`);
        try {
          await deleteServer(srvInfo.server.id);
        } catch (err: any) {
          // 404 = server already gone on Hetzner, safe to clean up local state
          if (err.message?.includes('404')) {
            console.log(`  ${c.dim}Server already deleted on Hetzner, cleaning up local state...${c.reset}`);
          } else {
            console.error(`  ${c.red}✗${c.reset} Failed to delete server on Hetzner: ${err.message}`);
            console.error(`  ${c.dim}State NOT modified. Server may still be running. Check Hetzner console.${c.reset}`);
            process.exit(1);
          }
        }
      }

      // Step 2: Clean up on server (best-effort, server might be gone already)
      if (!isLastApp) {
        console.log(`  Stopping container ${name}...`);
        try {
          await sshExec(app.serverIp, `docker stop ${name} 2>/dev/null; docker rm ${name} 2>/dev/null`);
          await sshExec(app.serverIp, `rm -f /etc/nginx/sites-enabled/${name} /etc/nginx/sites-available/${name}`);
          await sshExec(app.serverIp, `nginx -t && systemctl reload nginx 2>/dev/null`);
          await sshExec(app.serverIp, `rm -rf /home/canopy/${name}`);
        } catch { /* server unreachable — acceptable if we're removing the app from state */ }
      }

      // Step 3: Update local state AFTER remote operations succeed
      removeDeployment(name);
      if (isLastApp && srvInfo) {
        removeServer(srvInfo.serverId);
        console.log(`  ${c.green}✓${c.reset} Destroyed ${name} and server ${srvInfo.server.ip}`);
      } else {
        console.log(`  ${c.green}✓${c.reset} Removed ${name} (server still has other apps)`);
      }
    } catch (err: any) { console.error(`  ${c.red}Error:${c.reset} ${err.message}`); process.exit(2); }
  });

program.command('templates').description('List available deployment templates')
  .option('--json', 'Output raw JSON')
  .action((opts: { json?: boolean }) => {
    const templates = listTemplates();
    if (opts.json) { console.log(JSON.stringify(templates, null, 2)); return; }
    console.log();
    console.log(`  ${c.bold}Available templates${c.reset}`);
    console.log();
    for (const t of templates) {
      console.log(`  ${c.bold}${t.name}${c.reset}  ${c.dim}${t.description}${c.reset}`);
      console.log(`    ${c.dim}type: ${t.type}  ports: ${t.ports.join(', ')}${t.min_ram ? `  min-ram: ${t.min_ram}` : ''}${c.reset}`);
      if (t.env_required.length > 0) {
        console.log(`    ${c.dim}required env: ${t.env_required.map((e) => e.name).join(', ')}${c.reset}`);
      }
      console.log(`    ${c.dim}docs: ${t.docs}${c.reset}`);
      console.log();
    }
  });

program.parse();

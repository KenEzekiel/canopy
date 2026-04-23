# Canopy

[![npm version](https://img.shields.io/npm/v/canopy-deploy.svg)](https://www.npmjs.com/package/canopy-deploy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/KenEzekiel/canopy.svg)](https://github.com/KenEzekiel/canopy/stargazers)

**You vibecoded an app. Now what?**

Vercel charges per project. Railway bills by usage. Your $5 side project becomes $20/month real fast.

**Canopy deploys to your own $5/mo VPS with one command.**

```bash
npx canopy-deploy deploy --name myapp
```

90 seconds later: your app is live with HTTPS, nginx, and Docker. No vendor lock-in. Full SSH access. Deploy unlimited apps on one server.

---

## Built for AI Agents

Your Claude Code, Cursor, Kiro, or OpenClaw can ship apps autonomously.

```bash
# AI agent runs this, app goes live
npx canopy-deploy scan
npx canopy-deploy deploy --name myapp --json
```

**Why AI agents love Canopy:**
- `--json` flag for machine-readable output
- Structured errors with exit codes
- Deterministic flow: scan → detect → provision → build → deploy → done
- No interactive prompts (all flags or env vars)
- Works with any agent that has shell access

**Supported agents:** Claude Code, Cursor, Kiro IDE, OpenClaw, any MCP-compatible agent, or any AI with shell access.

---

## Quick Demo

```bash
# 1. Scan for security issues (<100ms)
npx canopy-deploy scan
✓ No hardcoded secrets
✓ No SQL injection risks
✓ Supabase RLS enabled
✓ CORS configured safely

# 2. Deploy (auto-detects framework, generates Dockerfile, provisions VPS)
export CANOPY_HETZNER_TOKEN="your-token"
npx canopy-deploy deploy --name myapp

Scanning... ✓
Detecting framework... Next.js ✓
Provisioning VPS... ✓
Building Docker image... ✓
Deploying... ✓
Configuring nginx... ✓

🚀 Live at https://myapp.yourdomain.com

# 3. Check status
npx canopy-deploy status myapp
✓ Running (port 3001)

# 4. View logs
npx canopy-deploy logs myapp
```

Get a Hetzner token: [console.hetzner.cloud](https://console.hetzner.cloud) → Security → API Tokens → Generate (read+write).

---

## Features

### 🔒 Security Scanner (18 checks, <100ms)
Blocks deploys on critical issues. Scans for:
- Hardcoded secrets (Supabase, Firebase, OpenAI, Stripe, AWS, DB URLs, private keys)
- Committed .env files
- Supabase client-side key without RLS
- Broken RLS policies (auth.role() instead of auth.uid())
- Permissive CORS (credentials + wildcard origin)
- SQL injection via template literals
- Firebase rules misconfigured
- Webhook endpoints without signature verification
- Sensitive data in console.log

Skips test files, docs, comments, placeholder values, and gitignored .env files.

### 🚀 One-Command Deploy
- Auto-detects framework (Next.js, Vite, Express, Hono, Fastify, static)
- Generates optimized Dockerfile (npm, pnpm, yarn)
- Provisions Hetzner VPS ($5/mo)
- Builds with Docker BuildKit
- Configures nginx reverse proxy
- Sets up SSL via Let's Encrypt
- Supports build-time secrets

### 💰 Multi-App Per Server
Share one VPS across multiple apps. Each gets its own Docker container and port. Nginx routes by subdomain.

```bash
npx canopy-deploy deploy ./frontend --name app1     # port 3001
npx canopy-deploy deploy ./backend --name app2      # port 3002 (same server)
npx canopy-deploy deploy ./admin --name app3 --new  # force new server
```

**Cost:** $5/mo for unlimited apps (vs $20/project on Vercel).

### 🔐 Private Deployments via WireGuard VPN
Deploy internal tools that are only accessible via VPN:

```bash
npx canopy-deploy deploy ./app --name internal-tool --private
```

This sets up WireGuard on the server, generates a client config, and configures nginx to only accept VPN connections. Without VPN: `403 Forbidden`. With VPN: full HTTPS access with valid SSL cert.

**Killer differentiator:** No other CLI-first deploy tool has this.

### 🤖 AI-Friendly CLI
- `--json` output for machine parsing
- Structured errors with exit codes
- No interactive prompts (all flags or env vars)
- Deterministic flow (same inputs = same outputs)
- Verbose mode for debugging (`--verbose`)

---

## How It Works

```
┌─────────────────────────────────────────┐
│  Your AI Agent / Developer               │
│  runs: npx canopy-deploy deploy          │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Canopy CLI                              │
│  1. Scan for security issues             │
│  2. Detect framework                     │
│  3. Generate Dockerfile                  │
│  4. Provision VPS (Hetzner)              │
│  5. Build Docker image                   │
│  6. Deploy container                     │
│  7. Configure nginx + SSL                │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Your VPS ($5/mo)                        │
│  Docker container + nginx reverse proxy  │
│  https://myapp.yourdomain.com            │
└──────────────────────────────────────────┘
```

---

## Framework Support

| Framework | Detection | Dockerfile |
|-----------|-----------|------------|
| Next.js | `next` in dependencies | Multi-stage build, `npx next start` |
| Vite/React | `vite` in dependencies | Build + nginx serve |
| Express | `express` in dependencies | Node.js server |
| Hono | `hono` in dependencies | Node.js server |
| Fastify | `fastify` in dependencies | Node.js server |
| Generic Node.js | Has `scripts.build` | Build + `npm start` |
| Static | No package.json | nginx serve |

Supports npm, pnpm, and yarn (detected from lockfile).

---

## CLI Reference

```bash
# Scan for security issues
npx canopy-deploy scan [path]
  --json                        Output raw JSON

# Deploy to Hetzner VPS
npx canopy-deploy deploy [path]
  --name <name>                 App name (required, used for subdomain)
  --verbose                     Show step-by-step progress
  --force                       Skip scanner gate
  --new                         Force new server (don't reuse existing)
  --region <region>             Server region: fsn1, nbg1, hel1, ash, hil, sin (default: hel1)
  --env-file <path>             Load env vars from file
  --private                     Deploy as VPN-only (WireGuard)
  --json                        Output raw JSON

# Check app status
npx canopy-deploy status <name>

# View container logs
npx canopy-deploy logs <name>
  --lines <n>                   Number of lines (default: 100)

# List all deployments
npx canopy-deploy list

# Remove app (deletes server if last app)
npx canopy-deploy destroy <name>

# Initialize config
npx canopy-deploy init
```

**Environment variables:**
```bash
CANOPY_HETZNER_TOKEN=your_hetzner_api_token_here
CANOPY_DOMAIN=yourdomain.com
CANOPY_SSL_EMAIL=admin@yourdomain.com  # optional
```

Or use `.env` file (see `.env.example`).

---

## Bring Your Own Server

Already have a VPS? Skip Hetzner provisioning:

```bash
npx canopy-deploy deploy --name myapp --server 1.2.3.4 --ssh-user root --ssh-port 22
```

Works with any server you can SSH into — DigitalOcean, Linode, AWS Lightsail, Vultr, or any Ubuntu server with Docker installed.

---

## For AI Agents

Canopy is designed for autonomous deployment by AI coding agents.

**How AI agents use Canopy:**

1. **Any agent with shell access** can run canopy commands
2. **Use `--json` flag** for machine-readable output:
   ```bash
   npx canopy-deploy scan --json
   npx canopy-deploy deploy --name myapp --json
   ```
3. **Deterministic flow:** Same inputs always produce same outputs
4. **No interactive prompts:** All configuration via flags or env vars
5. **Structured errors:** Exit codes + JSON error objects for parsing

**Example agent workflow:**
```bash
# 1. Agent scans codebase
npx canopy-deploy scan --json
# Output: {"status": "pass", "issues": [], "summary": {...}}

# 2. Agent deploys if scan passes
npx canopy-deploy deploy --name myapp --json
# Output: {"status": "success", "url": "https://myapp.yourdomain.com", ...}

# 3. Agent checks status
npx canopy-deploy status myapp --json
# Output: {"status": "running", "port": 3001, ...}
```

**Works with:**
- Claude Code (Anthropic)
- Cursor
- Kiro IDE
- OpenClaw
- Any MCP-compatible agent
- Any AI with shell access

---

## Why Not Just Use X?

**vs Vercel / Netlify:**
- You own your server. No vendor lock-in.
- $5/mo flat for unlimited apps (vs $20/project).
- Full SSH access and control.

**vs Railway / Render:**
- Same idea (own your infra) but you keep full SSH access.
- No usage-based billing surprises.
- Deploy to any Hetzner region.

**vs Coolify:**
- Coolify is a full PaaS with web dashboard (self-hosted Vercel).
- Canopy is CLI-first, AI-native, zero config.
- Canopy has built-in security scanner and VPN support.

**vs raw Docker + SSH:**
- Canopy automates the boring parts (Dockerfile, nginx, SSL, DNS).
- Security scanner blocks bad deploys.
- Multi-app management built-in.

---

## Installation

```bash
# Use directly with npx (recommended)
npx canopy-deploy deploy --name myapp

# Or install globally
npm install -g canopy-deploy
canopy deploy --name myapp
```

---

## Development

```bash
git clone https://github.com/KenEzekiel/canopy.git
cd canopy
npm install
npm run build

# Test locally
npx canopy-deploy scan .
```

**Project structure:**
```
packages/
  scanner/    Security scanner engine (18 checks)
  deploy/     Deploy engine (Hetzner + SSH + Docker)
  cli/        CLI wrapper (commander)
```

---

## Contributing

We welcome contributions! Please read our [Contributor License Agreement](/.github/CLA.md) before submitting PRs.

**Areas we need help:**
- Additional framework support (Nuxt, SvelteKit, Remix, etc.)
- More security checks
- Cloud provider support (AWS, DigitalOcean, Linode)
- Documentation improvements
- Bug reports and feature requests

Open an issue or PR on [GitHub](https://github.com/KenEzekiel/canopy).

---

## Collaborations & Partnerships

Interested in integrating Canopy into your AI agent, IDE, or platform? Want to collaborate on features?

**Contact:** DM [@KenEzekiel](https://twitter.com/KenEzekiel) on X/Twitter or open a GitHub issue.

---

## Roadmap

- [ ] Managed hosting (deploy without your own VPS)
- [ ] More cloud providers (DigitalOcean, AWS Lightsail)
- [ ] Auto-deploy on git push
- [ ] Web dashboard
- [ ] `canopy ssh` command for quick server access

---

## License

MIT © Canopy Contributors

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

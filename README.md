# Canopy

Security scanner + deploy tool for vibecoded apps. Scan for vulnerabilities, deploy to your own VPS with one command.

```bash
npx canopy scan                          # scan current directory
npx canopy deploy --name myapp           # deploy to Hetzner VPS
npx canopy status myapp                  # check if running
npx canopy logs myapp                    # view logs
```

## What it does

1. **Scans** your project for hardcoded secrets, misconfigurations, and common security mistakes
2. **Blocks** deploys if critical issues are found (override with `--force`)
3. **Detects** your framework (Next.js, Vite, Express, Hono, Fastify, static)
4. **Generates** a Dockerfile (supports npm, pnpm, yarn)
5. **Provisions** a VPS on Hetzner Cloud
6. **Builds** and deploys via Docker
7. **Configures** nginx reverse proxy

## Quick start

```bash
# Scan a project
npx canopy scan /path/to/project

# Deploy (needs Hetzner API token)
export CANOPY_HETZNER_TOKEN="your-token"
npx canopy deploy /path/to/project --name myapp --verbose
```

Get a Hetzner token: [console.hetzner.cloud](https://console.hetzner.cloud) → Security → API Tokens → Generate (read+write).

## Scanner

14 security checks, context-aware, <100ms:

| Check | Severity |
|-------|----------|
| Hardcoded secrets (Supabase, Firebase, OpenAI, Stripe, AWS, DB URLs, private keys) | Critical |
| Committed .env files (cross-referenced against .gitignore) | Critical |
| Supabase client-side key without RLS | Critical |
| Supabase service_role key in source | Critical |
| Broken RLS policies (auth.role() instead of auth.uid()) | Critical |
| Permissive CORS (credentials + wildcard origin) | Critical |
| SQL injection via template literals | Critical |
| Firebase rules misconfigured | Critical/High |
| Hardcoded test credentials (admin/admin123) | High |
| Webhook endpoints without signature verification | High |
| Sensitive data in console.log | High |
| Missing .gitignore for .env files | Critical |

Skips test files, docs, comments, placeholder values, and gitignored .env files.

## CLI commands

```
canopy scan [path]              Scan for security issues
  --json                        Output raw JSON

canopy deploy [path]            Deploy to Hetzner VPS
  --name <name>                 App name (required, used for subdomain)
  --verbose                     Show step-by-step progress
  --force                       Skip scanner gate
  --new                         Force new server (don't reuse existing)
  --region <region>             Server region: fsn1, nbg1, hel1, ash, hil, sin (default: hel1)
  --env-file <path>             Load env vars from file
  --json                        Output raw JSON

canopy status <name>            Check app status
canopy logs <name>              View container logs
  --lines <n>                   Number of lines (default: 100)
canopy list                     List all deployments
canopy destroy <name>           Remove app (deletes server if last app)
canopy init                     Initialize config
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Your AI (Claude Code / Cursor / Kiro)  │
│  runs: npx canopy deploy --name myapp   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Canopy CLI                              │
│  scan → detect → provision → build →     │
│  deploy → nginx → done                   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Your VPS (Hetzner)                      │
│  Docker container + nginx reverse proxy  │
│  https://myapp.yourdomain.com            │
└──────────────────────────────────────────┘
```

## Multi-app per server

Multiple apps share one VPS. Each gets its own Docker container and port. Nginx routes by subdomain.

```bash
canopy deploy ./frontend --name app1     # port 3001
canopy deploy ./backend --name app2      # port 3002 (same server)
canopy deploy ./admin --name app3 --new  # force new server
```

## Private deployments (VPN)

Deploy apps that are only accessible via WireGuard VPN:

```bash
canopy deploy ./app --name internal-tool --private
```

This:
1. Sets up WireGuard on the server (first time only)
2. Generates a client config file
3. Configures nginx to only accept VPN connections
4. Sets up DNS resolution via dnsmasq

Import the generated `.conf` file into any WireGuard client to access your private app.

Without VPN: `403 Forbidden`. With VPN: full HTTPS access with valid SSL cert.

Note: Chrome users need to disable "Use secure DNS" (`chrome://settings/security`) for VPN DNS to work.

## Framework detection

| Framework | Detection | Dockerfile |
|-----------|-----------|------------|
| Next.js | `next` in dependencies | Multi-stage build, `npx next start` |
| Vite/React | `vite` in dependencies | Build + nginx serve |
| Express/Hono/Fastify | `express`/`hono`/`fastify` in deps | Node.js server |
| Generic Node.js | Has `scripts.build` | Build + `npm start` |
| Static | No package.json | nginx serve |

Supports npm, pnpm, and yarn (detected from lockfile).

## Project structure

```
packages/
  scanner/    Security scanner engine (14 checks)
  deploy/     Deploy engine (Hetzner + SSH + Docker)
  cli/        CLI wrapper (commander)
```

## Development

```bash
git clone https://github.com/dataretech/canopy.git
cd canopy
npm install
npm run build
npx canopy scan .
```

## License

MIT

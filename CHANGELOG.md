# Changelog

## 1.2.2 (2026-04-23)

- Docs: add BYOS (Bring Your Own Server) section to README
- Docs: add roadmap, fix security check count (18 checks)
- Test: add 63 scanner unit tests across 5 files (secrets, credentials, code-patterns, supabase, integration)
- Chore: clean up npm package (add files field)

## 1.2.1 (2026-04-23)

- Fixed: env vars no longer leaked via --build-arg in Docker image history
- Added: post-deploy health check (container state + HTTP response)
- Fixed: env file TOCTOU race (umask 077)
- Added: SSL failure warning visible in non-verbose output
- Added: DNS guidance printed after new server provisioning
- Added: UFW firewall in cloud-init (ports 22, 80, 443, 51820)
- Added: Immich, Seafile, MinIO deployment templates

## 1.2.0 (2026-04-14)

- Added: `--server` flag for deploying to existing VPS (DigitalOcean, Linode, AWS, any Ubuntu server)
- Added: 8 deployment templates (OpenClaw, Plausible, Uptime Kuma, n8n, Vaultwarden, Immich, Seafile, MinIO)
- Added: rsync for fast redeploys
- CI: add Node 24 to test matrix

## 1.1.2 (2026-04-13)

- Fixed: use wildcard version for workspace deps (fixes CI install)

## 1.1.1 (2026-04-12)

- Fixed: bundle CLI with esbuild — fixes `npx canopy-deploy` for external users
- Fixed: dynamic CLI version from package.json
- Fixed: skip scanner self-scan false positives

## 1.1.0 (2026-04-12)

- Added: template deployments — deploy OpenClaw, Plausible, Uptime Kuma, n8n, Vaultwarden with one command
- Fixed: security hardening for template deployments (env escaping, domain/email/key validation, shell-escape paths)

## 1.0.0 (2026-04-12)

Initial open source release.

- Security scanner with 18 checks (secrets, CORS, SQL injection, Firebase, Supabase RLS)
- Deploy to Hetzner VPS with one command
- Auto-detect framework (Next.js, Vite, Express, Hono, Fastify, static)
- Auto-generate Dockerfile (npm, pnpm, yarn)
- Multi-app per server with nginx reverse proxy
- Private deployments via WireGuard VPN
- SSL via Let's Encrypt
- Docker BuildKit secrets for build-time env vars

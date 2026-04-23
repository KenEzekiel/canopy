# Changelog

## 1.2.1 (2026-04-23)

- Fixed: env vars no longer leaked via --build-arg in Docker image history
- Added: post-deploy health check (container state + HTTP response)
- Fixed: env file TOCTOU race (umask 077)
- Added: SSL failure warning visible in non-verbose output
- Added: DNS guidance printed after new server provisioning
- Added: UFW firewall in cloud-init (ports 22, 80, 443, 51820)
- Added: scanner unit tests (63 tests across 5 files)

## 1.2.0 (2026-04-14)

- Added: --server flag for deploying to existing VPS
- Added: deployment templates (8 templates)
- Added: rsync for fast redeploys

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
- Rsync for fast redeploys

# Changelog

## 1.0.0 (2026-04-12)

Initial open source release.

- Security scanner with 14 checks (secrets, CORS, SQL injection, Firebase, Supabase RLS)
- Deploy to Hetzner VPS with one command
- Auto-detect framework (Next.js, Vite, Express, Hono, Fastify, static)
- Auto-generate Dockerfile (npm, pnpm, yarn)
- Multi-app per server with nginx reverse proxy
- Private deployments via WireGuard VPN
- SSL via Let's Encrypt
- Docker BuildKit secrets for build-time env vars
- Rsync for fast redeploys

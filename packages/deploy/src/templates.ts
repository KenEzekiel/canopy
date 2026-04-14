export interface TemplateEnvVar {
  name: string;
  description: string;
  default?: string;
}

export interface TemplateVolume {
  host: string;
  container: string;
}

export interface TemplateHealthCheck {
  url: string;
  timeout: number;
}

export interface Template {
  name: string;
  description: string;
  repo: string;
  type: 'docker-compose' | 'dockerfile' | 'image';
  compose_file?: string;
  env_required: TemplateEnvVar[];
  env_optional: TemplateEnvVar[];
  ports: number[];
  volumes: TemplateVolume[];
  health_check: TemplateHealthCheck;
  docs: string;
  min_ram?: string;
  min_disk?: string;
}

const TEMPLATES: Template[] = [
  {
    name: 'openclaw',
    description: 'AI assistant platform — WhatsApp, Telegram, Discord',
    repo: 'https://github.com/openclaw/openclaw',
    type: 'docker-compose',
    env_required: [{ name: 'ANTHROPIC_API_KEY', description: 'Anthropic API key for Claude' }],
    env_optional: [{ name: 'MODEL', default: 'claude-sonnet-4-5', description: 'Default AI model' }],
    ports: [3000],
    volumes: [{ host: '/data/openclaw', container: '/home/node/.openclaw' }],
    health_check: { url: 'http://localhost:3000/health', timeout: 60 },
    docs: 'https://docs.openclaw.ai',
    min_ram: '4GB',
  },
  {
    name: 'plausible',
    description: 'Privacy-friendly web analytics',
    repo: 'https://github.com/plausible/community-edition',
    type: 'docker-compose',
    env_required: [
      { name: 'BASE_URL', description: 'Public URL (e.g. https://plausible.example.com)' },
      { name: 'SECRET_KEY_BASE', description: '64-byte secret (openssl rand -base64 48)' },
    ],
    env_optional: [{ name: 'DISABLE_REGISTRATION', default: 'invite_only', description: 'Registration mode' }],
    ports: [8000],
    volumes: [{ host: '/data/plausible/db', container: '/var/lib/clickhouse' }],
    health_check: { url: 'http://localhost:8000/api/health', timeout: 90 },
    docs: 'https://plausible.io/docs/self-hosting',
  },
  {
    name: 'uptime-kuma',
    description: 'Self-hosted uptime monitoring',
    repo: 'https://github.com/louislam/uptime-kuma',
    type: 'image',
    env_required: [],
    env_optional: [],
    ports: [3001],
    volumes: [{ host: '/data/uptime-kuma', container: '/app/data' }],
    health_check: { url: 'http://localhost:3001', timeout: 30 },
    docs: 'https://github.com/louislam/uptime-kuma/wiki',
  },
  {
    name: 'n8n',
    description: 'Workflow automation platform',
    repo: 'https://github.com/n8n-io/n8n',
    type: 'image',
    env_required: [],
    env_optional: [{ name: 'N8N_BASIC_AUTH_USER', default: 'admin', description: 'Basic auth username' }],
    ports: [5678],
    volumes: [{ host: '/data/n8n', container: '/home/node/.n8n' }],
    health_check: { url: 'http://localhost:5678/healthz', timeout: 30 },
    docs: 'https://docs.n8n.io/hosting/',
  },
  {
    name: 'vaultwarden',
    description: 'Lightweight Bitwarden-compatible password manager',
    repo: 'https://github.com/dani-garcia/vaultwarden',
    type: 'image',
    env_required: [],
    env_optional: [{ name: 'SIGNUPS_ALLOWED', default: 'false', description: 'Allow new signups' }],
    ports: [80],
    volumes: [{ host: '/data/vaultwarden', container: '/data' }],
    health_check: { url: 'http://localhost:80/alive', timeout: 30 },
    docs: 'https://github.com/dani-garcia/vaultwarden/wiki',
  },
  {
    name: 'immich',
    description: 'Self-hosted photo and video backup — Google Photos alternative',
    repo: 'https://github.com/immich-app/immich',
    type: 'docker-compose',
    env_required: [{ name: 'UPLOAD_LOCATION', description: 'Path for photo storage (e.g. /data/immich/upload)' }],
    env_optional: [{ name: 'DB_PASSWORD', default: 'postgres', description: 'PostgreSQL password' }],
    ports: [2283],
    volumes: [{ host: '/data/immich/upload', container: '/usr/src/app/upload' }],
    health_check: { url: 'http://localhost:2283/api/server-info/ping', timeout: 90 },
    docs: 'https://immich.app/docs/install/docker-compose',
    min_ram: '4GB',
  },
  {
    name: 'seafile',
    description: 'Self-hosted file sync and share — Google Drive alternative',
    repo: 'https://github.com/haiwen/seafile-docker',
    type: 'docker-compose',
    env_required: [
      { name: 'SEAFILE_ADMIN_EMAIL', description: 'Admin email' },
      { name: 'SEAFILE_ADMIN_PASSWORD', description: 'Admin password' },
    ],
    env_optional: [{ name: 'SEAFILE_SERVER_HOSTNAME', default: 'localhost', description: 'Server hostname' }],
    ports: [80],
    volumes: [{ host: '/data/seafile', container: '/shared' }],
    health_check: { url: 'http://localhost:80', timeout: 60 },
    docs: 'https://manual.seafile.com/docker/deploy_seafile_with_docker/',
  },
  {
    name: 'minio',
    description: 'S3-compatible object storage — self-hosted AWS S3',
    repo: 'https://github.com/minio/minio',
    type: 'image',
    env_required: [
      { name: 'MINIO_ROOT_USER', description: 'Root username' },
      { name: 'MINIO_ROOT_PASSWORD', description: 'Root password (min 8 chars)' },
    ],
    env_optional: [],
    ports: [9000, 9001],
    volumes: [{ host: '/data/minio', container: '/data' }],
    health_check: { url: 'http://localhost:9000/minio/health/live', timeout: 30 },
    docs: 'https://min.io/docs/minio/container/index.html',
  },
];

export function loadTemplate(name: string): Template {
  const t = TEMPLATES.find((t) => t.name === name);
  if (!t) throw new Error(`Unknown template "${name}". Run \`canopy templates\` to see available templates.`);
  return t;
}

export function listTemplates(): Template[] {
  return TEMPLATES;
}

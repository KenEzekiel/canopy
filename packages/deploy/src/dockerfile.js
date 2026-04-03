'use strict';

const { detectEntryPoint, detectPackageManager } = require('./detect');

/**
 * Get install + build commands for a package manager.
 */
function pmCommands(pm) {
  if (pm === 'pnpm') return { install: 'corepack enable && pnpm install --frozen-lockfile', installProd: 'corepack enable && pnpm install --frozen-lockfile --prod', build: 'pnpm run build', copy: 'COPY pnpm-lock.yaml ./' };
  if (pm === 'yarn') return { install: 'yarn install --frozen-lockfile', installProd: 'yarn install --frozen-lockfile --production', build: 'yarn build', copy: 'COPY yarn.lock ./' };
  return { install: 'npm ci', installProd: 'npm ci --production', build: 'npm run build', copy: '' };
}

function lockfileCopy(pm) {
  if (pm === 'pnpm') return 'COPY pnpm-lock.yaml ./\n';
  if (pm === 'yarn') return 'COPY yarn.lock ./\n';
  return '';
}

const TEMPLATES = {
  nextjs: (projectPath) => {
    const pm = detectPackageManager(projectPath);
    const c = pmCommands(pm);
    return `FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
${lockfileCopy(pm)}RUN ${c.install}
COPY . .
RUN ${c.build}

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 3000
CMD ["npx", "next", "start"]
`;
  },

  'vite-react': (projectPath) => {
    const pm = detectPackageManager(projectPath);
    const c = pmCommands(pm);
    return `FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
${lockfileCopy(pm)}RUN ${c.install}
COPY . .
RUN ${c.build}

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  location / {\\n    try_files $uri $uri/ /index.html;\\n  }\\n}\\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
`;
  },

  'node-api': (projectPath) => {
    const pm = detectPackageManager(projectPath);
    const c = pmCommands(pm);
    const entry = detectEntryPoint(projectPath);
    return `FROM node:22-alpine
WORKDIR /app
COPY package.json ./
${lockfileCopy(pm)}RUN ${c.installProd}
COPY . .
EXPOSE 3000
CMD ["node", "${entry}"]
`;
  },

  static: () => `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`,

  'generic-node': (projectPath) => {
    const pm = detectPackageManager(projectPath);
    const c = pmCommands(pm);
    return `FROM node:22-alpine
WORKDIR /app
COPY package.json ./
${lockfileCopy(pm)}RUN ${c.install}
COPY . .
RUN ${c.build}
EXPOSE 3000
CMD ["${pm}", "start"]
`;
  },
};

function generateDockerfile(framework, projectPath) {
  const tmpl = TEMPLATES[framework];
  if (!tmpl) throw new Error(`Unknown framework: ${framework}`);
  return tmpl(projectPath);
}

function getContainerPort(framework) {
  return (framework === 'vite-react' || framework === 'static') ? 80 : 3000;
}

module.exports = { generateDockerfile, getContainerPort };

# Contributing to Canopy

Thanks for your interest in contributing.

## Setup

```bash
git clone https://github.com/KenEzekiel/canopy.git
cd canopy
npm install
npm run build
```

## Project structure

- `packages/scanner/` — Security scanner engine (TypeScript)
- `packages/deploy/` — Deploy engine: Hetzner API, SSH, Docker (TypeScript)
- `packages/cli/` — CLI commands (TypeScript, compiles to dist/)

## Build

```bash
npm run build    # builds all packages: scanner → deploy → cli
```

Build order matters — deploy depends on scanner, cli depends on both.

## Testing

```bash
npx canopy-deploy scan /path/to/project          # test scanner
npx canopy-deploy deploy /path --name test-app   # test deploy (needs CANOPY_HETZNER_TOKEN)
```

## Code style

- TypeScript strict mode
- No external dependencies in scanner (pure Node.js)
- Deploy uses only `ssh2` as external dependency
- CLI uses only `commander`

## Pull requests

- One feature per PR
- Include what changed and why
- Test against a real project before submitting
- Read and agree to the [Contributor License Agreement](/.github/CLA.md)

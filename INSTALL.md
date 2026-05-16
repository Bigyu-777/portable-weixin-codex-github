# Install Guide

This repository is a prebuilt standalone runtime snapshot. It is intended to be cloned and run directly without a TypeScript build step.

## What Was Fixed

Earlier incomplete snapshots could fail with errors such as:

- `Cannot find module '.../dist/standalone.js'`
- missing `dist/src/standalone/...`
- `standalone.ts` referencing `./src/...` while no top-level `src/` existed

This repository now includes the full `dist/` runtime required by:

- `standalone-run.sh`
- `standalone-run.bat`
- `node dist/standalone.js ...`

## Requirements

- Node.js 22+
- `codex` CLI available in `PATH`, or update `standalone-config.json`

## Quick Start

```bash
npm install
./standalone-login.sh
./standalone-run.sh
```

Windows:

```bat
standalone-run.bat login
standalone-run.bat run
```

## Multi-Instance

```bash
./standalone-instance.sh team1 init
./standalone-instance.sh team1 login
systemctl --user enable --now weixin-codex@team1.service
```

## Notes

- This repo is distributed as a runnable snapshot, not a TypeScript source tree.
- `dist/` is required and is intentionally versioned in this repository.
- Do not remove `dist/` from git if you want fresh clones to run directly.

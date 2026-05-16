# Portable Weixin Codex

[简体中文](./README.zh_CN.md)

Standalone WeChat-to-Codex bridge for running Codex conversations from WeChat. This repo is packaged for self-hosted deployment and multi-account operation.

## Features

- Standalone WeChat bridge with QR login
- One session directory per contact
- One Codex thread per contact
- Per-contact model switching with `/model`
- Per-contact reasoning-effort switching with `/effort`
- `/send` support for sending referenced files back to the user
- Optional multi-instance deployment: one WeChat account per service instance
- systemd user service templates for auto-start

## Repository Layout

- `dist/`: compiled runtime
- `standalone-run.sh`: default single-account runner
- `standalone-instance.sh`: multi-instance runner
- `standalone-config.json`: safe default local config
- `standalone-config.example.json`: example config for new deployments
- `deployment/systemd/`: example systemd user service files

## Requirements

- Node.js 22+
- A working `codex` CLI in `PATH`, or adjust `codexCommand`
- Linux with `systemd --user` if you want auto-start

## Quick Start

### Single account

```bash
npm install
./standalone-login.sh
./standalone-run.sh
```

### Multi-account

Initialize a named instance:

```bash
./standalone-instance.sh team1 init
./standalone-instance.sh team1 login
./standalone-instance.sh team1 run
```

This creates isolated runtime state under:

- state: `~/.openclaw-weixin/team1`
- sessions: `./wecaht/team1` by default

## Auto Start

Copy one of the service files from `deployment/systemd/` into:

```bash
~/.config/systemd/user/
```

Reload and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now weixin-codex-standalone.service
```

For multi-account instances:

```bash
systemctl --user enable --now weixin-codex@team1.service
```

## Configuration

`standalone-config.json` fields:

- `sessionRoot`: where contact session directories are stored
- `httpProxy`: optional outbound proxy
- `disableLocalProxy`: disable built-in local proxy usage
- `codexCommand`: path to the Codex CLI
- `codexWorkdir`: working directory passed to Codex
- `codexTimeoutMs`: `0` means no timeout

## WeChat Commands

- `/help`: show command help
- `/where`: show current session root and thread info
- `/ls`: list files in the current contact session directory
- `/model`: show current model and available models
- `/model <index|name>`: switch model for the current contact
- `/effort`: show current reasoning effort and available levels
- `/effort <index|name>`: switch reasoning effort for the current contact
- `/send`: send the quoted file back if resolvable
- `/send <filename>`: fuzzy-match and send a file from the current session directory
- `/new`: start a fresh contact session directory and Codex thread
- `/reset`: clear the current contact binding

## Security

Do not commit runtime login state or session data.

Sensitive runtime files include:

- `~/.openclaw/weixin-codex-direct/auth.json`
- `~/.openclaw/weixin-codex-direct/peer-sessions.json`
- `~/.openclaw/weixin-codex-direct/media-index.json`
- `~/.openclaw-weixin/<instance>/...`
- local `wecaht/` session folders

See [SECURITY.md](./SECURITY.md).

## Packaging Notes

This release copy is sanitized for publication:

- no live `auth.json`
- no peer session cache
- no media index
- no per-instance runtime config from local deployments

## Development Notes

- The runtime in this repo is compiled JavaScript under `dist/`
- If you modify runtime behavior directly here, keep changes in `dist/` consistent
- Re-scan release artifacts before publishing any archive

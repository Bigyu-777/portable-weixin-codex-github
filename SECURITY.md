# Security Notes

## Do Not Commit Runtime State

This project uses local runtime state for WeChat login and session routing. The following files and directories can contain active credentials, conversation metadata, or user content and must never be committed:

- `~/.openclaw/weixin-codex-direct/auth.json`
- `~/.openclaw/weixin-codex-direct/peer-sessions.json`
- `~/.openclaw/weixin-codex-direct/media-index.json`
- `~/.openclaw-weixin/<instance>/...`
- `instances/*/standalone-config.json` after local customization
- any session root such as `wecaht/`

## Sensitive Values

Treat these as secrets:

- WeChat bot tokens
- `contextToken` values
- account-specific `auth.json` files
- OpenClaw gateway tokens or plugin credentials

## Recommended Release Workflow

1. Build and test in a private workspace.
2. Copy only source, docs, and example configs into a clean release directory.
3. Re-scan the release directory for `token`, `auth`, `contextToken`, `Bearer`, and `password`.
4. Publish only the sanitized release directory.

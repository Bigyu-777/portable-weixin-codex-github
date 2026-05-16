#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

INSTANCE="${1:-}"
COMMAND="${2:-run}"

if [[ -z "$INSTANCE" ]]; then
  echo "用法: $0 <instance> <init|login|run|logout|print-env>"
  exit 1
fi

INSTANCE_DIR="$SCRIPT_DIR/instances/$INSTANCE"
CONFIG_FILE="$INSTANCE_DIR/standalone-config.json"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw-weixin/$INSTANCE}"
SESSION_ROOT_DEFAULT="/home/openclaw/wecaht/$INSTANCE"

mkdir -p "$INSTANCE_DIR"
mkdir -p "$STATE_DIR"

ensure_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    return 0
  fi

  cat >"$CONFIG_FILE" <<EOF
{
  "sessionRoot": "$SESSION_ROOT_DEFAULT",
  "httpProxy": "",
  "disableLocalProxy": true,
  "codexCommand": "/home/openclaw/.local/bin/codex",
  "codexWorkdir": "/home/openclaw",
  "codexTimeoutMs": 0
}
EOF
}

case "$COMMAND" in
  init)
    ensure_config
    echo "instance=$INSTANCE"
    echo "config=$CONFIG_FILE"
    echo "state=$STATE_DIR"
    ;;
  print-env)
    ensure_config
    echo "WEIXIN_STANDALONE_CONFIG=$CONFIG_FILE"
    echo "OPENCLAW_STATE_DIR=$STATE_DIR"
    ;;
  login|run|logout)
    ensure_config
    export WEIXIN_STANDALONE_CONFIG="$CONFIG_FILE"
    export OPENCLAW_STATE_DIR="$STATE_DIR"
    exec node dist/standalone.js "$COMMAND"
    ;;
  *)
    echo "未知命令: $COMMAND"
    echo "用法: $0 <instance> <init|login|run|logout|print-env>"
    exit 1
    ;;
esac

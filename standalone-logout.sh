#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export WEIXIN_STANDALONE_CONFIG="$SCRIPT_DIR/standalone-config.json"

exec node dist/standalone.js logout

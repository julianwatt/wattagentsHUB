#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote environment).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Install Node dependencies for the Next.js project.
# `npm install` is preferred over `npm ci` so the cached container state
# can be reused across sessions without wiping node_modules every time.
npm install --no-audit --no-fund --prefer-offline

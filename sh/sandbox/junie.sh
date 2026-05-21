#!/bin/bash
set -eo pipefail

# Thin shim for the `sandbox` cloud: runs the agent inside a throwaway Docker
# container on this machine. Ensures bun is available, then runs bundled
# sandbox.js (local source or from the GitHub release).

_ensure_bun() {
    if command -v bun &>/dev/null; then return 0; fi
    printf '\033[0;36mInstalling bun...\033[0m\n' >&2
    curl -fsSL --proto '=https' --show-error https://bun.sh/install?version=1.3.9 | bash >/dev/null || { printf '\033[0;31mFailed to install bun\033[0m\n' >&2; exit 1; }
    export PATH="$HOME/.bun/bin:$PATH"
    command -v bun &>/dev/null || { printf '\033[0;31mbun not found after install\033[0m\n' >&2; exit 1; }
}

_ensure_bun

# SPAWN_CLI_DIR override — force local source (used by e2e tests)
if [[ -n "${SPAWN_CLI_DIR:-}" && -f "$SPAWN_CLI_DIR/packages/cli/src/sandbox/main.ts" ]]; then
    exec bun run "$SPAWN_CLI_DIR/packages/cli/src/sandbox/main.ts" junie "$@"
fi

# Remote — download bundled sandbox.js from GitHub release
SANDBOX_JS=$(mktemp)
trap 'rm -f "$SANDBOX_JS"' EXIT
curl -fsSL --proto '=https' "https://github.com/OpenRouterTeam/spawn/releases/download/sandbox-latest/sandbox.js" -o "$SANDBOX_JS" \
    || { printf '\033[0;31mFailed to download sandbox.js\033[0m\n' >&2; exit 1; }

exec bun run "$SANDBOX_JS" junie "$@"

# Local Sandbox

Run agents inside a throwaway Docker container on your own machine.

> Same setup as the `local` cloud, but the agent runs in an isolated Docker container instead of directly on your host. No account or payment needed. Docker is auto-installed if missing, and the container is removed when the session ends — so the agent can't touch your host filesystem, shell, or SSH keys.

This was previously the `--beta sandbox` flag on the `local` cloud. It is now a first-class cloud.

## Quick Start

If you have the [spawn CLI](https://github.com/OpenRouterTeam/spawn) installed:

```bash
spawn claude sandbox
spawn openclaw sandbox
spawn codex sandbox
spawn opencode sandbox
spawn kilocode sandbox
spawn hermes sandbox
spawn junie sandbox
spawn cursor sandbox
spawn pi sandbox
spawn t3code sandbox
```

Or run directly without the CLI:

```bash
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/claude.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/openclaw.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/codex.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/opencode.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/kilocode.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/hermes.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/junie.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/cursor.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/pi.sh)
bash <(curl -fsSL https://openrouter.ai/labs/spawn/sandbox/t3code.sh)
```

## Requirements

- **Docker** — auto-installed if missing (OrbStack on macOS, `docker.io` via apt on Linux).
- **`OPENROUTER_API_KEY`** — prompted interactively, or set in the environment.

## How it works

The `sandbox` cloud reuses the `local` orchestrator with a Docker-wrapped runner:

1. Ensure Docker is installed and running.
2. Pull the agent image `ghcr.io/openrouterteam/spawn-<agent>:latest` and start a container.
3. Inject OpenRouter credentials and write agent config files **inside the container**.
4. Drop into an interactive session via `docker exec -it`.
5. Remove the container on exit.

## Notes

- Agents that need a Docker image: `claude`, `codex`, `cursor`, `hermes`, `junie`, `kilocode`, `openclaw`, `opencode`, `pi`, `t3code`. The container images are built from `sh/docker/<agent>.Dockerfile`.
- For host-native execution (no container), use the [`local`](../local/README.md) cloud instead.

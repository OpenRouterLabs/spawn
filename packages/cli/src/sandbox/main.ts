#!/usr/bin/env bun

// sandbox/main.ts — Orchestrator: deploys an agent inside a local Docker sandbox.
//
// The `sandbox` cloud reuses the `local` orchestrator with the Docker-wrapped
// runner enabled, so the agent runs in a throwaway container on the host
// machine. Docker is auto-installed if missing; the container is removed on
// exit. See local/run.ts for the shared implementation.

import { getErrorMessage } from "@openrouter/spawn-shared";
import pkg from "../../package.json" with { type: "json" };
import { agents } from "../local/agents.js";
import { runLocalAgent } from "../local/run.js";
import { initTelemetry } from "../shared/telemetry.js";

async function main() {
  const agentName = process.argv[2];
  if (!agentName) {
    console.error("Usage: bun run sandbox/main.ts <agent>");
    console.error(`Agents: ${Object.keys(agents).join(", ")}`);
    process.exit(1);
  }

  await runLocalAgent(agentName, true);
}

initTelemetry(pkg.version);
main().catch((err) => {
  process.stderr.write(`\x1b[0;31mFatal: ${getErrorMessage(err)}\x1b[0m\n`);
  process.exit(1);
});

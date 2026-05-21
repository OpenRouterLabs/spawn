#!/usr/bin/env bun

// local/main.ts — Orchestrator: deploys an agent on the local machine.
//
// For the isolated Docker-container variant, see sandbox/main.ts — both share
// the orchestration in local/run.ts.

import { getErrorMessage } from "@openrouter/spawn-shared";
import pkg from "../../package.json" with { type: "json" };
import { initTelemetry } from "../shared/telemetry.js";
import { agents } from "./agents.js";
import { runLocalAgent } from "./run.js";

async function main() {
  const agentName = process.argv[2];
  if (!agentName) {
    console.error("Usage: bun run local/main.ts <agent>");
    console.error(`Agents: ${Object.keys(agents).join(", ")}`);
    process.exit(1);
  }

  await runLocalAgent(agentName, false);
}

initTelemetry(pkg.version);
main().catch((err) => {
  process.stderr.write(`\x1b[0;31mFatal: ${getErrorMessage(err)}\x1b[0m\n`);
  process.exit(1);
});

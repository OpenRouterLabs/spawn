// local/run.ts — Shared orchestration for the `local` and `sandbox` clouds.
//
// `local`   runs the agent directly on the host machine.
// `sandbox` runs the agent inside a throwaway Docker container on the host.
//
// Both share one code path; `useSandbox` swaps in the Docker-wrapped runner,
// container lifecycle, and interactive session. The orchestrator's internal
// `cloudName` stays "local" either way — orchestrate.ts has ~20 `!== "local"`
// branches (tarball install, repo cloning, restart loops, reconnects, skills)
// that must treat the sandbox as local execution. The user-facing `sandbox`
// cloud name is tracked separately by the run/headless command layer.

import type { CloudOrchestrator } from "../shared/orchestrate.js";

import * as p from "@clack/prompts";
import { createCloudAgents } from "../shared/agent-setup.js";
import { makeDockerRunner, runOrchestration } from "../shared/orchestrate.js";
import { logWarn } from "../shared/ui.js";
import { resolveAgent } from "./agents.js";
import {
  cleanupContainer,
  dockerInteractiveSession,
  downloadFile,
  ensureDocker,
  interactiveSession,
  pullAndStartContainer,
  runLocal,
  uploadFile,
} from "./local.js";

/**
 * Deploy an agent on the local machine.
 *
 * @param agentName  Agent key (e.g. "claude", "hermes").
 * @param useSandbox When true, the agent runs inside a Docker container
 *                   (the `sandbox` cloud); otherwise it runs directly on the
 *                   host (the `local` cloud).
 */
export async function runLocalAgent(agentName: string, useSandbox: boolean): Promise<void> {
  const baseRunner = {
    runServer: runLocal,
    uploadFile: async (l: string, r: string) => uploadFile(l, r),
    downloadFile: async (r: string, l: string) => downloadFile(r, l),
  };

  // When sandboxed, recreate agents with the Docker-wrapped runner so that
  // agent.configure() / agent.install() closures execute inside the container
  // instead of writing config files directly to the host filesystem.
  const agent = useSandbox
    ? createCloudAgents(makeDockerRunner(baseRunner)).resolveAgent(agentName)
    : resolveAgent(agentName);

  // If sandboxed, ensure Docker is installed (auto-install if missing)
  if (useSandbox) {
    await ensureDocker();
  }

  // Warn about security implications of installing OpenClaw locally
  // (skip warning in sandbox mode — the container provides isolation)
  if (agentName === "openclaw" && !useSandbox && process.env.SPAWN_NON_INTERACTIVE !== "1") {
    process.stderr.write("\n");
    logWarn("⚠  Local installation warning");
    logWarn(`   This will install ${agent.name} directly on your machine.`);
    logWarn("   The agent will have full access to your filesystem, shell, and network.");
    logWarn("   For isolation, consider running on a cloud VM instead.\n");

    const confirmed = await p.confirm({
      message: "Continue with local installation?",
      initialValue: true,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Installation cancelled.");
      process.exit(0);
    }
  }

  const cloud: CloudOrchestrator = {
    cloudName: "local",
    cloudLabel: useSandbox ? "local (sandboxed)" : "local",
    skipAgentInstall: false,
    runner: useSandbox ? makeDockerRunner(baseRunner) : baseRunner,
    async authenticate() {},
    async promptSize() {},
    async createServer(_name: string) {
      return {
        ip: "localhost",
        user: process.env.USER || "local",
        cloud: "local",
      };
    },
    async getServerName() {
      const result = Bun.spawnSync(
        [
          "hostname",
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "ignore",
          ],
        },
      );
      return new TextDecoder().decode(result.stdout).trim() || "local";
    },
    async waitForReady() {
      if (useSandbox) {
        await pullAndStartContainer(agentName);
        cloud.skipAgentInstall = true;
      }
    },
    interactiveSession: useSandbox ? dockerInteractiveSession : interactiveSession,
  };

  // Clean up sandbox container on exit
  if (useSandbox) {
    process.on("exit", cleanupContainer);
  }

  await runOrchestration(cloud, agent, agentName);
}

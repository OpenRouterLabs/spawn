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
  // Warn that local spawning executes commands directly on the user's machine.
  // Skip in non-interactive mode (headless / CI) and when sandbox is already active.
  if (!useSandbox && process.env.SPAWN_NON_INTERACTIVE !== "1") {
    process.stderr.write("\n");
    logWarn("⚠  Local execution warning");
    logWarn("   Spawning locally will execute commands directly on this machine.");
    logWarn("   The agent will have full access to your filesystem, shell, and network.\n");

    const action = await p.select<"ok" | "sandbox" | "cancel">({
      message: "How would you like to proceed?",
      options: [
        {
          value: "ok",
          label: "Ok",
          hint: "proceed — execute directly on this machine",
        },
        {
          value: "sandbox",
          label: "Sandbox",
          hint: "run inside a Docker container instead",
        },
        {
          value: "cancel",
          label: "Cancel",
          hint: "abort the operation",
        },
      ],
    });

    if (p.isCancel(action) || action === "cancel") {
      p.log.info("Operation cancelled.");
      process.exit(0);
    }

    if (action === "sandbox") {
      return runLocalAgent(agentName, true);
    }
  }

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

/**
 * ssh-keys-cov.test.ts — Additional edge-case coverage for shared/ssh-keys.ts.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tryCatch } from "@openrouter/spawn-shared";
import { mockClackPrompts } from "./test-helpers";

mockClackPrompts({
  select: mock(() => Promise.resolve("")),
  text: mock(() => Promise.resolve("")),
});

const { discoverLegacyKeys, getSpawnKey, getSshFingerprint, _resetCache } = await import("../shared/ssh-keys.js");

let tmpDir: string;
let origHome: string | undefined;
let stderrSpy: ReturnType<typeof spyOn>;

function makeSyncResult(text: string, exitCode = 0): Bun.SyncSubprocess<"pipe", "pipe"> {
  return {
    exitCode,
    stdout: Buffer.from(text),
    stderr: Buffer.alloc(0),
    success: exitCode === 0,
    pid: 0,
    resourceUsage: {
      cpuTime: {
        system: 0,
        user: 0,
        total: 0,
      },
      maxRSS: 0,
      sharedMemorySize: 0,
      unsharedDataSize: 0,
      unsharedStackSize: 0,
      minorPageFaults: 0,
      majorPageFaults: 0,
      swapCount: 0,
      inBlock: 0,
      outBlock: 0,
      ipcMessagesSent: 0,
      ipcMessagesReceived: 0,
      signalsReceived: 0,
      voluntaryContextSwitches: 0,
      involuntaryContextSwitches: 0,
    },
  };
}

beforeEach(() => {
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  _resetCache();
  tmpDir = `/tmp/spawn-sshkeys-cov-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(tmpDir, {
    recursive: true,
  });
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
});

afterEach(() => {
  stderrSpy?.mockRestore();
  process.env.HOME = origHome;
  tryCatch(() =>
    rmSync(tmpDir, {
      recursive: true,
      force: true,
    }),
  );
});

describe("getSpawnKey race recovery", () => {
  it("recovers when ssh-keygen fails but key files appeared", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
      mode: 0o700,
    });
    const privPath = join(sshDir, "spawn_ed25519");
    const pubPath = `${privPath}.pub`;

    let callCount = 0;
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // ssh-keygen "fails" but files appear (race)
        writeFileSync(privPath, "fake-priv\n", {
          mode: 0o600,
        });
        writeFileSync(pubPath, "ssh-ed25519 AAAA fake\n");
        return makeSyncResult("", 1);
      }
      return makeSyncResult("256 SHA256:abc user@host (ED25519)");
    });

    const pair = getSpawnKey();
    spawnSpy.mockRestore();
    expect(pair.name).toBe("spawn_ed25519");
    expect(existsSync(pair.privPath)).toBe(true);
  });

  it("throws when ssh-keygen fails and no files were created", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
      mode: 0o700,
    });

    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(makeSyncResult("", 1));

    expect(() => getSpawnKey()).toThrow("Spawn SSH key generation failed");
    spawnSpy.mockRestore();
  });
});

describe("discoverLegacyKeys edge cases", () => {
  it("labels legacy key as UNKNOWN when ssh-keygen has no parenthesized type", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(join(sshDir, "id_rsa"), "fake-priv\n", {
      mode: 0o600,
    });
    writeFileSync(join(sshDir, "id_rsa.pub"), "ssh-rsa AAAA fake\n");

    // verifyKeyPair → match (deriv reads pub), getKeyType → no type
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation((args: string[]) => {
      if (args[1] === "-y") {
        return makeSyncResult("ssh-rsa AAAA fake\n");
      }
      return makeSyncResult("256 SHA256:abc user@host"); // no (TYPE) suffix
    });

    const keys = discoverLegacyKeys();
    spawnSpy.mockRestore();
    expect(keys).toHaveLength(1);
    expect(keys[0].type).toBe("UNKNOWN");
  });

  it("skips passphrase-protected legacy keys (verifyKeyPair → unverifiable)", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(join(sshDir, "id_ed25519"), "fake-priv\n", {
      mode: 0o600,
    });
    writeFileSync(join(sshDir, "id_ed25519.pub"), "ssh-ed25519 AAAA fake\n");

    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(makeSyncResult("", 1));
    const keys = discoverLegacyKeys();
    spawnSpy.mockRestore();
    expect(keys).toEqual([]);
  });
});

describe("getSshFingerprint edge cases", () => {
  it("returns empty string when output has no MD5 match", () => {
    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      makeSyncResult("256 SHA256:abc user@host (ED25519)"), // No MD5
    );
    const fp = getSshFingerprint("/tmp/fake.pub");
    spawnSpy.mockRestore();
    expect(fp).toBe("");
  });

  it("returns empty string when ssh-keygen is not found (spawnSync throws)", () => {
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("Executable not found in $PATH: ssh-keygen");
    });
    const fp = getSshFingerprint("/tmp/fake.pub");
    spawnSpy.mockRestore();
    expect(fp).toBe("");
  });
});

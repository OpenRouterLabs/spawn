/**
 * ssh-keys.test.ts — Tests for the spawn-owned SSH key with legacy fallback.
 *
 * Uses real temp directories for filesystem tests and spyOn(Bun, "spawnSync")
 * to mock ssh-keygen invocations — no real subprocess calls.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tryCatch } from "@openrouter/spawn-shared";
import { mockClackPrompts } from "./test-helpers";

mockClackPrompts({
  select: mock(() => Promise.resolve("")),
  text: mock(() => Promise.resolve("")),
});

// ── Import after @clack/prompts mock ────────────────────────────────────────

const {
  getSpawnKey,
  discoverLegacyKeys,
  getSshFingerprint,
  ensureSshKeys,
  getSshKeyOpts,
  verifyKeyPair,
  repairPubFromPriv,
  SPAWN_KEY_NAME,
  _resetCache,
} = await import("../shared/ssh-keys");

// ─── Temp dir helpers ───────────────────────────────────────────────────────

let tmpDir: string;
let origHome: string | undefined;

function setupTmpHome() {
  tmpDir = `/tmp/spawn-ssh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(tmpDir, {
    recursive: true,
  });
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
}

function cleanupTmpHome() {
  process.env.HOME = origHome;
  tryCatch(() =>
    rmSync(tmpDir, {
      recursive: true,
      force: true,
    }),
  );
}

/** Create a fake key pair on disk. Does not call subprocesses. */
function createFakeKeyPair(name: string, keyType: "ed25519" | "rsa" = "ed25519") {
  const sshDir = join(tmpDir, ".ssh");
  mkdirSync(sshDir, {
    recursive: true,
    mode: 0o700,
  });
  const privPath = join(sshDir, name);
  const pubPath = `${privPath}.pub`;

  writeFileSync(privPath, "fake-private-key\n", {
    mode: 0o600,
  });
  if (keyType === "ed25519") {
    writeFileSync(pubPath, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake test\n");
  } else {
    writeFileSync(pubPath, "ssh-rsa AAAAFake test\n");
  }

  return {
    privPath,
    pubPath,
  };
}

/** Build a minimal ReadableSyncSubprocess with stdout containing text. */
function makeSyncResult(text: string, exitCode = 0): Bun.SyncSubprocess<"pipe", "pipe"> {
  const buf = Buffer.from(text);
  return {
    exitCode,
    stdout: buf,
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

function sshKeygenLfResult(keyType: string): Bun.SyncSubprocess<"pipe", "pipe"> {
  return makeSyncResult(`256 SHA256:fakehash user@host (${keyType})`);
}

function sshKeygenMd5Result(): Bun.SyncSubprocess<"pipe", "pipe"> {
  return makeSyncResult("256 MD5:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99 user@host (ED25519)");
}

/**
 * Smart mock for Bun.spawnSync that handles all ssh-keygen invocations:
 *   - `ssh-keygen -y -P "" -f <priv>` (verifyKeyPair) — returns the .pub contents
 *   - `ssh-keygen -lf <pub>` (getKeyType) — returns lf output
 *   - `ssh-keygen -lf <pub> -E md5` (getSshFingerprint) — returns MD5 output
 *
 * Pass `mismatch: true` to make verifyKeyPair return a mismatched derivation.
 */
function smartSshKeygenMock(opts: { mismatch?: boolean } = {}): (args: string[]) => Bun.SyncSubprocess<"pipe", "pipe"> {
  return (args: string[]) => {
    if (args[1] === "-y") {
      const privPath = String(args[args.length - 1]);
      const pubPath = `${privPath}.pub`;
      if (opts.mismatch) {
        return makeSyncResult("ssh-ed25519 AAAADIFFERENT spawn\n");
      }
      const r = tryCatch(() => readFileSync(pubPath, "utf-8"));
      return makeSyncResult(r.ok ? r.data : "");
    }
    if (args.includes("-E") && args[args.indexOf("-E") + 1] === "md5") {
      return sshKeygenMd5Result();
    }
    if (args[1] === "-lf") {
      const pubPath = String(args[2]);
      const type = pubPath.includes("rsa") ? "RSA" : "ED25519";
      return sshKeygenLfResult(type);
    }
    return makeSyncResult("");
  };
}

/** Mock ssh-keygen generation: write the expected output files so existsSync passes. */
function sshKeygenGenerateResult(privPath: string): Bun.SyncSubprocess<"pipe", "pipe"> {
  const pubPath = `${privPath}.pub`;
  writeFileSync(privPath, "fake-private-key\n", {
    mode: 0o600,
  });
  writeFileSync(pubPath, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake spawn\n");
  return makeSyncResult("");
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  _resetCache();
  process.env.SPAWN_NON_INTERACTIVE = "";
  setupTmpHome();
});

afterEach(() => {
  cleanupTmpHome();
});

// ─── getSpawnKey ────────────────────────────────────────────────────────────

describe("getSpawnKey", () => {
  it("generates the spawn key when it does not exist", () => {
    const sshDir = join(tmpDir, ".ssh");
    const privPath = join(sshDir, SPAWN_KEY_NAME);

    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(() => sshKeygenGenerateResult(privPath));
    const pair = getSpawnKey();
    spawnSpy.mockRestore();

    expect(pair.name).toBe(SPAWN_KEY_NAME);
    expect(pair.type).toBe("ED25519");
    expect(pair.privPath).toBe(privPath);
    expect(pair.pubPath).toBe(`${privPath}.pub`);
    expect(existsSync(pair.privPath)).toBe(true);
    expect(existsSync(pair.pubPath)).toBe(true);
  });

  it("reuses existing spawn key without regenerating", () => {
    createFakeKeyPair(SPAWN_KEY_NAME, "ed25519");

    let generateCalls = 0;
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation((args: string[]) => {
      if (args[0] === "ssh-keygen" && args[1] === "-t") {
        generateCalls++;
      }
      return sshKeygenLfResult("ED25519");
    });

    const pair = getSpawnKey();
    spawnSpy.mockRestore();

    expect(generateCalls).toBe(0);
    expect(pair.name).toBe(SPAWN_KEY_NAME);
  });

  it("recovers when ssh-keygen exits non-zero but files appear (race)", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
      mode: 0o700,
    });
    const privPath = join(sshDir, SPAWN_KEY_NAME);
    const pubPath = `${privPath}.pub`;

    let callCount = 0;
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // ssh-keygen "fails" but files appear (race with another process)
        writeFileSync(privPath, "fake-priv\n", {
          mode: 0o600,
        });
        writeFileSync(pubPath, "ssh-ed25519 AAAA fake\n");
        return makeSyncResult("", 1);
      }
      return sshKeygenLfResult("ED25519");
    });

    const pair = getSpawnKey();
    spawnSpy.mockRestore();
    expect(pair.name).toBe(SPAWN_KEY_NAME);
    expect(existsSync(pair.privPath)).toBe(true);
  });

  it("throws when ssh-keygen fails and no files were created", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
      mode: 0o700,
    });
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(makeSyncResult("", 1));
    expect(() => getSpawnKey()).toThrow("Spawn SSH key generation failed");
    spawnSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

// ─── discoverLegacyKeys ─────────────────────────────────────────────────────

describe("discoverLegacyKeys", () => {
  it("returns empty array when ~/.ssh does not exist", () => {
    expect(discoverLegacyKeys()).toEqual([]);
  });

  it("returns empty array when no default-named keys exist", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
    });
    writeFileSync(join(sshDir, "config"), "Host *\n");
    expect(discoverLegacyKeys()).toEqual([]);
  });

  it("ignores custom-named keys (only finds default names)", () => {
    createFakeKeyPair("work_key", "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(smartSshKeygenMock());
    const keys = discoverLegacyKeys();
    spawnSpy.mockRestore();
    expect(keys).toEqual([]);
  });

  it("excludes the spawn key itself", () => {
    createFakeKeyPair(SPAWN_KEY_NAME, "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(smartSshKeygenMock());
    const keys = discoverLegacyKeys();
    spawnSpy.mockRestore();
    expect(keys).toEqual([]);
  });

  it("finds id_ed25519 and id_rsa when present and valid", () => {
    createFakeKeyPair("id_ed25519", "ed25519");
    createFakeKeyPair("id_rsa", "rsa");
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(smartSshKeygenMock());
    const keys = discoverLegacyKeys();
    spawnSpy.mockRestore();

    const names = keys.map((k) => k.name);
    expect(names).toContain("id_ed25519");
    expect(names).toContain("id_rsa");
  });

  it("skips a key when private file is missing", () => {
    const sshDir = join(tmpDir, ".ssh");
    mkdirSync(sshDir, {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(join(sshDir, "id_ed25519.pub"), "ssh-ed25519 AAAA orphan\n");
    // No matching private key
    const keys = discoverLegacyKeys();
    expect(keys).toEqual([]);
  });
});

// ─── verifyKeyPair / repairPubFromPriv ──────────────────────────────────────

describe("verifyKeyPair", () => {
  it("returns 'match' when derived pub equals .pub", () => {
    const { privPath, pubPath } = createFakeKeyPair("id_ed25519", "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(smartSshKeygenMock());
    expect(verifyKeyPair(privPath, pubPath)).toBe("match");
    spawnSpy.mockRestore();
  });

  it("returns 'mismatch' when derived pub differs from .pub", () => {
    const { privPath, pubPath } = createFakeKeyPair("id_ed25519", "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(
      smartSshKeygenMock({
        mismatch: true,
      }),
    );
    expect(verifyKeyPair(privPath, pubPath)).toBe("mismatch");
    spawnSpy.mockRestore();
  });

  it("returns 'unverifiable' when ssh-keygen -y exits non-zero", () => {
    const { privPath, pubPath } = createFakeKeyPair("id_ed25519", "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(makeSyncResult("", 1));
    expect(verifyKeyPair(privPath, pubPath)).toBe("unverifiable");
    spawnSpy.mockRestore();
  });
});

describe("repairPubFromPriv", () => {
  it("rewrites .pub from derived contents and backs up the original", () => {
    const { privPath, pubPath } = createFakeKeyPair("id_ed25519", "ed25519");
    const derived = "ssh-ed25519 AAAADERIVED comment\n";
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation((args: string[]) => {
      if (args[1] === "-y") {
        return makeSyncResult(derived);
      }
      return makeSyncResult("");
    });

    const backup = repairPubFromPriv(privPath, pubPath);
    spawnSpy.mockRestore();
    expect(typeof backup).toBe("string");
    if (typeof backup !== "string") {
      throw new Error("backup is not a string");
    }
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(pubPath, "utf-8")).toBe(derived);
  });

  it("returns null when private key cannot be derived", () => {
    const { privPath, pubPath } = createFakeKeyPair("id_ed25519", "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(makeSyncResult("", 1));
    expect(repairPubFromPriv(privPath, pubPath)).toBeNull();
    spawnSpy.mockRestore();
  });
});

// ─── getSshFingerprint ──────────────────────────────────────────────────────

describe("getSshFingerprint", () => {
  it("extracts MD5 fingerprint from key output", () => {
    const { pubPath } = createFakeKeyPair("id_ed25519", "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(sshKeygenMd5Result());
    const fp = getSshFingerprint(pubPath);
    spawnSpy.mockRestore();
    expect(fp).toMatch(/^[a-f0-9:]+$/);
    expect(fp.split(":")).toHaveLength(16);
  });

  it("returns empty string for non-existent file", () => {
    const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue(makeSyncResult("", 1));
    const fp = getSshFingerprint("/tmp/nonexistent.pub");
    spawnSpy.mockRestore();
    expect(fp).toBe("");
  });
});

// ─── ensureSshKeys ──────────────────────────────────────────────────────────

describe("ensureSshKeys", () => {
  it("returns just the spawn key when no legacy keys exist", async () => {
    const sshDir = join(tmpDir, ".ssh");
    const privPath = join(sshDir, SPAWN_KEY_NAME);

    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(() => sshKeygenGenerateResult(privPath));
    const keys = await ensureSshKeys();
    spawnSpy.mockRestore();

    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe(SPAWN_KEY_NAME);
  });

  it("places spawn key first, then legacy keys", async () => {
    createFakeKeyPair(SPAWN_KEY_NAME, "ed25519");
    createFakeKeyPair("id_ed25519", "ed25519");
    createFakeKeyPair("id_rsa", "rsa");

    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(smartSshKeygenMock());
    const keys = await ensureSshKeys();
    spawnSpy.mockRestore();

    expect(keys[0].name).toBe(SPAWN_KEY_NAME);
    const legacyNames = keys.slice(1).map((k) => k.name);
    expect(legacyNames).toContain("id_ed25519");
    expect(legacyNames).toContain("id_rsa");
  });

  it("caps total keys at 3 to stay under typical sshd MaxAuthTries", async () => {
    createFakeKeyPair(SPAWN_KEY_NAME, "ed25519");
    createFakeKeyPair("id_ed25519", "ed25519");
    createFakeKeyPair("id_rsa", "rsa");
    createFakeKeyPair("id_ecdsa", "ed25519");

    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(smartSshKeygenMock());
    const keys = await ensureSshKeys();
    spawnSpy.mockRestore();

    expect(keys).toHaveLength(3);
    expect(keys[0].name).toBe(SPAWN_KEY_NAME);
  });

  it("caches results across calls", async () => {
    createFakeKeyPair(SPAWN_KEY_NAME, "ed25519");
    const spawnSpy = spyOn(Bun, "spawnSync").mockImplementation(smartSshKeygenMock());

    const keys1 = await ensureSshKeys();
    const keys2 = await ensureSshKeys();
    spawnSpy.mockRestore();
    expect(keys1).toEqual(keys2);
  });
});

// ─── getSshKeyOpts ──────────────────────────────────────────────────────────

describe("getSshKeyOpts", () => {
  it("builds -i flags for each key", () => {
    const keys = [
      {
        privPath: "/home/user/.ssh/spawn_ed25519",
        pubPath: "/home/user/.ssh/spawn_ed25519.pub",
        name: "spawn_ed25519",
        type: "ED25519",
      },
      {
        privPath: "/home/user/.ssh/id_rsa",
        pubPath: "/home/user/.ssh/id_rsa.pub",
        name: "id_rsa",
        type: "RSA",
      },
    ];
    const opts = getSshKeyOpts(keys);
    expect(opts).toEqual([
      "-i",
      "/home/user/.ssh/spawn_ed25519",
      "-i",
      "/home/user/.ssh/id_rsa",
    ]);
  });

  it("returns empty array for empty keys", () => {
    expect(getSshKeyOpts([])).toEqual([]);
  });
});

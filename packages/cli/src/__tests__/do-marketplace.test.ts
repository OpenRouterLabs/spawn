// Unit tests for DO marketplace image resolution (resolveMarketplaceImageSlug).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolveMarketplaceImageSlug } from "../digitalocean/digitalocean.js";

describe("resolveMarketplaceImageSlug", () => {
  const originalForceUbuntu = process.env.SPAWN_DO_FORCE_UBUNTU;
  const originalBeta = process.env.SPAWN_BETA;

  beforeEach(() => {
    delete process.env.SPAWN_DO_FORCE_UBUNTU;
    delete process.env.SPAWN_BETA;
  });

  afterEach(() => {
    if (originalForceUbuntu === undefined) {
      delete process.env.SPAWN_DO_FORCE_UBUNTU;
    } else {
      process.env.SPAWN_DO_FORCE_UBUNTU = originalForceUbuntu;
    }
    if (originalBeta === undefined) {
      delete process.env.SPAWN_BETA;
    } else {
      process.env.SPAWN_BETA = originalBeta;
    }
  });

  it("returns slug for mapped agents with no flags", () => {
    expect(resolveMarketplaceImageSlug("claude")).toBe("openrouter-spawnclaude");
  });

  it("returns undefined for unmapped agents", () => {
    expect(resolveMarketplaceImageSlug("cursor")).toBeUndefined();
  });

  it("returns undefined when SPAWN_DO_FORCE_UBUNTU=1", () => {
    process.env.SPAWN_DO_FORCE_UBUNTU = "1";
    expect(resolveMarketplaceImageSlug("claude")).toBeUndefined();
  });

  it("returns undefined when SPAWN_BETA includes no-images", () => {
    process.env.SPAWN_BETA = "no-images";
    expect(resolveMarketplaceImageSlug("claude")).toBeUndefined();
  });

  it("still returns slug when SPAWN_BETA includes legacy images flag", () => {
    process.env.SPAWN_BETA = "images";
    expect(resolveMarketplaceImageSlug("claude")).toBe("openrouter-spawnclaude");
  });
});

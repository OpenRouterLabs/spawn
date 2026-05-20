/**
 * model-picker.test.ts — Tests for the model picker in commands/interactive.ts
 *
 * Covers:
 * - Fetching and filtering models from OpenRouter API
 * - Provider filtering (OpenAI, Anthropic, Google, xAI only)
 * - Tool-calling support filtering
 * - Autocomplete picker with successful fetch
 * - Fallback to text input when fetch fails
 * - Cancel handling
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockClackPrompts } from "./test-helpers";

const CANCEL_SYMBOL = Symbol("cancel");
let autocompleteReturnValue: unknown = "anthropic/claude-sonnet-4";
let isCancelValues: Set<unknown> = new Set();

const clack = mockClackPrompts({
  autocomplete: mock(async () => autocompleteReturnValue),
  text: mock(async () => "unused"),
  isCancel: (value: unknown) => isCancelValues.has(value),
});

const { promptModelPicker } = await import("../commands/interactive.js");

const MOCK_MODELS = {
  data: [
    {
      id: "anthropic/claude-sonnet-4",
      name: "Claude Sonnet 4",
      supported_parameters: [
        "tools",
        "temperature",
      ],
    },
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      supported_parameters: [
        "tools",
        "temperature",
      ],
    },
    {
      id: "google/gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      supported_parameters: [
        "tools",
        "temperature",
      ],
    },
    {
      id: "x-ai/grok-4.3",
      name: "Grok 4.3",
      supported_parameters: [
        "tools",
        "temperature",
      ],
    },
    {
      id: "meta-llama/llama-3.1-405b",
      name: "Llama 3.1 405B",
      supported_parameters: [
        "tools",
        "temperature",
      ],
    },
    {
      id: "mistralai/mistral-large",
      name: "Mistral Large",
      supported_parameters: [
        "tools",
        "temperature",
      ],
    },
    {
      id: "anthropic/claude-3-haiku",
      name: "Claude 3 Haiku",
      supported_parameters: [
        "temperature",
      ],
    },
    {
      id: "openai/dall-e-3",
      name: "DALL-E 3",
      supported_parameters: [
        "size",
      ],
    },
  ],
};

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  autocompleteReturnValue = "anthropic/claude-sonnet-4";
  isCancelValues = new Set();
  clack.autocomplete.mockClear();
  clack.text.mockClear();
  clack.spinnerStart.mockClear();
  clack.spinnerStop.mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function getAutocompleteModelIds(): string[] {
  const callArgs = clack.autocomplete.mock.calls[0]?.[0];
  return (callArgs?.options ?? []).map((o: { value: string }) => o.value);
}

describe("promptModelPicker", () => {
  it("fetches models and shows autocomplete picker", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify(MOCK_MODELS)));

    const result = await promptModelPicker();

    expect(result).toBe("anthropic/claude-sonnet-4");
    expect(clack.autocomplete).toHaveBeenCalledTimes(1);
    expect(clack.text).not.toHaveBeenCalled();
  });

  it("filters to only Cursor-compatible providers", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify(MOCK_MODELS)));

    await promptModelPicker();

    const modelIds = getAutocompleteModelIds();
    expect(modelIds).toContain("anthropic/claude-sonnet-4");
    expect(modelIds).toContain("openai/gpt-4o");
    expect(modelIds).toContain("google/gemini-2.5-pro");
    expect(modelIds).toContain("x-ai/grok-4.3");
    expect(modelIds).not.toContain("meta-llama/llama-3.1-405b");
    expect(modelIds).not.toContain("mistralai/mistral-large");
  });

  it("filters out models without tool support", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify(MOCK_MODELS)));

    await promptModelPicker();

    const modelIds = getAutocompleteModelIds();
    expect(modelIds).not.toContain("anthropic/claude-3-haiku");
    expect(modelIds).not.toContain("openai/dall-e-3");
  });

  it("only includes models matching both provider and tool filters", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify(MOCK_MODELS)));

    await promptModelPicker();

    const modelIds = getAutocompleteModelIds();
    expect(modelIds).toHaveLength(4);
  });

  it("falls back to openrouter/auto when fetch fails", async () => {
    global.fetch = mock(async () => {
      throw new Error("network error");
    });

    const result = await promptModelPicker();

    expect(result).toBe("openrouter/auto");
    expect(clack.text).not.toHaveBeenCalled();
    expect(clack.autocomplete).not.toHaveBeenCalled();
  });

  it("falls back to openrouter/auto when API returns non-ok", async () => {
    global.fetch = mock(
      async () =>
        new Response("server error", {
          status: 500,
        }),
    );

    const result = await promptModelPicker();

    expect(result).toBe("openrouter/auto");
    expect(clack.text).not.toHaveBeenCalled();
    expect(clack.autocomplete).not.toHaveBeenCalled();
  });

  it("returns null when user cancels autocomplete", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify(MOCK_MODELS)));
    autocompleteReturnValue = CANCEL_SYMBOL;
    isCancelValues = new Set([
      CANCEL_SYMBOL,
    ]);

    const result = await promptModelPicker();

    expect(result).toBeNull();
  });

  it("falls back to openrouter/auto when user would have cancelled text fallback", async () => {
    global.fetch = mock(async () => {
      throw new Error("offline");
    });

    const result = await promptModelPicker();

    expect(result).toBe("openrouter/auto");
  });

  it("shows spinner while fetching", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify(MOCK_MODELS)));

    await promptModelPicker();

    expect(clack.spinnerStart).toHaveBeenCalledWith("Fetching models from OpenRouter...");
    expect(clack.spinnerStop).toHaveBeenCalledTimes(1);
  });

  it("shows model count in spinner stop message on success", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify(MOCK_MODELS)));

    await promptModelPicker();

    const stopMsg = String(clack.spinnerStop.mock.calls[0]?.[0] ?? "");
    expect(stopMsg).toContain("compatible models");
  });

  it("shows failure message in spinner stop when fetch fails", async () => {
    global.fetch = mock(async () => {
      throw new Error("offline");
    });

    await promptModelPicker();

    const stopMsg = String(clack.spinnerStop.mock.calls[0]?.[0] ?? "");
    expect(stopMsg).toBe("Could not fetch models");
  });

  it("falls back to openrouter/auto when no models match filters", async () => {
    const noMatchModels = {
      data: [
        {
          id: "meta-llama/llama-3.1-405b",
          name: "Llama 3.1",
          supported_parameters: [
            "tools",
          ],
        },
        {
          id: "openai/dall-e-3",
          name: "DALL-E 3",
          supported_parameters: [
            "size",
          ],
        },
      ],
    };
    global.fetch = mock(async () => new Response(JSON.stringify(noMatchModels)));

    const result = await promptModelPicker();

    expect(clack.text).not.toHaveBeenCalled();
    expect(clack.autocomplete).not.toHaveBeenCalled();
    expect(result).toBe("openrouter/auto");
  });
});

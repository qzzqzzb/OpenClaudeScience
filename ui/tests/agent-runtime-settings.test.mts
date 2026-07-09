import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENT_RUNTIME_SETTINGS,
  parseAgentRuntimeSettings,
  resolveEnabledRuntimeProvider,
} from "../src/lib/agent-runtime-settings.ts";

test("parseAgentRuntimeSettings defaults to langgraph", () => {
  assert.deepEqual(
    parseAgentRuntimeSettings(undefined),
    DEFAULT_AGENT_RUNTIME_SETTINGS
  );
  assert.equal(resolveEnabledRuntimeProvider(DEFAULT_AGENT_RUNTIME_SETTINGS), "langgraph");
});

test("parseAgentRuntimeSettings accepts snake_case and provider options", () => {
  const settings = parseAgentRuntimeSettings({
    default_provider: "mock",
    providers: [
      {
        provider: "langgraph",
        enabled: false,
      },
      {
        provider: "mock",
        enabled: true,
        options: {
          scenario: "success",
        },
      },
    ],
  });

  assert.equal(settings.defaultProvider, "mock");
  assert.deepEqual(settings.providers, [
    {
      provider: "langgraph",
      enabled: false,
      options: undefined,
    },
    {
      provider: "mock",
      enabled: true,
      options: {
        scenario: "success",
      },
    },
  ]);
  assert.equal(resolveEnabledRuntimeProvider(settings), "mock");
});

test("resolveEnabledRuntimeProvider falls back to enabled provider", () => {
  const settings = parseAgentRuntimeSettings({
    defaultProvider: "opencode",
    providers: [
      {
        provider: "opencode",
        enabled: false,
      },
      {
        provider: "langgraph",
        enabled: true,
      },
    ],
  });

  assert.equal(resolveEnabledRuntimeProvider(settings), "langgraph");
});

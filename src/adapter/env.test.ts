import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectEnv } from "./env.js";

const touchedKeys = ["ADAPTER_ENV_TEST_VALUE", "ADAPTER_ENV_TEST_EXISTING"];
const previousValues = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of touchedKeys) {
    const previous = previousValues.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  previousValues.clear();
});

describe("loadProjectEnv", () => {
  it("loads project .env values without overriding existing process env", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-env-"));
    previousValues.set("ADAPTER_ENV_TEST_VALUE", process.env.ADAPTER_ENV_TEST_VALUE);
    previousValues.set("ADAPTER_ENV_TEST_EXISTING", process.env.ADAPTER_ENV_TEST_EXISTING);
    delete process.env.ADAPTER_ENV_TEST_VALUE;
    process.env.ADAPTER_ENV_TEST_EXISTING = "from-process";

    fs.writeFileSync(
      path.join(directory, ".env"),
      [
        "# ignored",
        "ADAPTER_ENV_TEST_VALUE=\"from-file\"",
        "ADAPTER_ENV_TEST_EXISTING=from-file",
        "",
      ].join("\n"),
    );

    loadProjectEnv(directory);

    expect(process.env.ADAPTER_ENV_TEST_VALUE).toBe("from-file");
    expect(process.env.ADAPTER_ENV_TEST_EXISTING).toBe("from-process");
  });
});

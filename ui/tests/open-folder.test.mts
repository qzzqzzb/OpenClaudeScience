import assert from "node:assert/strict";
import test from "node:test";

import { buildWindowsOpenFolderScript } from "../src/server/domains/workspace/adapters/openFolder.adapter.ts";

test("buildWindowsOpenFolderScript encodes the folder path for PowerShell", () => {
  const folderPath = "C:\\Users\\test user\\Videos\\project";
  const script = buildWindowsOpenFolderScript(folderPath);
  const encodedPath = Buffer.from(folderPath, "utf8").toString("base64");

  assert.match(script, new RegExp(encodedPath));
  assert.doesNotMatch(script, /C:\\Users\\test user/);
});

test("buildWindowsOpenFolderScript tries to bring Explorer to the foreground", () => {
  const script = buildWindowsOpenFolderScript(
    "C:\\Users\\test user\\Videos\\project"
  );

  assert.match(script, /Shell\.Application/);
  assert.match(script, /SetWindowPos/);
  assert.match(script, /SetForegroundWindow/);
  assert.match(script, /ShowWindowAsync/);
});

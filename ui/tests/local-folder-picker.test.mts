import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWindowsFolderPickerScript,
  decodeWindowsFolderPickerOutput,
} from "../src/server/shared/adapters/localFolderPicker.adapter.ts";

test("decodeWindowsFolderPickerOutput preserves UTF-8 folder paths", () => {
  const selectedPath = "C:\\Users\\测试\\项目 中文";
  const stdout = `${Buffer.from(selectedPath, "utf8").toString("base64")}\r\n`;

  assert.equal(decodeWindowsFolderPickerOutput(stdout), selectedPath);
});

test("decodeWindowsFolderPickerOutput treats empty output as cancellation", () => {
  assert.equal(decodeWindowsFolderPickerOutput("\r\n"), "");
});

test("buildWindowsFolderPickerScript uses topmost dialog with new-folder support", () => {
  const script = buildWindowsFolderPickerScript("选择工作区");

  assert.match(script, /FolderBrowserDialog/);
  assert.match(script, /TopMost\s*=\s*\$true/);
  assert.match(script, /ShowDialog\(\$owner\)/);
  assert.match(script, /ShowNewFolderButton\s*=\s*\$true/);
  assert.doesNotMatch(script, /Shell\.Application/);
  assert.doesNotMatch(script, /ShowNewFolderButton\s*=\s*\$false/);
});

import { execFile } from "child_process";
import { promises as fs } from "fs";
import { promisify } from "util";
import { openLocalFolder as legacyOpenLocalFolder } from "@/app/api/workspace/_lib/open-folder";

const execFileAsync = promisify(execFile);
const OPEN_FILE_TIMEOUT_MS = 10_000;

export async function assertLocalFile(filePath: string): Promise<void> {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error("选中的项目路径不是文件。");
  }
}

export async function openLocalFolder(folderPath: string): Promise<void> {
  await legacyOpenLocalFolder(folderPath);
}

export async function openLocalFile(filePath: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [filePath], {
      timeout: OPEN_FILE_TIMEOUT_MS,
    });
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("cmd.exe", ["/c", "start", "", filePath], {
      timeout: OPEN_FILE_TIMEOUT_MS,
    });
    return;
  }

  if (process.platform === "linux") {
    await execFileAsync("xdg-open", [filePath], {
      timeout: OPEN_FILE_TIMEOUT_MS,
    });
    return;
  }

  throw new Error("当前系统暂不支持打开本地文件。");
}

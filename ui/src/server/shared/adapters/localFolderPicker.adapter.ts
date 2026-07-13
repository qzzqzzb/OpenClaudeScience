import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const PICKER_TIMEOUT_MS = 120_000;

export function isUserCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("user canceled") ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("用户已取消") ||
    message.includes("用户取消") ||
    message.includes("(-128)")
  );
}

async function chooseFolderOnMac(prompt: string): Promise<string> {
  const script = [
    `set selectedFolder to choose folder with prompt ${JSON.stringify(prompt)}`,
    "POSIX path of selectedFolder",
  ].join("\n");

  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: PICKER_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function chooseFolderOnLinux(title: string): Promise<string> {
  const { stdout: pickerPath } = await execFileAsync(
    "sh",
    [
      "-lc",
      "command -v zenity || command -v kdialog || command -v yad || true",
    ],
    { timeout: 5_000 }
  );
  const picker = pickerPath.trim().split(/\r?\n/)[0];
  if (!picker) {
    throw new Error(
      "当前系统没有可用的文件夹选择器，请安装 zenity、kdialog 或 yad。"
    );
  }

  const command: { file: string; args: string[] } = picker.endsWith("kdialog")
    ? {
        file: picker,
        args: ["--getexistingdirectory", process.env.HOME || "."],
      }
    : {
        file: picker,
        args: ["--file-selection", "--directory", `--title=${title}`],
      };
  const { stdout } = await execFileAsync(command.file, command.args, {
    timeout: PICKER_TIMEOUT_MS,
  });
  return stdout.trim();
}

export function decodeWindowsFolderPickerOutput(stdout: string): string {
  const encodedPath = stdout.trim();
  return encodedPath ? Buffer.from(encodedPath, "base64").toString("utf8") : "";
}

export function buildWindowsFolderPickerScript(description: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "[System.Windows.Forms.Application]::EnableVisualStyles()",
    "$owner = New-Object System.Windows.Forms.Form",
    `$owner.Text = ${JSON.stringify(description)}`,
    "$owner.StartPosition = 'CenterScreen'",
    "$owner.Size = New-Object System.Drawing.Size(1, 1)",
    "$owner.ShowInTaskbar = $true",
    "$owner.TopMost = $true",
    "$owner.Opacity = 0",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$dialog.Description = ${JSON.stringify(description)}`,
    "$dialog.ShowNewFolderButton = $true",
    "try {",
    "  $owner.Show()",
    "  $owner.Activate()",
    "  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {",
    "    $selectedPath = $dialog.SelectedPath",
    "    if ([string]::IsNullOrWhiteSpace($selectedPath)) {",
    "      throw 'Selected folder did not resolve to a filesystem path.'",
    "    }",
    "    $bytes = [System.Text.Encoding]::UTF8.GetBytes($selectedPath)",
    "    [Convert]::ToBase64String($bytes)",
    "  }",
    "} finally {",
    "  $dialog.Dispose()",
    "  $owner.Close()",
    "  $owner.Dispose()",
    "}",
  ].join("\n");
}

async function chooseFolderOnWindows(description: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-STA",
      "-Command",
      buildWindowsFolderPickerScript(description),
    ],
    { timeout: PICKER_TIMEOUT_MS }
  );
  return decodeWindowsFolderPickerOutput(stdout);
}

export async function chooseLocalFolder(prompt: string): Promise<string> {
  if (process.platform === "darwin") {
    return chooseFolderOnMac(prompt);
  }
  if (process.platform === "linux") {
    return chooseFolderOnLinux(prompt);
  }
  if (process.platform === "win32") {
    return chooseFolderOnWindows(prompt);
  }

  throw new Error("当前系统暂不支持打开本地文件夹选择器。");
}

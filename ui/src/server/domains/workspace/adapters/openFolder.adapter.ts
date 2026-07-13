import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const OPEN_FOLDER_TIMEOUT_MS = 10_000;

export function buildWindowsOpenFolderScript(folderPath: string): string {
  const encodedPath = Buffer.from(folderPath, "utf8").toString("base64");

  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class InternAgentSWindowFocus {",
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, UInt32 uFlags);',
    "}",
    "'@",
    `$target = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${JSON.stringify(
      encodedPath
    )}))`,
    "$resolvedTarget = [System.IO.Path]::GetFullPath($target).TrimEnd('\\')",
    "$shell = New-Object -ComObject Shell.Application",
    "try {",
    "  $shell.Open($target)",
    "} catch {",
    "  Start-Process -FilePath explorer.exe -ArgumentList ('\"' + $target + '\"')",
    "}",
    "$hwnd = [IntPtr]::Zero",
    "for ($i = 0; $i -lt 20 -and $hwnd -eq [IntPtr]::Zero; $i++) {",
    "  Start-Sleep -Milliseconds 150",
    "  foreach ($window in @($shell.Windows())) {",
    "    try {",
    "      $path = $window.Document.Folder.Self.Path",
    "      if ([string]::IsNullOrWhiteSpace($path)) { continue }",
    "      $candidate = [System.IO.Path]::GetFullPath($path).TrimEnd('\\')",
    "      if ([string]::Equals($candidate, $resolvedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "        $hwnd = [IntPtr]::new([int64]$window.HWND)",
    "        break",
    "      }",
    "    } catch { }",
    "  }",
    "}",
    "if ($hwnd -ne [IntPtr]::Zero) {",
    "  $swRestore = 9",
    "  $swpNoSize = 0x0001",
    "  $swpNoMove = 0x0002",
    "  $swpShowWindow = 0x0040",
    "  $flags = [uint32]($swpNoSize -bor $swpNoMove -bor $swpShowWindow)",
    "  [void][InternAgentSWindowFocus]::ShowWindowAsync($hwnd, $swRestore)",
    "  [void][InternAgentSWindowFocus]::SetWindowPos($hwnd, [IntPtr]::new(-1), 0, 0, 0, 0, $flags)",
    "  Start-Sleep -Milliseconds 80",
    "  [void][InternAgentSWindowFocus]::SetWindowPos($hwnd, [IntPtr]::new(-2), 0, 0, 0, 0, $flags)",
    "  [void][InternAgentSWindowFocus]::SetForegroundWindow($hwnd)",
    "}",
  ].join("\n");
}

export async function openLocalFolder(folderPath: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [folderPath], {
      timeout: OPEN_FOLDER_TIMEOUT_MS,
    });
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-Command",
        buildWindowsOpenFolderScript(folderPath),
      ],
      {
        timeout: OPEN_FOLDER_TIMEOUT_MS,
        windowsHide: true,
      }
    );
    return;
  }

  if (process.platform === "linux") {
    await execFileAsync("xdg-open", [folderPath], {
      timeout: OPEN_FOLDER_TIMEOUT_MS,
    });
    return;
  }

  throw new Error("当前系统暂不支持打开项目文件夹。");
}

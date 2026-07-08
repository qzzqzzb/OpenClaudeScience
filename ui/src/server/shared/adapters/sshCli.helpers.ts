import { readFile } from "fs/promises";
import os from "os";
import path from "path";
import type { ListSshHostsInput, SshHost } from "../contracts";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function remoteBashCommand(script: string): string {
  return `bash -c ${shellQuote(script)}`;
}

export function splitShellWords(value: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of value.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) {
    throw new Error("SSH 连接指令不能以转义符结尾。");
  }
  if (quote) {
    throw new Error("SSH 连接指令里的引号未闭合。");
  }
  if (current) {
    words.push(current);
  }
  return words;
}

export function assertSshConfigHost(value: unknown): string {
  const host = typeof value === "string" ? value.trim() : "";
  if (!host) {
    throw new Error("请选择 SSH config 里的 Host。");
  }
  if (/\s/.test(host)) {
    throw new Error("SSH config Host 不能包含空白字符。");
  }
  return host;
}

export function assertSshCommand(value: unknown): string {
  const command = typeof value === "string" ? value.trim() : "";
  if (!command) {
    throw new Error("请填写 SSH 连接指令。");
  }
  if (/[\r\n]/.test(command)) {
    throw new Error("SSH 连接指令只能是一行命令。");
  }

  const words = splitShellWords(command);
  if (words[0] !== "ssh") {
    throw new Error("SSH 连接指令必须以 ssh 开头。");
  }
  if (words.length < 2) {
    throw new Error(
      "SSH 连接指令需要包含目标主机，例如 ssh user@example.com。"
    );
  }

  const shellOperators = new Set(["|", ";", "&&", "||", ">", ">>", "<", "&"]);
  if (words.some((word) => shellOperators.has(word))) {
    throw new Error("SSH 连接指令不能包含管道、重定向或串联命令。");
  }

  const optionsWithValue = new Set([
    "-B",
    "-b",
    "-c",
    "-D",
    "-E",
    "-e",
    "-F",
    "-I",
    "-i",
    "-J",
    "-L",
    "-l",
    "-m",
    "-O",
    "-o",
    "-p",
    "-Q",
    "-R",
    "-S",
    "-W",
    "-w",
  ]);
  let destinationIndex = -1;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--") {
      destinationIndex = index + 1;
      break;
    }
    if (word.startsWith("-")) {
      if (optionsWithValue.has(word)) {
        index += 1;
      }
      continue;
    }
    destinationIndex = index;
    break;
  }

  if (destinationIndex < 0 || destinationIndex >= words.length) {
    throw new Error(
      "SSH 连接指令需要包含目标主机，例如 ssh user@example.com。"
    );
  }
  if (destinationIndex !== words.length - 1) {
    throw new Error("SSH 连接指令只填写连接部分，不要附加远端命令。");
  }
  return command;
}

export function sshArgsFromCommand(
  sshCommand: string,
  extraOptions: string[] = []
): string[] {
  const [binary, ...args] = splitShellWords(assertSshCommand(sshCommand));
  return [binary, ...extraOptions, ...args];
}

export function isSshConfigPattern(host: string): boolean {
  return host.includes("*") || host.includes("?") || host.includes("!");
}

export function resolveSshConfigPath(filePath: string, baseDir?: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(baseDir || process.cwd(), filePath);
}

export async function readSshConfigFile(
  filePath: string,
  options: Required<ListSshHostsInput>,
  seen = new Set<string>()
): Promise<SshHost[]> {
  const resolved = resolveSshConfigPath(filePath);
  if (seen.has(resolved)) {
    return [];
  }
  seen.add(resolved);

  let content: string;
  try {
    content = await readFile(resolved, "utf8");
  } catch {
    return [];
  }

  const entries: SshHost[] = [];
  const dir = path.dirname(resolved);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      continue;
    }

    const [keywordRaw, ...rest] = line.split(/\s+/);
    const keyword = keywordRaw.toLowerCase();
    if (keyword === "host") {
      for (const alias of rest) {
        if (alias && (options.includePatterns || !isSshConfigPattern(alias))) {
          entries.push({ alias, source: resolved });
        }
      }
      continue;
    }

    if (keyword === "include") {
      for (const includePath of rest) {
        if (!includePath || includePath.includes("*")) {
          continue;
        }
        entries.push(
          ...(await readSshConfigFile(
            resolveSshConfigPath(includePath, dir),
            options,
            seen
          ))
        );
      }
    }
  }
  return entries;
}

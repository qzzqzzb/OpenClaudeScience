import yaml from "js-yaml";

export interface Frontmatter {
  name?: unknown;
  description?: unknown;
  [key: string]: unknown;
}

interface FrontmatterBlock {
  rawYaml: string;
  body: string;
}

const FRONTMATTER_PATTERN =
  /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function extractFrontmatter(markdown: string): FrontmatterBlock | null {
  const source = markdown.replace(/^\uFEFF/, "");
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) {
    return null;
  }

  return {
    rawYaml: match[1],
    body: source.slice(match[0].length),
  };
}

function asFrontmatter(value: unknown): Frontmatter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Frontmatter;
}

function loadStrictFrontmatter(rawYaml: string): Frontmatter | null {
  try {
    return asFrontmatter(yaml.load(rawYaml));
  } catch {
    return null;
  }
}

function loadFrontmatter(rawYaml: string): Frontmatter | null {
  const parsed = loadStrictFrontmatter(rawYaml);
  if (parsed) {
    return parsed;
  }

  const repairedYaml = quoteAmbiguousTopLevelScalars(rawYaml);
  if (repairedYaml === rawYaml) {
    return null;
  }

  return loadStrictFrontmatter(repairedYaml);
}

function quoteAmbiguousTopLevelScalars(rawYaml: string): string {
  return rawYaml
    .split(/\r?\n/)
    .map((line) => {
      const match = /^([A-Za-z_][\w.-]*):[ \t]+(.+)$/.exec(line);
      if (!match) {
        return line;
      }

      const value = match[2].trim();
      const first = value[0];
      const alreadyStructured =
        first === "'" ||
        first === '"' ||
        first === "[" ||
        first === "{" ||
        first === "|" ||
        first === ">" ||
        first === "!" ||
        first === "&" ||
        first === "*";

      if (alreadyStructured || !value.includes(": ")) {
        return line;
      }

      return `${match[1]}: ${JSON.stringify(value)}`;
    })
    .join("\n");
}

function unquoteLooseScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseLooseFrontmatter(rawYaml: string): Frontmatter {
  const frontmatter: Frontmatter = {};

  for (const line of rawYaml.split(/\r?\n/)) {
    const match = /^(name|description):[ \t]*(.*)$/i.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    const value = unquoteLooseScalar(match[2]);
    if (value) {
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

export function parseSkillFrontmatter(markdown: string): Frontmatter {
  const block = extractFrontmatter(markdown);
  if (!block) {
    return {};
  }

  return loadFrontmatter(block.rawYaml) ?? parseLooseFrontmatter(block.rawYaml);
}

export function normalizeSkillMarkdown(markdown: string): string {
  const block = extractFrontmatter(markdown);
  if (!block) {
    return markdown;
  }

  if (loadStrictFrontmatter(block.rawYaml)) {
    return markdown;
  }

  const repairedYaml = quoteAmbiguousTopLevelScalars(block.rawYaml);
  if (loadStrictFrontmatter(repairedYaml)) {
    return `---\n${repairedYaml.trim()}\n---\n${block.body}`;
  }

  const fallback = parseLooseFrontmatter(block.rawYaml);
  if (Object.keys(fallback).length === 0) {
    return markdown;
  }

  const normalizedYaml = yaml
    .dump(fallback, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
    .trimEnd();

  return `---\n${normalizedYaml}\n---\n${block.body}`;
}

#!/usr/bin/env python3
"""SuperMe Stop hook.

This hook is intentionally audit-only. It prints concise warnings when the
installed SuperMe workflow artifacts look missing, stale, or modified outside
the SuperMe maintenance path. It exits 0 so it does not block Codex turns.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


BEGIN_MARKER = "<!-- BEGIN SUPERME MANAGED BLOCK -->"
END_MARKER = "<!-- END SUPERME MANAGED BLOCK -->"
CONFIG_BEGIN_MARKER = "# BEGIN SUPERME MANAGED CONFIG"
CONFIG_END_MARKER = "# END SUPERME MANAGED CONFIG"


def git_root() -> Path:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        if out:
            return Path(out)
    except Exception:
        pass
    return Path.cwd()


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def agents_block_hash(path: Path) -> str | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    begin = text.find(BEGIN_MARKER)
    end = text.find(END_MARKER)
    if begin == -1 or end == -1 or end < begin:
        return None
    end += len(END_MARKER)
    if end < len(text) and text[end:end + 1] == "\n":
        end += 1
    import hashlib

    return hashlib.sha256(text[begin:end].encode("utf-8")).hexdigest()


def marked_block_hash(path: Path, begin_marker: str, end_marker: str) -> str | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    begin = text.find(begin_marker)
    end = text.find(end_marker)
    if begin == -1 or end == -1 or end < begin:
        return None
    end += len(end_marker)
    if end < len(text) and text[end:end + 1] == "\n":
        end += 1
    import hashlib

    return hashlib.sha256(text[begin:end].encode("utf-8")).hexdigest()


def main() -> int:
    root = git_root()
    warnings: list[str] = []

    manifest_path = root / ".superme" / "manifest.json"
    if not manifest_path.exists():
        if (root / "AGENTS.md").exists() or (root / "SuperMe-policies").exists() or (root / "SuperMe-docs").exists():
            warnings.append("SuperMe artifacts exist but .superme/manifest.json is missing.")
    else:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            manifest = {}
            warnings.append(f"Cannot parse .superme/manifest.json: {exc}")

        for rel, meta in manifest.get("managed_files", {}).items():
            mode = meta.get("mode")
            expected = meta.get("template_hash")
            if mode == "block" and rel == "AGENTS.md":
                actual = agents_block_hash(root / rel)
            elif mode == "toml_block" and rel == ".codex/config.toml":
                actual = marked_block_hash(root / rel, CONFIG_BEGIN_MARKER, CONFIG_END_MARKER)
            elif mode == "file":
                actual = sha256_file(root / rel)
            else:
                continue
            if actual is None:
                warnings.append(f"Managed SuperMe artifact missing or malformed: {rel}")
            elif expected and actual != expected:
                warnings.append(f"Managed SuperMe artifact changed outside manifest hash: {rel}")

    required = [
        "SuperMe-policies/default-workflow.md",
        "SuperMe-docs/README.md",
        "SuperMe-docs/20-workflow-incidents.md",
    ]
    for rel in required:
        if not (root / rel).exists():
            warnings.append(f"Required SuperMe artifact missing: {rel}")

    docs_index = root / "SuperMe-docs" / "README.md"
    if docs_index.exists():
        text = docs_index.read_text(encoding="utf-8", errors="replace")
        if "20-workflow-incidents.md" not in text:
            warnings.append("SuperMe-docs/README.md does not index 20-workflow-incidents.md.")

    if warnings:
        print("SuperMe Stop hook warnings:")
        for item in warnings[:12]:
            print(f"- {item}")
        if len(warnings) > 12:
            print(f"- ... {len(warnings) - 12} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

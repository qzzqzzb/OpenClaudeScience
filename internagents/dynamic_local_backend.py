"""Dynamic local backend that follows the active resource workspace."""

from __future__ import annotations

import re
import shlex
import locale
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any

from deepagents.backends import LocalShellBackend
from deepagents.backends.protocol import (
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
    ReadResult,
    SandboxBackendProtocol,
    WriteResult,
)

from internagents.internagent_resources import ResourceConfig, load_resource_config

SKILL_URI_PREFIX = "skill://"
VALIDATED_SKILL_URI_PREFIX = "/skill:/"
SHELL_PATH_STOP_CHARS = set(" \t\r\n'\";|&<>()")
HOST_ROOTS = {
    "Applications",
    "Library",
    "System",
    "Users",
    "Volumes",
    "bin",
    "dev",
    "etc",
    "opt",
    "private",
    "proc",
    "sbin",
    "tmp",
    "usr",
    "var",
}
HEAVY_INTERACTIVE_PACKAGES = {
    "fenics",
    "gmsh",
    "openbabel",
    "openfoam",
    "psi4",
    "pyscf",
    "xtb-python",
}


def _canonical_skill_uri(file_path: str) -> str:
    """Recover skill URIs after DeepAgents virtual path normalization."""
    if file_path.startswith(VALIDATED_SKILL_URI_PREFIX):
        return f"{SKILL_URI_PREFIX}{file_path[len(VALIDATED_SKILL_URI_PREFIX):]}"
    return file_path


def _blocked_interactive_install(command: str) -> str | None:
    """Block known heavyweight package installs in the interactive runtime."""

    lowered = command.lower()
    install_command = re.search(
        r"\b(?:python(?:\d+(?:\.\d+)?)?(?:\.exe)?\s+-m\s+pip|"
        r"pip(?:\d+(?:\.\d+)?)?(?:\.exe)?|conda|mamba)\s+install\b",
        lowered,
    )
    if not install_command:
        return None

    requested = sorted(
        package
        for package in HEAVY_INTERACTIVE_PACKAGES
        if re.search(rf"(?<![\w.-]){re.escape(package)}(?![\w.-])", lowered)
    )
    if not requested:
        return None

    names = ", ".join(requested)
    return (
        f"Installation of heavyweight scientific package(s) is blocked in the "
        f"interactive runtime: {names}. Use already installed lightweight "
        "libraries or produce a reproducible script/report instead. If the real "
        "solver is required, explain the dependency and ask the user to approve "
        "a separate environment setup step."
    )


def _decode_process_output(data: bytes) -> str:
    if not data:
        return ""

    encodings = ["utf-8", locale.getpreferredencoding(False), "mbcs", "gbk", "cp936"]
    seen: set[str] = set()
    for encoding in encodings:
        normalized = encoding.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        try:
            return data.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    return data.decode("utf-8", errors="replace")


class DynamicLocalShellBackend(SandboxBackendProtocol):
    """Delegate local shell/filesystem operations to the latest resource workspace."""

    def __init__(
        self,
        *,
        resource_id: str,
        fallback_root: Path,
        inherit_env: bool = True,
        virtual_mode: bool = True,
        timeout: int = 120,
        max_output_bytes: int = 100_000,
        workspace_override: str | None = None,
        read_only_roots: list[Path] | None = None,
    ) -> None:
        self.resource_id = resource_id
        self.fallback_root = fallback_root
        self.inherit_env = inherit_env
        self.virtual_mode = virtual_mode
        self.timeout = timeout
        self.max_output_bytes = max_output_bytes
        self.workspace_override = workspace_override
        self.read_only_roots = list(read_only_roots or [])
        self._sandbox_id = f"dynamic-local-{resource_id}-{uuid.uuid4().hex[:8]}"

    @property
    def id(self) -> str:
        return self._sandbox_id

    def _resource(self) -> ResourceConfig | None:
        try:
            _, resources = load_resource_config()
        except Exception:
            return None
        return resources.get(self.resource_id)

    def _resolve_workspace_value(self, workspace: str) -> Path | None:
        path = Path(workspace).expanduser()
        if path == Path("."):
            return self.fallback_root
        if not path.is_absolute():
            path = self.fallback_root / path
        try:
            resolved = path.resolve()
            if resolved.is_dir():
                return resolved
        except OSError:
            return None
        return None

    def _resolve_workspace(self, resource: ResourceConfig | None) -> Path:
        if self.workspace_override:
            override = self._resolve_workspace_value(self.workspace_override)
            if override is not None:
                return override

        if resource is None:
            return self.fallback_root

        configured = self._resolve_workspace_value(resource.workspace)
        return configured or self.fallback_root

    def _backend(self) -> LocalShellBackend:
        resource = self._resource()
        return LocalShellBackend(
            root_dir=self._resolve_workspace(resource),
            inherit_env=self.inherit_env,
            virtual_mode=True,
            timeout=resource.timeout if resource is not None else self.timeout,
            max_output_bytes=(
                resource.max_output_bytes
                if resource is not None
                else self.max_output_bytes
            ),
        )

    def _external_read_backend(self) -> LocalShellBackend:
        return LocalShellBackend(
            root_dir="/",
            inherit_env=self.inherit_env,
            virtual_mode=False,
            timeout=self.timeout,
            max_output_bytes=self.max_output_bytes,
        )

    def _workspace_root(self) -> Path:
        return self._resolve_workspace(self._resource())

    def _skill_name_from_markdown(self, skill_dir: Path) -> str | None:
        skill_md = skill_dir / "SKILL.md"
        try:
            text = skill_md.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return None
        match = re.search(r"(?m)^name:\s*[\"']?([^\"'\n#]+)", text[:4096])
        if not match:
            return None
        name = match.group(1).strip()
        return name or None

    def _skill_aliases(self, skill_dir: Path) -> set[str]:
        aliases = {skill_dir.name}
        parsed_name = self._skill_name_from_markdown(skill_dir)
        if parsed_name:
            aliases.add(parsed_name)
        return aliases

    def _iter_skill_dirs(self):
        seen: set[Path] = set()
        for root in self.read_only_roots:
            candidates = [root]
            try:
                if root.is_dir():
                    candidates.extend(child for child in root.iterdir() if child.is_dir())
            except OSError:
                pass
            for candidate in candidates:
                try:
                    resolved = candidate.resolve(strict=False)
                except OSError:
                    continue
                if resolved in seen or not (resolved / "SKILL.md").is_file():
                    continue
                seen.add(resolved)
                yield resolved

    def _find_skill_dir(self, alias: str) -> Path | None:
        for skill_dir in self._iter_skill_dirs():
            if alias in self._skill_aliases(skill_dir):
                return skill_dir
        return None

    def _resolve_skill_path(self, file_path: str) -> tuple[Path | None, str | None]:
        file_path = _canonical_skill_uri(file_path)
        if not file_path.startswith(SKILL_URI_PREFIX):
            return None, None

        remainder = file_path[len(SKILL_URI_PREFIX) :]
        skill_name, separator, subpath = remainder.partition("/")
        if not skill_name:
            return None, "Skill path must include a skill name, e.g. skill://docx/SKILL.md."

        if "~" in subpath or ".." in Path(subpath).parts:
            return None, "Path traversal is not allowed in skill paths."

        skill_dir = self._find_skill_dir(skill_name)
        if skill_dir is None:
            return None, f"Skill {skill_name!r} was not found in the configured skill catalogs."

        target = skill_dir if not separator else skill_dir / subpath
        try:
            resolved = target.resolve(strict=False)
            resolved.relative_to(skill_dir)
        except (OSError, ValueError):
            return None, "Skill path is outside the resolved skill directory."
        return resolved, None

    def _read_only_path(self, file_path: str) -> str | None:
        path = Path(file_path).expanduser()
        if not path.is_absolute() or ".." in path.parts:
            return None

        try:
            resolved = path.resolve(strict=False)
        except OSError:
            return None

        for root in self.read_only_roots:
            for candidate in (path, resolved):
                try:
                    candidate.relative_to(root)
                    return str(resolved)
                except ValueError:
                    continue
        return None

    def _normalize_path(self, file_path: str) -> tuple[str | None, str | None]:
        """Normalize host absolute paths into workspace-virtual paths.

        DeepAgents file tools use absolute-looking virtual paths such as
        `/src/app.py`. If a model reuses a real host path from an old workspace,
        do not let it bypass the selected workspace.
        """

        if not file_path:
            return file_path, None

        if "~" in file_path or ".." in Path(file_path).parts:
            return None, "Path traversal is not allowed in the active workspace."

        logical_parts = Path(file_path.lstrip("/")).parts
        if file_path.startswith("/") and logical_parts and logical_parts[0] in HOST_ROOTS:
            return (
                None,
                (
                    "Path is outside the selected workspace. "
                    "For filesystem tools, use a logical workspace path such as "
                    "'/document.docx' or '/scripts/process.py', or a logical "
                    "skill path such as "
                    "'skill://docx/SKILL.md'. When running shell commands or "
                    "writing code/scripts, use workspace-relative paths such as "
                    "'document.docx' or './scripts/process.py' instead of host "
                    "paths or logical absolute paths."
                ),
            )

        root = self._workspace_root()
        path = Path(file_path).expanduser()
        if not path.is_absolute():
            return f"/{file_path.lstrip('/')}", None

        try:
            relative = path.resolve(strict=False).relative_to(root)
        except (OSError, ValueError):
            relative = None

        if relative is not None:
            if not relative.parts:
                return "/", None
            return f"/{relative.as_posix()}", None

        parts = path.parts
        if len(parts) > 1 and parts[1] in HOST_ROOTS:
            return (
                None,
                (
                    "Path is outside the selected workspace. "
                    "For filesystem tools, use a logical workspace path such as "
                    "'/document.docx' or '/scripts/process.py', or a logical "
                    "skill path such as "
                    "'skill://docx/SKILL.md'. When running shell commands or "
                    "writing code/scripts, use workspace-relative paths such as "
                    "'document.docx' or './scripts/process.py' instead of host "
                    "paths or logical absolute paths."
                ),
            )

        return file_path, None

    def ls(self, path: str):
        skill_path, skill_error = self._resolve_skill_path(path)
        if skill_error:
            from deepagents.backends.protocol import LsResult

            return LsResult(error=skill_error, entries=[])
        if skill_path is not None:
            return self._external_read_backend().ls(str(skill_path))

        read_only_path = self._read_only_path(path)
        if read_only_path:
            return self._external_read_backend().ls(read_only_path)

        normalized, error = self._normalize_path(path)
        if error:
            from deepagents.backends.protocol import LsResult

            return LsResult(error=error, entries=[])
        return self._backend().ls(normalized or path)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000):
        skill_path, skill_error = self._resolve_skill_path(file_path)
        if skill_error:
            return ReadResult(error=skill_error)
        if skill_path is not None:
            return self._external_read_backend().read(str(skill_path), offset, limit)

        read_only_path = self._read_only_path(file_path)
        if read_only_path:
            return self._external_read_backend().read(read_only_path, offset, limit)

        normalized, error = self._normalize_path(file_path)
        if error:
            return ReadResult(error=error)
        return self._backend().read(normalized or file_path, offset, limit)

    def grep(self, pattern: str, path: str | None = None, glob: str | None = None):
        if path is not None:
            skill_path, skill_error = self._resolve_skill_path(path)
            if skill_error:
                from deepagents.backends.protocol import GrepResult

                return GrepResult(error=skill_error, matches=[])
            if skill_path is not None:
                return self._external_read_backend().grep(pattern, str(skill_path), glob)

            read_only_path = self._read_only_path(path)
            if read_only_path:
                return self._external_read_backend().grep(pattern, read_only_path, glob)

            normalized, error = self._normalize_path(path)
            if error:
                from deepagents.backends.protocol import GrepResult

                return GrepResult(error=error, matches=[])
            path = normalized or path
        return self._backend().grep(pattern, path, glob)

    def glob(self, pattern: str, path: str = "/"):
        skill_path, skill_error = self._resolve_skill_path(path)
        if skill_error:
            from deepagents.backends.protocol import GlobResult

            return GlobResult(error=skill_error, matches=[])
        if skill_path is not None:
            return self._external_read_backend().glob(pattern, str(skill_path))

        read_only_path = self._read_only_path(path)
        if read_only_path:
            return self._external_read_backend().glob(pattern, read_only_path)

        normalized, error = self._normalize_path(path)
        if error:
            from deepagents.backends.protocol import GlobResult

            return GlobResult(error=error, matches=[])
        return self._backend().glob(pattern, normalized or path)

    def write(self, file_path: str, content: str):
        if _canonical_skill_uri(file_path).startswith(SKILL_URI_PREFIX):
            return WriteResult(error="Skills are read-only. Write workspace files under '/...'.")
        normalized, error = self._normalize_path(file_path)
        if error:
            return WriteResult(error=error)
        return self._backend().write(normalized or file_path, content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ):
        if _canonical_skill_uri(file_path).startswith(SKILL_URI_PREFIX):
            return EditResult(error="Skills are read-only. Edit workspace files under '/...'.")
        normalized, error = self._normalize_path(file_path)
        if error:
            return EditResult(error=error)
        return self._backend().edit(
            normalized or file_path,
            old_string,
            new_string,
            replace_all,
        )

    def upload_files(self, files: list[tuple[str, bytes]]):
        normalized_files: list[tuple[str, bytes]] = []
        responses: list[FileUploadResponse] = []
        for file_path, content in files:
            normalized, error = self._normalize_path(file_path)
            if error:
                responses.append(
                    FileUploadResponse(path=file_path, error="invalid_path")
                )
                continue
            normalized_files.append((normalized or file_path, content))
        if normalized_files:
            responses.extend(self._backend().upload_files(normalized_files))
        return responses

    def download_files(self, paths: list[str]):
        normalized_paths: list[str] = []
        responses: list[FileDownloadResponse] = []
        for file_path in paths:
            normalized, error = self._normalize_path(file_path)
            if error:
                responses.append(
                    FileDownloadResponse(
                        path=file_path,
                        content=None,
                        error="invalid_path",
                    )
                )
                continue
            normalized_paths.append(normalized or file_path)
        if normalized_paths:
            responses.extend(self._backend().download_files(normalized_paths))
        return responses

    def _workspace_shell_path(self, token: str) -> str | None:
        if not token.startswith("/") or token.startswith("//"):
            return None
        parts = Path(token).parts
        if len(parts) > 1 and parts[1] in HOST_ROOTS:
            return None
        if "~" in token or ".." in parts:
            return None
        root = self._workspace_root()
        target = (root / token.lstrip("/")).resolve(strict=False)
        try:
            target.relative_to(root)
        except ValueError:
            return None
        relative = token.lstrip("/")
        return "." if not relative else f"./{relative.rstrip('/')}"

    def _logical_shell_path(self, token: str) -> str | None:
        skill_token = _canonical_skill_uri(token)
        if skill_token.startswith(SKILL_URI_PREFIX):
            resolved, error = self._resolve_skill_path(skill_token)
            if error or resolved is None:
                return None
            return str(resolved)
        return self._workspace_shell_path(token)

    def _translate_logical_paths_in_command(self, command: str) -> str:
        translated: list[str] = []
        index = 0
        quote: str | None = None
        length = len(command)

        while index < length:
            char = command[index]
            if char in {"'", '"'}:
                quote = None if quote == char else char if quote is None else quote
                translated.append(char)
                index += 1
                continue

            starts_skill = command.startswith(SKILL_URI_PREFIX, index)
            starts_workspace = char == "/" and not (
                index > 0 and command[index - 1].isalnum()
            )
            if not starts_skill and not starts_workspace:
                translated.append(char)
                index += 1
                continue

            end = index
            while end < length and command[end] not in SHELL_PATH_STOP_CHARS:
                end += 1
            token = command[index:end]
            replacement = self._logical_shell_path(token)
            if replacement is None:
                translated.append(token)
            elif quote is None:
                translated.append(shlex.quote(replacement))
            else:
                translated.append(replacement)
            index = end

        return "".join(translated)

    def execute(self, command: str, *, timeout: int | None = None):
        blocked = _blocked_interactive_install(command)
        if blocked:
            return ExecuteResponse(output=f"Error: {blocked}", exit_code=1)
        translated = self._translate_logical_paths_in_command(command)
        return self._execute_with_tolerant_decoding(translated, timeout=timeout)

    def _execute_with_tolerant_decoding(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        if not command or not isinstance(command, str):
            return ExecuteResponse(
                output="Error: Command must be a non-empty string.",
                exit_code=1,
                truncated=False,
            )

        resource = self._resource()
        effective_timeout = (
            timeout
            if timeout is not None
            else resource.timeout
            if resource is not None
            else self.timeout
        )
        if effective_timeout <= 0:
            return ExecuteResponse(
                output=f"Error: timeout must be positive, got {effective_timeout}.",
                exit_code=1,
                truncated=False,
            )

        env = os.environ.copy() if self.inherit_env else {}
        env.setdefault("PYTHONUTF8", "1")
        env.setdefault("PYTHONIOENCODING", "utf-8")

        try:
            result = subprocess.run(  # noqa: S602
                command,
                check=False,
                shell=True,
                capture_output=True,
                stdin=subprocess.DEVNULL,
                text=False,
                timeout=effective_timeout,
                env=env,
                cwd=str(self._workspace_root()),
            )
        except subprocess.TimeoutExpired:
            if timeout is not None:
                message = (
                    f"Error: Command timed out after {effective_timeout} seconds "
                    "(custom timeout). The command may be stuck or require more time."
                )
            else:
                message = (
                    f"Error: Command timed out after {effective_timeout} seconds. "
                    "For long-running commands, re-run using the timeout parameter."
                )
            return ExecuteResponse(output=message, exit_code=124, truncated=False)
        except Exception as exc:  # noqa: BLE001
            return ExecuteResponse(
                output=f"Error executing command ({type(exc).__name__}): {exc}",
                exit_code=1,
                truncated=False,
            )

        output_parts: list[str] = []
        stdout = _decode_process_output(result.stdout)
        stderr = _decode_process_output(result.stderr)
        if stdout:
            output_parts.append(stdout)
        if stderr:
            stderr_lines = stderr.strip().split("\n")
            output_parts.extend(f"[stderr] {line}" for line in stderr_lines)

        output = "\n".join(output_parts) if output_parts else "<no output>"

        truncated = False
        if len(output) > self.max_output_bytes:
            output = output[: self.max_output_bytes]
            output += f"\n\n... Output truncated at {self.max_output_bytes} bytes."
            truncated = True

        if result.returncode != 0:
            output = f"{output.rstrip()}\n\nExit code: {result.returncode}"

        return ExecuteResponse(
            output=output,
            exit_code=result.returncode,
            truncated=truncated,
        )


def workspace_override_from_runtime(runtime: Any) -> str | None:
    """Extract the workspace path attached to this run, if present."""

    config = getattr(runtime, "config", None)
    context = getattr(runtime, "context", None)
    candidates: list[Any] = []

    if isinstance(config, dict):
        metadata = config.get("metadata")
        configurable = config.get("configurable")
        if isinstance(metadata, dict):
            candidates.append(metadata.get("internagents_workspace_path"))
        if isinstance(configurable, dict):
            candidates.append(configurable.get("internagents_workspace_path"))

    if isinstance(context, dict):
        candidates.append(context.get("internagents_workspace_path"))

    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


class DynamicLocalShellBackendFactory:
    """Create a per-run backend using workspace metadata when available."""

    def __init__(
        self,
        *,
        resource_id: str,
        fallback_root: Path,
        inherit_env: bool = True,
        virtual_mode: bool = True,
        timeout: int = 120,
        max_output_bytes: int = 100_000,
        read_only_roots: list[Path] | None = None,
    ) -> None:
        self.resource_id = resource_id
        self.fallback_root = fallback_root
        self.inherit_env = inherit_env
        self.virtual_mode = virtual_mode
        self.timeout = timeout
        self.max_output_bytes = max_output_bytes
        self.read_only_roots = read_only_roots or []

    def __call__(self, runtime: Any) -> DynamicLocalShellBackend:
        return DynamicLocalShellBackend(
            resource_id=self.resource_id,
            fallback_root=self.fallback_root,
            inherit_env=self.inherit_env,
            virtual_mode=self.virtual_mode,
            timeout=self.timeout,
            max_output_bytes=self.max_output_bytes,
            workspace_override=workspace_override_from_runtime(runtime),
            read_only_roots=self.read_only_roots,
        )

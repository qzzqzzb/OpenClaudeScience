"""Tool-call path normalization for workspace-local file tools."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from internagents.dynamic_local_backend import workspace_override_from_runtime
from internagents.internagent_resources import load_resource_config

WINDOWS_ABSOLUTE_PATH = re.compile(r"^[A-Za-z]:[\\/]")

FILE_TOOL_PATH_ARGS = {
    "edit_file": ("file_path",),
    "glob": ("path",),
    "grep": ("path",),
    "ls": ("path",),
    "read_file": ("file_path",),
    "write_file": ("file_path",),
}


def _candidate_workspace_roots(
    *,
    runtime: Any,
    resource_id: str | None,
    fallback_root: Path,
) -> list[Path]:
    roots: list[Path] = []
    runtime_workspace = workspace_override_from_runtime(runtime)
    if runtime_workspace:
        roots.append(Path(runtime_workspace))

    try:
        default_resource_id, resources = load_resource_config()
    except Exception:
        default_resource_id, resources = None, {}

    if resource_id:
        resource = resources.get(resource_id)
        if resource is not None:
            roots.append(Path(resource.workspace))
    if default_resource_id:
        default_resource = resources.get(default_resource_id)
        if default_resource is not None:
            roots.append(Path(default_resource.workspace))

    roots.append(fallback_root)

    resolved_roots: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        try:
            resolved = root.expanduser().resolve(strict=False)
        except OSError:
            continue
        key = str(resolved).casefold()
        if key in seen:
            continue
        seen.add(key)
        resolved_roots.append(resolved)
    return resolved_roots


def normalize_workspace_file_tool_path(
    value: str,
    *,
    runtime: Any,
    resource_id: str | None,
    fallback_root: Path,
) -> str:
    """Convert host Windows workspace paths to DeepAgents virtual paths."""

    if not WINDOWS_ABSOLUTE_PATH.match(value):
        return value

    candidate = Path(value)
    try:
        resolved_candidate = candidate.resolve(strict=False)
    except OSError:
        return value

    for root in _candidate_workspace_roots(
        runtime=runtime,
        resource_id=resource_id,
        fallback_root=fallback_root,
    ):
        try:
            relative = resolved_candidate.relative_to(root)
        except ValueError:
            continue
        if not relative.parts:
            return "/"
        return f"/{relative.as_posix()}"

    return value


class ToolPathNormalizationMiddleware(AgentMiddleware):
    """Normalize workspace-local Windows paths before DeepAgents file tools run."""

    def __init__(self, *, resource_id: str | None, fallback_root: Path) -> None:
        self.resource_id = resource_id
        self.fallback_root = fallback_root

    def _normalize_request(self, request: ToolCallRequest) -> ToolCallRequest:
        tool_call = request.tool_call
        tool_name = tool_call.get("name")
        path_args = FILE_TOOL_PATH_ARGS.get(tool_name)
        if not path_args:
            return request

        args = tool_call.get("args")
        if not isinstance(args, dict):
            return request

        updated_args = dict(args)
        changed = False
        for arg_name in path_args:
            value = updated_args.get(arg_name)
            if not isinstance(value, str):
                continue
            normalized = normalize_workspace_file_tool_path(
                value,
                runtime=request.runtime,
                resource_id=self.resource_id,
                fallback_root=self.fallback_root,
            )
            if normalized != value:
                updated_args[arg_name] = normalized
                changed = True

        if not changed:
            return request

        return request.override(tool_call={**tool_call, "args": updated_args})

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        return handler(self._normalize_request(request))

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        return await handler(self._normalize_request(request))

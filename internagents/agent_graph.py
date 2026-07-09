"""InternAgentS LangGraph exports for coordinator and runtime processes."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Annotated, Any, Awaitable, Callable, NotRequired, TypedDict
from urllib.parse import urlparse

from langchain.chat_models import init_chat_model
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from dotenv import load_dotenv
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    BaseMessage,
    messages_from_dict,
    messages_to_dict,
)
from langchain_core.runnables import RunnableConfig

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_FILE = ROOT_DIR / "deepagent.config.json"
DEFAULT_SKILL_CATALOG_PATHS = [
    "~/.internagents/myskills",
    "~/.internagents/imported-skills",
    "skills",
    ".internagents/imported-skills",
]
OPENAI_COMPATIBLE_PROVIDER = "openai_compatible"
OPENAI_COMPATIBLE_PROVIDER_ALIASES = {
    OPENAI_COMPATIBLE_PROVIDER,
    "openai",
    "openrouter",
    "gateway",
}
RETIRED_GATEWAY_HOST = "43.106.18.167"
MISSING_MODEL_CREDENTIALS_RESPONSE = (
    "Model service is not configured. Please configure an OpenAI-compatible API key first."
)


class ToolBindableFakeListChatModel(FakeListChatModel):
    def bind_tools(self, *args: Any, **kwargs: Any) -> "ToolBindableFakeListChatModel":
        return self


BUNDLED_DEEPAGENTS = ROOT_DIR / "deepagents" / "libs" / "deepagents"
if BUNDLED_DEEPAGENTS.exists():
    sys.path.insert(0, str(BUNDLED_DEEPAGENTS))

IMAGE_INPUT_UNSUPPORTED_USER_MESSAGE = (
    "当前模型端点不支持图片输入：模型服务拒绝了 image_url 内容块（只接受 text）。"
    "系统会移除图片内容并仅基于文本继续；如需图片理解，请切换支持视觉输入的模型。"
)
IMAGE_INPUT_OMITTED_TEXT = (
    f"[{IMAGE_INPUT_UNSUPPORTED_USER_MESSAGE} 这是一条兼容性提示，不要假装已经看到了图片。]"
)
IMAGE_INPUT_UNSUPPORTED_NOTICE_TEXT = (
    f"[{IMAGE_INPUT_UNSUPPORTED_USER_MESSAGE} 请明确告诉用户你无法读取图片内容，"
    "然后只处理请求中的文本部分。]"
)
IMAGE_INPUT_UNSUPPORTED_RETRY_NOTICE_TEXT = (
    f"[上一轮模型调用失败，原因是：{IMAGE_INPUT_UNSUPPORTED_USER_MESSAGE} "
    "请先向用户说明这个限制，再继续处理文本部分。]"
)
IMAGE_INPUT_UNSUPPORTED_ERROR_PATTERNS = (
    "no endpoints found that support image input",
    "does not support image input",
    "unsupported image input",
    "unknown variant `image_url`, expected `text`",
    "unknown variant image_url, expected text",
)
_IMAGE_INPUT_UNSUPPORTED_MODEL_KEYS: set[str] = set()

from deepagents import create_deep_agent
from deepagents.backends import LocalShellBackend
from deepagents.middleware.subagents import GENERAL_PURPOSE_SUBAGENT
from deepagents.profiles.provider import apply_provider_profile
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.pregel.remote import RemoteGraph
from langgraph.types import Command, interrupt

from internagents.dynamic_local_backend import (
    DynamicLocalShellBackend,
    DynamicLocalShellBackendFactory,
)
from internagents.date_middleware import RuntimeDateContextMiddleware
from internagents.goal_middleware import GoalContextMiddleware, goal_system_prompt
from internagents.goal_state import normalize_goal_state, update_goal_status
from internagents.goal_tools import goal_tools
from internagents.internagent_resources import ResourceConfig, load_resource_config
from internagents.kb_sync_middleware import KbSyncMiddleware
from internagents.mcp_tools import load_configured_mcp_tools
from internagents.remote_compute_tools import (
    REMOTE_COMPUTE_SUBMIT_TOOL,
    remote_compute_tools,
)
from internagents.thread_skill_middleware import ThreadSkillMiddleware
from internagents.tool_path_middleware import ToolPathNormalizationMiddleware
from internagents.ssh_backend import SshShellBackend
from internagents.web_search_tools import (
    WebSearchBudgetMiddleware,
    web_search_reference_prompt,
    web_search_tools,
)


def _load_environment() -> None:
    env_file = os.getenv("INTERNAGENT_ENV_FILE")
    if env_file:
        load_dotenv(Path(env_file).expanduser())
        return
    load_dotenv(ROOT_DIR / ".env")


_load_environment()


def _env_value(name: str) -> str | None:
    value = os.getenv(name)
    if value and value.strip():
        return value.strip()
    return None


def _env_flag(name: str, default: bool = False) -> bool:
    value = _env_value(name)
    if value is None:
        return default
    return value.lower() not in {"0", "false", "no", "off"}


def _env_positive_int(name: str, default: int) -> int:
    value = _env_value(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _agent_config_path() -> Path:
    config_file = Path(_env_value("DEEPAGENT_CONFIG") or DEFAULT_CONFIG_FILE)
    if not config_file.is_absolute():
        config_file = ROOT_DIR / config_file
    return config_file


def _read_config_for_model() -> dict[str, Any]:
    try:
        config_file = _agent_config_path()
        if not config_file.exists():
            return {}
        return json.loads(config_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _config_model_provider(config: dict[str, Any] | None = None) -> str | None:
    if config is None:
        config = _read_config_for_model()

    provider = config.get("model_provider")
    return provider.strip() if isinstance(provider, str) and provider.strip() else None


def _normalize_model_provider(provider: str | None) -> str | None:
    if provider in OPENAI_COMPATIBLE_PROVIDER_ALIASES:
        return OPENAI_COMPATIBLE_PROVIDER
    return None


def _effective_model_provider(config: dict[str, Any] | None = None) -> str | None:
    if config is None:
        config = _read_config_for_model()

    config_provider = _config_model_provider(config)
    normalized_config_provider = _normalize_model_provider(config_provider)
    if normalized_config_provider:
        return normalized_config_provider

    if config.get("openrouter_direct_enabled") is True:
        return OPENAI_COMPATIBLE_PROVIDER

    env_provider = _env_value("INTERNAGENTS_MODEL_PROVIDER")
    normalized_env_provider = _normalize_model_provider(env_provider)
    if normalized_env_provider:
        return normalized_env_provider

    return None


def _strip_model_provider_prefix(model: str) -> str:
    for prefix in ("openrouter:", "openai:"):
        if model.startswith(prefix):
            return model[len(prefix) :]
    return model


def _openrouter_model_spec(model: str) -> str:
    stripped = _strip_model_provider_prefix(model)
    return f"openrouter:{stripped}"


def _openai_compatible_model_spec(model: str) -> str:
    stripped = _strip_model_provider_prefix(model)
    return f"openai:{stripped}"


def _config_model(config: dict[str, Any] | None = None) -> str | None:
    if config is None:
        config = _read_config_for_model()
    if not config:
        return None

    provider = _effective_model_provider(config)
    if provider == OPENAI_COMPATIBLE_PROVIDER:
        model = (
            config.get("openai_compatible_model")
            or config.get("openrouter_model")
            or config.get("manual_model")
            or config.get("gateway_model")
        )
    elif config.get("model_selection_mode") == "manual":
        model = config.get("manual_model")
    else:
        model = "deepseek-v4-flash"
    return model.strip() if isinstance(model, str) and model.strip() else None


def _config_openai_compatible_base_url(
    config: dict[str, Any] | None = None,
) -> str | None:
    if config is None:
        config = _read_config_for_model()
    for key in (
        "openai_compatible_base_url",
        "openai_base_url",
        "openrouter_base_url",
        "openrouter_api_base",
    ):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _env_openai_compatible_model() -> str | None:
    for key in ("DEEPAGENT_MODEL", "OPENAI_MODEL", "DEEPSEEK_MODEL"):
        value = _env_value(key)
        if value:
            return value
    return None


def _is_retired_gateway_base_url(value: str | None) -> bool:
    if not value:
        return False
    try:
        return (
            re.match(r"^https?://", value) is not None
            and urlparse(value).hostname == RETIRED_GATEWAY_HOST
        )
    except Exception:
        return False


def _clear_retired_gateway_environment() -> None:
    retired_key = _env_value("INTERNAGENTS_GATEWAY_KEY")
    for key in ("OPENAI_API_KEY", "OPENROUTER_API_KEY"):
        value = _env_value(key)
        if value and retired_key and value == retired_key:
            os.environ.pop(key, None)

    for key in (
        "OPENAI_BASE_URL",
        "OPENAI_API_BASE",
        "OPENROUTER_API_BASE",
        "OPENROUTER_BASE_URL",
    ):
        if _is_retired_gateway_base_url(_env_value(key)):
            os.environ.pop(key, None)


def _lock_openai_compatible_environment() -> None:
    config = _read_config_for_model()
    if _effective_model_provider(config) != OPENAI_COMPATIBLE_PROVIDER:
        return

    _clear_retired_gateway_environment()

    using_deepseek_alias = any(
        _env_value(key) for key in ("DEEPSEEK_API_KEY", "DEEPSEEK_MODEL")
    )
    if using_deepseek_alias and _env_value("DEEPSEEK_BASE_URL"):
        base_url = _env_value("DEEPSEEK_BASE_URL")
    else:
        base_url = (
            _config_openai_compatible_base_url(config)
            or _env_value("OPENAI_BASE_URL")
            or _env_value("OPENAI_API_BASE")
            or _env_value("OPENROUTER_API_BASE")
            or _env_value("OPENROUTER_BASE_URL")
            or _env_value("DEEPSEEK_BASE_URL")
        )
    if base_url and not _is_retired_gateway_base_url(base_url):
        os.environ["OPENAI_BASE_URL"] = base_url
        os.environ["OPENAI_API_BASE"] = base_url

    if using_deepseek_alias and _env_value("DEEPSEEK_API_KEY"):
        api_key = _env_value("DEEPSEEK_API_KEY")
    else:
        api_key = (
            _env_value("OPENAI_API_KEY")
            or _env_value("OPENROUTER_API_KEY")
            or _env_value("DEEPSEEK_API_KEY")
        )
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key


def _resolve_model() -> str:
    config = _read_config_for_model()
    provider = _effective_model_provider(config)
    explicit_openai_model = _env_openai_compatible_model()
    config_model = _config_model(config)

    if provider == OPENAI_COMPATIBLE_PROVIDER:
        if explicit_openai_model:
            return _openai_compatible_model_spec(explicit_openai_model)
        if config_model:
            return _openai_compatible_model_spec(config_model)

    explicit_model = _env_value("DEEPAGENT_MODEL")
    if explicit_model:
        return explicit_model

    if config_model:
        return _openrouter_model_spec(config_model)

    provider = _env_value("LLM_PROVIDER")
    model = _env_value("LLM_MODEL")
    normalized_provider = _normalize_model_provider(provider)
    if normalized_provider == OPENAI_COMPATIBLE_PROVIDER and model:
        return _openai_compatible_model_spec(model)

    return "openrouter:deepseek-v4-flash"


def _model_credentials_missing(model_spec: str) -> bool:
    provider, separator, _model_name = model_spec.partition(":")
    if separator and provider == "openai":
        return not bool(_env_value("OPENAI_API_KEY"))
    if separator and provider == "openrouter":
        return not bool(_env_value("OPENROUTER_API_KEY"))
    return False


_lock_openai_compatible_environment()
MODEL = _resolve_model()
REASONING_OUTPUT_MODEL_ALIASES = {
    "deepseek-v4-flash",
    "deepseek/deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek/deepseek-v4-pro",
}
GOAL_CONTINUATION_TURNS_KEY = "goalContinuationTurns"
GOAL_MAX_AUTO_TURNS_ENV = "INTERNAGENT_GOAL_MAX_AUTO_TURNS"
REMOTE_RUNTIME_PENDING_INTERRUPT_KEY = "remoteRuntimePendingInterrupt"
REMOTE_RUNTIME_INTERNAL_STATE_KEYS = {
    GOAL_CONTINUATION_TURNS_KEY,
    REMOTE_RUNTIME_PENDING_INTERRUPT_KEY,
}
REMOTE_RUNTIME_PARENT_CONFIG_KEYS = {
    "assistant_id",
    "checkpoint_id",
    "checkpoint_map",
    "checkpoint_ns",
    "graph_id",
    "langgraph_api_url",
    "langgraph_checkpoint_ns",
    "langgraph_node",
    "langgraph_path",
    "langgraph_request_id",
    "langgraph_step",
    "langgraph_triggers",
    "run_attempt",
    "run_id",
    "thread_id",
    "user_id",
}


def _model_name_from_spec(model_spec: str) -> str:
    _, separator, model_name = model_spec.partition(":")
    return model_name if separator else model_spec


def _openrouter_model_profile_names(model_name: str) -> set[str]:
    names = {model_name.lower()}
    if "/" not in model_name and model_name.startswith("deepseek-"):
        names.add(f"deepseek/{model_name}".lower())
    return names


def _supports_reasoning_output(model_spec: str) -> bool:
    model_name = _model_name_from_spec(model_spec)
    profile_names = _openrouter_model_profile_names(model_name)
    try:
        from langchain_openrouter.data._profiles import _PROFILES  # noqa: PLC0415
    except Exception:
        return any(name in REASONING_OUTPUT_MODEL_ALIASES for name in profile_names)

    return any(
        (_PROFILES.get(name) or {}).get("reasoning_output") is True
        or name in REASONING_OUTPUT_MODEL_ALIASES
        for name in profile_names
    )


def _create_agent_model() -> str | Any:
    if _model_credentials_missing(MODEL):
        return ToolBindableFakeListChatModel(
            responses=[MISSING_MODEL_CREDENTIALS_RESPONSE]
        )
    if MODEL.startswith("openai:"):
        return init_chat_model(MODEL, use_responses_api=False)
    if MODEL.startswith("openrouter:") and _supports_reasoning_output(MODEL):
        return init_chat_model(
            MODEL,
            **apply_provider_profile(MODEL, {"reasoning": {"enabled": True}}),
        )
    return MODEL


class InternAgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    todos: NotRequired[list[Any]]
    files: NotRequired[dict[str, str]]
    goal: NotRequired[dict[str, Any]]
    goalContinuationTurns: NotRequired[int]
    remoteRuntimePendingInterrupt: NotRequired[dict[str, Any]]
    threadSkills: NotRequired[dict[str, Any]]
    email: NotRequired[dict[str, Any]]
    ui: NotRequired[Any]


def _load_agent_config() -> dict[str, Any]:
    config_file = _agent_config_path()
    if not config_file.exists():
        return {}
    with config_file.open(encoding="utf-8") as f:
        return json.load(f)


def _resolve_config_path(value: str | None, default: Path) -> Path:
    if not value:
        return default
    path = Path(value).expanduser()
    if path == Path("."):
        return ROOT_DIR
    if not path.is_absolute():
        return ROOT_DIR / path
    return path


def _resolve_workspace(value: str | None) -> Path:
    return _resolve_config_path(value, ROOT_DIR)


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def _clear_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for child in path.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()


def _normalize_skill_sources(raw_sources: Any) -> list[str]:
    if not isinstance(raw_sources, list):
        return []

    sources: list[str] = []
    for source in raw_sources:
        if isinstance(source, str) and source.strip():
            sources.append(source.strip())
        elif isinstance(source, dict):
            path = source.get("path")
            enabled = source.get("enabled", True)
            if isinstance(path, str) and path.strip() and enabled:
                sources.append(path.strip())
    return sources


def _sync_selected_skills(skills_config: dict[str, Any]) -> list[str] | None:
    if not skills_config.get("enabled", False):
        return None

    direct_sources = _normalize_skill_sources(skills_config.get("sources"))
    if direct_sources:
        return direct_sources

    selected = skills_config.get("selected")
    if not isinstance(selected, list) or not selected:
        return None

    catalog_paths = (
        skills_config.get("catalog_paths")
        or skills_config.get("catalogPaths")
        or DEFAULT_SKILL_CATALOG_PATHS
    )
    if not isinstance(catalog_paths, list):
        catalog_paths = DEFAULT_SKILL_CATALOG_PATHS

    catalog_roots = [
        _resolve_config_path(path, ROOT_DIR).resolve()
        for path in catalog_paths
        if isinstance(path, str) and path.strip()
    ]

    active_path = _resolve_config_path(
        skills_config.get("active_path")
        or skills_config.get("activePath")
        or ".internagents/active-skills",
        ROOT_DIR,
    ).resolve()
    internagents_dir = (ROOT_DIR / ".internagents").resolve()
    if not _is_relative_to(active_path, internagents_dir):
        raise ValueError("skills.active_path must stay inside .internagents/")

    _clear_directory(active_path)

    enabled_count = 0
    for selected_key in selected:
        if not isinstance(selected_key, str) or not selected_key.strip():
            continue

        skill_path = _resolve_config_path(selected_key, ROOT_DIR).resolve()
        if not skill_path.is_dir() or not (skill_path / "SKILL.md").is_file():
            continue
        if catalog_roots and not any(
            _is_relative_to(skill_path, root) for root in catalog_roots
        ):
            continue

        destination = active_path / skill_path.name
        if destination.exists() or destination.is_symlink():
            continue
        try:
            destination.symlink_to(skill_path, target_is_directory=True)
        except OSError:
            shutil.copytree(skill_path, destination)
        enabled_count += 1

    if enabled_count == 0:
        return None

    return [str(active_path)]


def _resolve_skills(config: dict[str, Any]) -> list[str] | None:
    skills_config = config.get("skills")
    if isinstance(skills_config, list):
        sources = _normalize_skill_sources(skills_config)
        return sources or None
    if isinstance(skills_config, dict):
        return _sync_selected_skills(skills_config)
    return None


def _resolve_tools(config: dict[str, Any]) -> list[Any]:
    tools = list(goal_tools())
    tools.extend(remote_compute_tools())
    tools.extend(web_search_tools(config))
    tools.extend(load_configured_mcp_tools(config, root_dir=ROOT_DIR))
    return tools


def _interrupt_on_with_remote_compute(config: dict[str, Any]) -> dict[str, Any]:
    interrupt_on = dict(config.get("interrupt_on") or {})
    interrupt_on[REMOTE_COMPUTE_SUBMIT_TOOL] = {
        "allowed_decisions": ["approve", "reject"],
        "description": (
            "Run this job on the selected SSH compute host? "
            "Review the host and command before approving."
        ),
    }
    return interrupt_on


def _skill_source_paths(skills: list[Any] | None) -> list[Path]:
    paths: list[Path] = []
    for source in skills or []:
        source_path = source[0] if isinstance(source, tuple) else source
        if isinstance(source_path, str) and source_path.strip():
            paths.append(_resolve_config_path(source_path, ROOT_DIR).resolve())
    return paths


def _skill_read_only_roots(
    config: dict[str, Any],
    skills: list[Any] | None,
) -> list[Path]:
    roots = _skill_source_paths(skills)
    skills_config = config.get("skills")

    if isinstance(skills_config, list):
        roots.extend(_skill_source_paths(_normalize_skill_sources(skills_config)))
    elif isinstance(skills_config, dict):
        roots.extend(
            _skill_source_paths(_normalize_skill_sources(skills_config.get("sources")))
        )

        selected = skills_config.get("selected")
        if isinstance(selected, list):
            roots.extend(
                _resolve_config_path(source, ROOT_DIR).resolve()
                for source in selected
                if isinstance(source, str) and source.strip()
            )

        catalog_paths = (
            skills_config.get("catalog_paths")
            or skills_config.get("catalogPaths")
            or []
        )
        if not isinstance(catalog_paths, list) or not catalog_paths:
            catalog_paths = DEFAULT_SKILL_CATALOG_PATHS
        roots.extend(
            _resolve_config_path(source, ROOT_DIR).resolve()
            for source in catalog_paths
            if isinstance(source, str) and source.strip()
        )
    else:
        roots.extend(
            _resolve_config_path(source, ROOT_DIR).resolve()
            for source in DEFAULT_SKILL_CATALOG_PATHS
        )

    deduped: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            seen.add(key)
            deduped.append(root)
    return deduped


def _thread_skill_catalog_paths(config: dict[str, Any]) -> list[str]:
    skills_config = config.get("skills")
    raw_paths: Any = None
    if isinstance(skills_config, dict):
        raw_paths = skills_config.get("catalog_paths") or skills_config.get("catalogPaths")
    if not isinstance(raw_paths, list):
        raw_paths = []

    paths = [
        path.strip()
        for path in raw_paths
        if isinstance(path, str) and path.strip()
    ]
    if not paths:
        paths = DEFAULT_SKILL_CATALOG_PATHS
    return list(dict.fromkeys(paths))


def _thread_skill_label(config: dict[str, Any]) -> str:
    skills_config = config.get("skills")
    label = skills_config.get("label") if isinstance(skills_config, dict) else None
    return label.strip() if isinstance(label, str) and label.strip() else "InternAgentS"


def _thread_skill_middleware(
    config: dict[str, Any],
    backend: Any,
) -> ThreadSkillMiddleware:
    return ThreadSkillMiddleware(
        backend=backend,
        root_dir=ROOT_DIR,
        catalog_paths=_thread_skill_catalog_paths(config),
        label=_thread_skill_label(config),
    )


def _thread_skill_subagents(config: dict[str, Any], backend: Any) -> list[dict[str, Any]]:
    raw_subagents = config.get("subagents")
    subagents = (
        [dict(spec) for spec in raw_subagents if isinstance(spec, dict)]
        if isinstance(raw_subagents, list)
        else []
    )

    has_general_purpose = any(
        spec.get("name") == GENERAL_PURPOSE_SUBAGENT["name"] for spec in subagents
    )
    if not has_general_purpose:
        subagents.insert(0, dict(GENERAL_PURPOSE_SUBAGENT))

    processed: list[dict[str, Any]] = []
    for spec in subagents:
        if "graph_id" in spec or "runnable" in spec:
            processed.append(spec)
            continue
        middleware = list(spec.get("middleware") or [])
        middleware.append(_thread_skill_middleware(config, backend))
        processed.append({**spec, "middleware": middleware})
    return processed


def _agent_tools(agent_config: dict[str, Any]) -> list[Any]:
    return [*goal_tools(), *web_search_tools(agent_config)]


def _agent_system_prompt(base_prompt: str, agent_config: dict[str, Any]) -> str:
    reference_prompt = web_search_reference_prompt(agent_config)
    if reference_prompt:
        base_prompt = f"{base_prompt}\n\n{reference_prompt}"
    base_prompt = (
        f"{base_prompt}\n\n"
        "Remote compute: when the user explicitly asks to run a lightweight, "
        "non-interactive shell job on a registered SSH compute host such as `rd`, "
        f"use the `{REMOTE_COMPUTE_SUBMIT_TOOL}` tool. Keep the command "
        "self-contained, create harvestable files under `out/` when useful, and "
        "explain that the user must approve the remote job card before it runs."
        "\n\nPackage installation policy: do not install new Python, Node, system, "
        "or solver packages during ordinary interactive analysis unless the user "
        "explicitly asks for installation. First check and use already available "
        "packages. For computational chemistry, CAD/CAE, CFD/FEM, or other heavy "
        "scientific workflows, avoid installing heavyweight solvers such as PySCF, "
        "Psi4, xTB, OpenBabel, FEniCS, OpenFOAM, or Gmsh inside the chat runtime. "
        "Use installed lightweight libraries, pure-Python approximations, or write "
        "a reproducible script/report; if a real solver is required, explain the "
        "dependency and ask the user before attempting installation."
    )
    return goal_system_prompt(base_prompt)


def _logical_path_prompt() -> str:
    return (
        "Paths shown to you are logical workspace paths. Use '/file.py' or "
        "'/src/file.py' with filesystem tools. Shell commands run with the "
        "workspace as the current directory, so prefer relative paths such as "
        "'python3 script.py', './data/input.docx', or 'data/input.docx'. When "
        "writing code or scripts, do not hard-code logical paths like '/file.py'; "
        "inside Python/Node/etc. those mean the host filesystem root. Use relative "
        "paths or build paths from the current working directory. Use "
        "'skill://<skill>/SKILL.md' or 'skill://<skill>/scripts/...' for active "
        "skill files; skills are read-only."
    )


def _office_attachment_prompt() -> str:
    return (
        "For Office attachments (.doc, .docx, .xls, .xlsx, .ppt, .pptx), "
        "do not use read_file on the original Office file as the first step; "
        "it is a binary/container file. First read the readable summary path "
        "shown in the attachment, such as readable_logical_path or "
        "extractedWorkspacePath. Also read the matching skill before editing "
        "or extracting beyond the summary: Word files use "
        "'skill://docx/SKILL.md', Excel files use 'skill://xlsx/SKILL.md', "
        "and PowerPoint files use 'skill://pptx/SKILL.md'. Use the original "
        "Office file only when layout, images, formulas, or document editing "
        "requires it, and then follow the corresponding skill workflow."
    )


def _remote_workspace_path_prompt() -> str:
    return (
        "Use workspace-virtual file paths such as '/file.py' or '/src/file.py' "
        "with filesystem tools. Do not use host absolute paths such as '/Users/...'. "
        "When using shell commands, the command already runs in the workspace; "
        "use relative paths such as 'python3 file.py' rather than virtual paths "
        "like '/file.py'."
    )


def _create_backend_for_resource(
    resource: ResourceConfig,
    read_only_roots: list[Path] | None = None,
):  # noqa: ANN201
    if resource.backend == "local_shell":
        return DynamicLocalShellBackend(
            resource_id=resource.id,
            fallback_root=ROOT_DIR,
            inherit_env=True,
            timeout=resource.timeout,
            max_output_bytes=resource.max_output_bytes,
            workspace_override=resource.workspace,
            read_only_roots=read_only_roots,
        )
    if resource.backend == "ssh_shell":
        return SshShellBackend(
            ssh_command=resource.ssh_command or "",
            workspace=resource.workspace,
            timeout=resource.timeout,
            max_output_bytes=resource.max_output_bytes,
        )
    raise ValueError(f"Unsupported backend type: {resource.backend}")


def _create_runtime_backend(  # noqa: ANN201
    config: dict[str, Any],
    resource: ResourceConfig | None = None,
    read_only_roots: list[Path] | None = None,
):
    backend_config = config.get("backend") or {}
    backend_type = backend_config.get("type", "local_shell")
    if backend_type != "local_shell":
        raise ValueError(
            f"Runtime mode only supports local_shell backend, got {backend_type!r}"
        )

    if resource is not None and resource.backend == "local_shell":
        return DynamicLocalShellBackendFactory(
            resource_id=resource.id,
            fallback_root=ROOT_DIR,
            inherit_env=backend_config.get("inherit_env", True),
            virtual_mode=True,
            timeout=resource.timeout,
            max_output_bytes=resource.max_output_bytes,
            read_only_roots=read_only_roots,
        )

    root_dir = (
        _resolve_workspace(resource.workspace)
        if resource is not None
        else _resolve_config_path(backend_config.get("root_dir"), ROOT_DIR)
    )

    return LocalShellBackend(
        root_dir=root_dir,
        inherit_env=backend_config.get("inherit_env", True),
        virtual_mode=backend_config.get("virtual_mode", False),
        timeout=resource.timeout
        if resource is not None
        else backend_config.get("timeout", 120),
        max_output_bytes=(
            resource.max_output_bytes
            if resource is not None
            else backend_config.get("max_output_bytes", 100_000)
        ),
    )


def _resource_system_prompt(base_prompt: str, resource: ResourceConfig) -> str:
    kb_line = (
        f"KB sync is enabled at {resource.kb_path}."
        if resource.kb_path
        else "KB sync is not configured for this resource."
    )
    path_prompt = (
        _logical_path_prompt()
        if resource.backend == "local_shell"
        else _remote_workspace_path_prompt()
    )
    return (
        f"{base_prompt}\n\n"
        "You are running in a resource-bound InternAgentS session.\n"
        f"Resource id: {resource.id}\n"
        f"Resource label: {resource.label}\n"
        "Workspace logical root: /\n"
        f"{kb_line}\n"
        "Do not change server network settings, firewall settings, SSH daemon settings, or cloud security-group settings. "
        "If such a change seems necessary, stop and ask the user. "
        f"{path_prompt}\n"
        f"{_office_attachment_prompt()}"
    )


def _normalize_remote_content_block(block: Any) -> Any:
    if isinstance(block, list):
        return [_normalize_remote_content_block(item) for item in block]

    if not isinstance(block, dict):
        return block

    block_type = block.get("type")
    if block_type == "image" and block.get("base64"):
        mime_type = str(block.get("mime_type") or "image/png")
        return {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{block['base64']}"},
        }

    if block_type == "file" and block.get("base64"):
        mime_type = str(block.get("mime_type") or "application/octet-stream")
        return {
            "type": "text",
            "text": (
                f"[A {mime_type} file result was omitted from the model request for "
                "provider compatibility. Use shell/file extraction tools on the "
                "workspace path to inspect its contents instead.]"
            ),
        }

    normalized = dict(block)
    for key, value in block.items():
        normalized[key] = _normalize_remote_content_block(value)
    return normalized


def _normalize_remote_message(message: Any) -> Any:
    if isinstance(message, BaseMessage):
        message_dict = messages_to_dict([message])[0]
        normalized_dict = _normalize_remote_content_block(message_dict)
        return messages_from_dict([normalized_dict])[0]

    return _normalize_remote_content_block(message)


def _content_has_image_input(content: Any) -> bool:
    if isinstance(content, list):
        return any(_content_has_image_input(item) for item in content)
    if not isinstance(content, dict):
        return False
    block_type = content.get("type")
    if block_type == "image_url" or (block_type == "image" and content.get("base64")):
        return True
    return any(_content_has_image_input(value) for value in content.values())


def _message_has_image_input(message: Any) -> bool:
    if isinstance(message, BaseMessage):
        return _content_has_image_input(message.content)
    if isinstance(message, dict):
        return _content_has_image_input(message.get("content"))
    return _content_has_image_input(message)


def _omit_image_inputs_from_content(
    content: Any,
    *,
    replacement_text: str = IMAGE_INPUT_OMITTED_TEXT,
) -> Any:
    if isinstance(content, list):
        return [
            _omit_image_inputs_from_content(item, replacement_text=replacement_text)
            for item in content
        ]

    if not isinstance(content, dict):
        return content

    block_type = content.get("type")
    if block_type == "image_url" or (block_type == "image" and content.get("base64")):
        return {"type": "text", "text": replacement_text}

    sanitized = dict(content)
    for key, value in content.items():
        sanitized[key] = _omit_image_inputs_from_content(
            value,
            replacement_text=replacement_text,
        )
    return sanitized


def _omit_image_inputs_from_message(
    message: Any,
    *,
    replacement_text: str = IMAGE_INPUT_OMITTED_TEXT,
) -> Any:
    if isinstance(message, BaseMessage):
        message_dict = messages_to_dict([message])[0]
        sanitized_dict = _omit_image_inputs_from_content(
            message_dict,
            replacement_text=replacement_text,
        )
        return messages_from_dict([sanitized_dict])[0]

    return _omit_image_inputs_from_content(
        message,
        replacement_text=replacement_text,
    )


def _append_text_to_message_content(content: Any, text: str) -> Any:
    if isinstance(content, list):
        return [*content, {"type": "text", "text": text}]
    if isinstance(content, str):
        return f"{content}\n\n{text}" if content else text
    return [content, {"type": "text", "text": text}]


def _append_text_to_message(message: Any, text: str) -> Any:
    if isinstance(message, BaseMessage):
        message_dict = messages_to_dict([message])[0]
        data = message_dict.get("data")
        if isinstance(data, dict):
            data["content"] = _append_text_to_message_content(
                data.get("content"),
                text,
            )
        return messages_from_dict([message_dict])[0]

    if isinstance(message, dict):
        next_message = dict(message)
        next_message["content"] = _append_text_to_message_content(
            next_message.get("content"),
            text,
        )
        return next_message

    return message


def _error_text_candidates(error: BaseException) -> list[str]:
    candidates: list[str] = []

    def collect(value: Any) -> None:
        if isinstance(value, str):
            candidates.append(value)
            return
        if isinstance(value, dict):
            for nested in value.values():
                collect(nested)
            return
        if isinstance(value, (list, tuple)):
            for nested in value:
                collect(nested)

    collect(getattr(error, "body", None))
    collect(getattr(error, "args", ()))
    candidates.append(str(error))
    return [candidate for candidate in candidates if candidate]


def _is_unsupported_image_input_error(error: BaseException) -> bool:
    candidates = _error_text_candidates(error)
    if any(
        pattern in candidate.lower()
        for candidate in candidates
        for pattern in IMAGE_INPUT_UNSUPPORTED_ERROR_PATTERNS
    ):
        return True

    return any(
        "response validation failed" in candidate.lower()
        and "body.error.code" in candidate.lower()
        and "invalid_request_error" in candidate.lower()
        for candidate in candidates
    )


def _specific_model_error_message(message: str) -> str | None:
    lowered = message.lower()
    if any(pattern in lowered for pattern in IMAGE_INPUT_UNSUPPORTED_ERROR_PATTERNS):
        return IMAGE_INPUT_UNSUPPORTED_USER_MESSAGE
    return None


def _normalize_state_for_remote_runtime(state: InternAgentState) -> dict[str, Any]:
    payload = {
        key: value
        for key, value in dict(state).items()
        if key not in REMOTE_RUNTIME_INTERNAL_STATE_KEYS
    }
    messages = payload.get("messages")
    if isinstance(messages, list):
        payload["messages"] = [_normalize_remote_message(message) for message in messages]
    return payload


def _sanitize_remote_runtime_config(config: RunnableConfig) -> RunnableConfig:
    sanitized: RunnableConfig = dict(config or {})

    metadata = sanitized.get("metadata")
    if isinstance(metadata, dict):
        sanitized["metadata"] = {
            key: value
            for key, value in metadata.items()
            if key not in REMOTE_RUNTIME_PARENT_CONFIG_KEYS
        }

    configurable = sanitized.get("configurable")
    if isinstance(configurable, dict):
        sanitized["configurable"] = {
            key: value
            for key, value in configurable.items()
            if key
            not in {
                "assistant_id",
                "checkpoint_id",
                "checkpoint_map",
                "checkpoint_ns",
                "graph_id",
                "run_id",
                "user_id",
            }
        }

    return sanitized


def _string_from_error_body(body: Any) -> str | None:
    if isinstance(body, dict):
        for key in ("message", "detail", "error"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return _friendly_remote_runtime_error(value.strip())
            if isinstance(value, dict):
                nested = _string_from_error_body(value)
                if nested:
                    return nested
    if isinstance(body, str) and body.strip():
        return _friendly_remote_runtime_error(body.strip())
    return None


def _friendly_remote_runtime_error(message: str) -> str:
    if specific_message := _specific_model_error_message(message):
        return specific_message
    if message == "Upstream request failed.":
        return "模型网关上游请求失败，请稍后重试或切换模型。"
    if message == "An internal error occurred":
        return (
            "远端 runtime 返回内部错误，但没有把原始异常带回主进程。"
            "请按同一 thread_id/run_id 查看 local-runtime 日志中的具体原因；"
            "如果是模型不支持 image_url/text 图片块，系统会提示并改用文本部分继续。"
        )
    return message


def _remote_runtime_exception_message(resource: ResourceConfig, error: Exception) -> str:
    body = getattr(error, "body", None)
    if isinstance(body, dict) and (body_message := _string_from_error_body(body)):
        return body_message

    for arg in getattr(error, "args", ()):
        if isinstance(arg, dict) and (arg_message := _string_from_error_body(arg)):
            return arg_message

    string_candidates = [
        body if isinstance(body, str) else "",
        *[arg for arg in getattr(error, "args", ()) if isinstance(arg, str)],
        str(error),
    ]
    message = next(
        (candidate.strip() for candidate in string_candidates if candidate.strip()),
        "",
    )
    for candidate in string_candidates:
        body_message_match = re.search(
            r"input_value=\{['\"]message['\"]:\s*['\"]([^'\"]+)['\"]",
            candidate,
        )
        if body_message_match:
            return _friendly_remote_runtime_error(body_message_match.group(1).strip())

    if any("Upstream request failed" in candidate for candidate in string_candidates):
        return _friendly_remote_runtime_error("Upstream request failed.")

    if (
        any("Response validation failed" in candidate for candidate in string_candidates)
        and any("body.error.code" in candidate for candidate in string_candidates)
    ):
        return (
            "Remote runtime returned an error response that the current LangGraph SDK "
            "could not parse. Check the remote runtime logs for the real failure."
        )

    if message:
        return _friendly_remote_runtime_error(message)

    return f"Remote runtime {resource.id!r} returned an empty error. Check runtime logs."


def _goal_blocked_after_remote_runtime_error(
    state: dict[str, Any],
    message: str,
) -> dict[str, Any] | None:
    if _goal_continuation_turns(state) <= 0:
        return None

    goal = normalize_goal_state(state.get("goal"))
    if goal is None or goal.get("status") != "active":
        return None

    blocked_goal = update_goal_status(goal, "blocked")
    notice = (
        "Remote runtime failed during automatic continuation; current goal is paused. "
        f"Reason: {message}"
    )
    return {
        "goal": blocked_goal,
        GOAL_CONTINUATION_TURNS_KEY: 0,
        "messages": [AIMessage(content=notice)],
    }


def _remote_interrupt_value(result: Any) -> Any | None:
    if not isinstance(result, dict):
        return None
    interrupts = result.get("__interrupt__")
    if not isinstance(interrupts, list) or not interrupts:
        return None
    first = interrupts[0]
    if isinstance(first, dict):
        return first.get("value")
    return getattr(first, "value", None)


async def _submit_remote_runtime(
    remote: RemoteGraph,
    resource: ResourceConfig,
    state: InternAgentState,
    config: RunnableConfig,
) -> dict[str, Any]:
    payload = _normalize_state_for_remote_runtime(state)
    remote_config = _sanitize_remote_runtime_config(config)
    try:
        result = await remote.ainvoke(payload, config=remote_config)
    except Exception as exc:
        message = _remote_runtime_exception_message(resource, exc)
        raise RuntimeError(message) from exc

    interrupt_value = _remote_interrupt_value(result)
    if interrupt_value is not None:
        return {
            REMOTE_RUNTIME_PENDING_INTERRUPT_KEY: {
                "resourceId": resource.id,
                "value": interrupt_value,
            }
        }
    if not isinstance(result, dict):
        raise RuntimeError("Remote runtime did not return a valid LangGraph state.")
    return _with_goal_continuation_accounting(dict(state), result)


async def _resume_remote_runtime(
    remote: RemoteGraph,
    resource: ResourceConfig,
    state: InternAgentState,
    config: RunnableConfig,
) -> dict[str, Any]:
    pending = state.get(REMOTE_RUNTIME_PENDING_INTERRUPT_KEY)
    if not isinstance(pending, dict) or pending.get("resourceId") != resource.id:
        return {REMOTE_RUNTIME_PENDING_INTERRUPT_KEY: None}

    decision = interrupt(pending.get("value"))
    payload: Any = Command(resume=decision)
    remote_config = _sanitize_remote_runtime_config(config)
    try:
        while True:
            result = await remote.ainvoke(payload, config=remote_config)
            interrupt_value = _remote_interrupt_value(result)
            if interrupt_value is None:
                break
            payload = Command(resume=interrupt(interrupt_value))
    except Exception as exc:
        message = _remote_runtime_exception_message(resource, exc)
        raise RuntimeError(message) from exc

    if not isinstance(result, dict):
        raise RuntimeError("Remote runtime did not return a valid LangGraph state.")

    result = dict(result)
    result[REMOTE_RUNTIME_PENDING_INTERRUPT_KEY] = None
    return _with_goal_continuation_accounting(dict(state), result)


def _goal_status(state: dict[str, Any]) -> str | None:
    goal = state.get("goal")
    status = goal.get("status") if isinstance(goal, dict) else None
    return status if isinstance(status, str) else None


def _goal_continuation_turns(state: dict[str, Any]) -> int:
    value = state.get(GOAL_CONTINUATION_TURNS_KEY)
    if isinstance(value, int):
        return max(0, value)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _with_goal_continuation_accounting(
    previous_state: dict[str, Any],
    next_state: dict[str, Any],
) -> dict[str, Any]:
    updated = dict(next_state)
    if _goal_status(updated) == "active":
        updated[GOAL_CONTINUATION_TURNS_KEY] = _goal_continuation_turns(previous_state) + 1
    else:
        updated[GOAL_CONTINUATION_TURNS_KEY] = 0
    return updated


def _should_continue_goal(state: dict[str, Any], *, max_turns: int | None = None) -> bool:
    if _goal_status(state) != "active":
        return False
    max_auto_turns = (
        _env_positive_int(GOAL_MAX_AUTO_TURNS_ENV, 50)
        if max_turns is None
        else max_turns
    )
    return _goal_continuation_turns(state) < max_auto_turns


def _route_after_remote_runtime(state: dict[str, Any]) -> str:
    if state.get(REMOTE_RUNTIME_PENDING_INTERRUPT_KEY):
        return "remote_runtime_resume"
    return "remote_runtime" if _should_continue_goal(state) else END


def _route_after_remote_runtime_resume(state: dict[str, Any]) -> str:
    if state.get(REMOTE_RUNTIME_PENDING_INTERRUPT_KEY):
        return "remote_runtime_resume"
    return "remote_runtime" if _should_continue_goal(state) else END


class ImageContentCompatibilityMiddleware(AgentMiddleware):
    """Converts DeepAgents image tool blocks to OpenRouter-compatible image_url blocks."""

    @property
    def name(self) -> str:
        return "ImageContentCompatibilityMiddleware"

    def _model_key(self, request: ModelRequest) -> str:
        if isinstance(request.model, str) and request.model.strip():
            return request.model.strip()
        return MODEL

    def _has_image_inputs(self, request: ModelRequest) -> bool:
        return any(_message_has_image_input(message) for message in request.messages) or (
            request.system_message is not None
            and _message_has_image_input(request.system_message)
        )

    def _normalize_request(self, request: ModelRequest) -> ModelRequest:
        messages = [_normalize_remote_message(message) for message in request.messages]
        system_message = (
            _normalize_remote_message(request.system_message)
            if request.system_message is not None
            else None
        )
        return request.override(messages=messages, system_message=system_message)

    def _without_image_inputs(
        self,
        request: ModelRequest,
        *,
        announce_latest: bool,
        force_latest_notice: bool = False,
    ) -> ModelRequest:
        messages = list(request.messages)
        latest_index = (
            len(messages) - 1
            if announce_latest and messages and _message_has_image_input(messages[-1])
            else None
        )
        sanitized_messages = [
            _omit_image_inputs_from_message(
                message,
                replacement_text=(
                    IMAGE_INPUT_UNSUPPORTED_NOTICE_TEXT
                    if index == latest_index
                    else IMAGE_INPUT_OMITTED_TEXT
                ),
            )
            for index, message in enumerate(messages)
        ]
        if (
            force_latest_notice
            and sanitized_messages
            and latest_index is None
        ):
            sanitized_messages[-1] = _append_text_to_message(
                sanitized_messages[-1],
                IMAGE_INPUT_UNSUPPORTED_RETRY_NOTICE_TEXT,
            )
        system_message = (
            _omit_image_inputs_from_message(request.system_message)
            if request.system_message is not None
            else None
        )
        return request.override(
            messages=sanitized_messages,
            system_message=system_message,
        )

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        normalized = self._normalize_request(request)
        model_key = self._model_key(normalized)
        if model_key in _IMAGE_INPUT_UNSUPPORTED_MODEL_KEYS and self._has_image_inputs(
            normalized
        ):
            return handler(
                self._without_image_inputs(normalized, announce_latest=True)
            )

        try:
            return handler(normalized)
        except Exception as exc:
            if not (
                self._has_image_inputs(normalized)
                and _is_unsupported_image_input_error(exc)
            ):
                raise
            _IMAGE_INPUT_UNSUPPORTED_MODEL_KEYS.add(model_key)
            return handler(
                self._without_image_inputs(
                    normalized,
                    announce_latest=True,
                    force_latest_notice=True,
                )
            )

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        normalized = self._normalize_request(request)
        model_key = self._model_key(normalized)
        if model_key in _IMAGE_INPUT_UNSUPPORTED_MODEL_KEYS and self._has_image_inputs(
            normalized
        ):
            return await handler(
                self._without_image_inputs(normalized, announce_latest=True)
            )

        try:
            return await handler(normalized)
        except Exception as exc:
            if not (
                self._has_image_inputs(normalized)
                and _is_unsupported_image_input_error(exc)
            ):
                raise
            _IMAGE_INPUT_UNSUPPORTED_MODEL_KEYS.add(model_key)
            return await handler(
                self._without_image_inputs(
                    normalized,
                    announce_latest=True,
                    force_latest_notice=True,
                )
            )


def create_agent_for_resource(resource: ResourceConfig):  # noqa: ANN201
    if resource.remote_url:
        remote = RemoteGraph(
            resource.remote_assistant_id or "agent",
            url=resource.remote_url,
            name=resource.graph_name,
        )

        async def call_remote_runtime(
            state: InternAgentState,
            config: RunnableConfig,
        ) -> dict[str, Any]:
            try:
                return await _submit_remote_runtime(remote, resource, state, config)
            except RuntimeError as exc:
                message = str(exc).strip() or "Remote runtime returned an empty error."
                goal_update = _goal_blocked_after_remote_runtime_error(
                    dict(state),
                    message,
                )
                if goal_update is not None:
                    return goal_update
                raise

        async def resume_remote_runtime(
            state: InternAgentState,
            config: RunnableConfig,
        ) -> dict[str, Any]:
            try:
                return await _resume_remote_runtime(remote, resource, state, config)
            except RuntimeError as exc:
                message = str(exc).strip() or "Remote runtime returned an empty error."
                goal_update = _goal_blocked_after_remote_runtime_error(
                    dict(state),
                    message,
                )
                if goal_update is not None:
                    return goal_update
                raise

        graph = StateGraph(InternAgentState)
        graph.add_node("remote_runtime", call_remote_runtime)
        graph.add_node("remote_runtime_resume", resume_remote_runtime)
        graph.add_edge(START, "remote_runtime")
        graph.add_conditional_edges(
            "remote_runtime",
            _route_after_remote_runtime,
            {
                "remote_runtime": "remote_runtime",
                "remote_runtime_resume": "remote_runtime_resume",
                END: END,
            },
        )
        graph.add_conditional_edges(
            "remote_runtime_resume",
            _route_after_remote_runtime_resume,
            {
                "remote_runtime": "remote_runtime",
                "remote_runtime_resume": "remote_runtime_resume",
                END: END,
            },
        )
        return graph.compile()

    if not _env_flag("INTERNAGENT_ALLOW_EMBEDDED_RESOURCE"):
        raise ValueError(
            f"Resource {resource.id!r} is missing remote_url. "
            "Coordinator mode only proxies to independent agent runtimes; "
            "start a runtime for this resource and configure its remote_url."
        )

    agent_config = _load_agent_config()
    base_prompt = agent_config.get(
        "system_prompt",
        (
            "You are a concise, reliable research assistant for paper reading, "
            "literature investigation, experiment analysis, code understanding, "
            "research planning, and local scientific project development."
        ),
    )
    resolved_skills = _resolve_skills(agent_config)
    backend = _create_backend_for_resource(
        resource,
        read_only_roots=_skill_read_only_roots(agent_config, resolved_skills),
    )
    middleware = list(agent_config.get("middleware") or [])
    middleware.append(KbSyncMiddleware(resource=resource, backend=backend))
    middleware.append(ImageContentCompatibilityMiddleware())
    middleware.append(WebSearchBudgetMiddleware())
    middleware.append(RuntimeDateContextMiddleware())
    middleware.append(GoalContextMiddleware())
    middleware.append(
        ToolPathNormalizationMiddleware(resource_id=resource.id, fallback_root=ROOT_DIR)
    )
    middleware.append(_thread_skill_middleware(agent_config, backend))
    return create_deep_agent(
        model=_create_agent_model(),
        tools=_resolve_tools(agent_config),
        backend=backend,
        skills=resolved_skills,
        subagents=_thread_skill_subagents(agent_config, backend),
        system_prompt=_agent_system_prompt(
            _resource_system_prompt(base_prompt, resource),
            agent_config,
        ),
        interrupt_on=_interrupt_on_with_remote_compute(agent_config),
        middleware=middleware,
    )


def create_runtime_agent():  # noqa: ANN201
    agent_config = _load_agent_config()
    runtime_id = _env_value("INTERNAGENT_RUNTIME_ID") or "runtime"
    runtime_resource = None
    try:
        default_resource_id, resources = load_resource_config()
        runtime_resource = resources.get(runtime_id)
        if runtime_resource is None:
            default_resource = resources.get(default_resource_id)
            if default_resource is not None and default_resource.backend == "local_shell":
                runtime_resource = default_resource
    except Exception:
        runtime_resource = None
    resolved_skills = _resolve_skills(agent_config)
    backend = _create_runtime_backend(
        agent_config,
        runtime_resource,
        read_only_roots=_skill_read_only_roots(agent_config, resolved_skills),
    )
    base_prompt = agent_config.get(
        "system_prompt",
        (
            "You are a concise, reliable research assistant for paper reading, "
            "literature investigation, experiment analysis, code understanding, "
            "research planning, and local scientific project development."
        ),
    )
    system_prompt = (
        f"{base_prompt}\n\n"
        "You are running inside an InternAgentS agent runtime process.\n"
        f"Runtime id: {runtime_id}\n"
        "The main InternAgentS server coordinates sessions and projects your state to the frontend. "
        "Do not change server network settings, firewall settings, SSH daemon settings, or cloud security-group settings. "
        "If such a change seems necessary, stop and ask the user.\n"
        f"{_office_attachment_prompt()}"
    )
    if runtime_resource is not None:
        path_prompt = (
            _logical_path_prompt()
            if runtime_resource.backend == "local_shell"
            else _remote_workspace_path_prompt()
        )
        system_prompt += (
            f"\nConfigured resource id: {runtime_resource.id}\n"
            "Configured workspace logical root: /\n"
            "For local resources, the active workspace can be hot-switched from the UI; "
            "filesystem and shell tools use the selected run workspace when provided, "
            "and fall back to the latest resource workspace. "
            f"{path_prompt}\n"
            + (
                f"KB sync is enabled at {runtime_resource.kb_path}."
                if runtime_resource.kb_path
                else "KB sync is not configured for this runtime."
            )
        )
    else:
        system_prompt += (
            "\nWorkspace logical root: /\n"
            f"{_logical_path_prompt()}\n"
            "KB sync is not configured for this runtime."
        )
    middleware = list(agent_config.get("middleware") or [])
    if runtime_resource is not None and runtime_resource.kb_path:
        middleware.append(KbSyncMiddleware(resource=runtime_resource, backend=backend))
    middleware.append(ImageContentCompatibilityMiddleware())
    middleware.append(WebSearchBudgetMiddleware())
    middleware.append(RuntimeDateContextMiddleware())
    middleware.append(GoalContextMiddleware())
    middleware.append(
        ToolPathNormalizationMiddleware(
            resource_id=runtime_resource.id if runtime_resource is not None else runtime_id,
            fallback_root=ROOT_DIR,
        )
    )
    middleware.append(_thread_skill_middleware(agent_config, backend))
    return create_deep_agent(
        model=_create_agent_model(),
        tools=_resolve_tools(agent_config),
        backend=backend,
        skills=resolved_skills,
        subagents=_thread_skill_subagents(agent_config, backend),
        system_prompt=_agent_system_prompt(system_prompt, agent_config),
        interrupt_on=_interrupt_on_with_remote_compute(agent_config),
        middleware=middleware,
    )


def create_missing_resource_agent(resource_id: str):  # noqa: ANN201
    async def resolve_or_missing_resource(
        state: InternAgentState,
        config: RunnableConfig,
    ) -> dict[str, Any]:
        try:
            _, resources = load_resource_config()
            resource = resources.get(resource_id)
        except Exception:
            resource = None
        if resource is not None:
            agent_for_resource = create_agent_for_resource(resource)
            return await agent_for_resource.ainvoke(state, config=config)
        raise ValueError(
            f"Resource {resource_id!r} is not configured. "
            "Create an untracked resource config and point "
            "INTERNAGENT_RESOURCES_FILE at it before using this assistant."
        )

    graph = StateGraph(InternAgentState)
    graph.add_node("resolve_or_missing_resource", resolve_or_missing_resource)
    graph.add_edge(START, "resolve_or_missing_resource")
    graph.add_edge("resolve_or_missing_resource", END)
    return graph.compile()


def _build_resource_agents() -> tuple[str, dict[str, Any]]:
    default_resource, resources = load_resource_config()
    return default_resource, {
        resource_id: create_agent_for_resource(resource)
        for resource_id, resource in resources.items()
    }


if (_env_value("INTERNAGENT_PROCESS_ROLE") or "").lower() == "runtime":
    agent = create_runtime_agent()
    agent_local = agent
    agent_remote1 = agent
    agent_remote2 = agent
    agent_remote3 = agent
    agent_remote4 = agent
    agent_remote5 = agent
    agent_remote6 = agent
    agent_remote7 = agent
    agent_remote8 = agent
else:
    _default_resource_id, _resource_agents = _build_resource_agents()

    # Backward-compatible default graph.
    agent = _resource_agents[_default_resource_id]

    # Static exports used by langgraph.json and the UI resource selector.
    agent_local = _resource_agents.get("local", agent)
    agent_remote1 = _resource_agents.get("remote1") or create_missing_resource_agent(
        "remote1"
    )
    agent_remote2 = _resource_agents.get("remote2") or create_missing_resource_agent(
        "remote2"
    )
    agent_remote3 = _resource_agents.get("remote3") or create_missing_resource_agent(
        "remote3"
    )
    agent_remote4 = _resource_agents.get("remote4") or create_missing_resource_agent(
        "remote4"
    )
    agent_remote5 = _resource_agents.get("remote5") or create_missing_resource_agent(
        "remote5"
    )
    agent_remote6 = _resource_agents.get("remote6") or create_missing_resource_agent(
        "remote6"
    )
    agent_remote7 = _resource_agents.get("remote7") or create_missing_resource_agent(
        "remote7"
    )
    agent_remote8 = _resource_agents.get("remote8") or create_missing_resource_agent(
        "remote8"
    )

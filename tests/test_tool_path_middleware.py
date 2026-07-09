import tempfile
import unittest
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
BUNDLED_DEEPAGENTS = ROOT_DIR / "deepagents" / "libs" / "deepagents"
if BUNDLED_DEEPAGENTS.exists():
    sys.path.insert(0, str(BUNDLED_DEEPAGENTS))

from langchain.tools import ToolRuntime
from langgraph.prebuilt.tool_node import ToolCallRequest

from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemState
from internagents.dynamic_local_backend import DynamicLocalShellBackend
from internagents.tool_path_middleware import (
    ToolPathNormalizationMiddleware,
    normalize_workspace_file_tool_path,
)


class ToolPathNormalizationMiddlewareTest(unittest.TestCase):
    def test_normalizes_windows_workspace_path_to_virtual_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            target = workspace / "cif_structures" / "PbTiO3.cif"

            normalized = normalize_workspace_file_tool_path(
                str(target),
                runtime=None,
                resource_id=None,
                fallback_root=workspace,
            )

        self.assertEqual(normalized, "/cif_structures/PbTiO3.cif")

    def test_write_file_tool_accepts_normalized_windows_workspace_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            backend = DynamicLocalShellBackend(
                resource_id="local",
                fallback_root=workspace,
                workspace_override=str(workspace),
            )
            filesystem = FilesystemMiddleware(backend=backend)
            write_tool = next(tool for tool in filesystem.tools if tool.name == "write_file")
            middleware = ToolPathNormalizationMiddleware(
                resource_id=None,
                fallback_root=workspace,
            )
            target = workspace / "cif_structures" / "PbTiO3.cif"
            runtime = ToolRuntime(
                state=FilesystemState(messages=[], files={}),
                context=None,
                tool_call_id="write-path",
                store=None,
                stream_writer=lambda _: None,
                config={},
            )
            request = ToolCallRequest(
                tool_call={
                    "name": "write_file",
                    "id": "write-path",
                    "args": {
                        "file_path": str(target),
                        "content": "data_PbTiO3",
                    },
                },
                tool=write_tool,
                state={},
                runtime=runtime,
            )

            def handler(req: ToolCallRequest):
                return req.tool.invoke({**req.tool_call["args"], "runtime": req.runtime})

            result = middleware.wrap_tool_call(request, handler)

            self.assertEqual(result.status, "success")
            self.assertEqual(target.read_text(encoding="utf-8"), "data_PbTiO3")


if __name__ == "__main__":
    unittest.main()

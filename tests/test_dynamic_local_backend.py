import tempfile
import unittest
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
BUNDLED_DEEPAGENTS = ROOT_DIR / "deepagents" / "libs" / "deepagents"
if BUNDLED_DEEPAGENTS.exists():
    sys.path.insert(0, str(BUNDLED_DEEPAGENTS))

from langchain.tools import ToolRuntime

from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemState
from internagents.dynamic_local_backend import (
    DynamicLocalShellBackend,
    _decode_process_output,
)


class DynamicLocalShellBackendTest(unittest.TestCase):
    def _backend(
        self,
        workspace: Path,
        *,
        read_only_roots: list[Path] | None = None,
    ) -> DynamicLocalShellBackend:
        return DynamicLocalShellBackend(
            resource_id="local",
            fallback_root=workspace,
            workspace_override=str(workspace),
            read_only_roots=read_only_roots,
        )

    def _write_docx_skill(self, root: Path) -> Path:
        skill_dir = root / "skills" / "docx"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("---\nname: docx\n---\n", encoding="utf-8")
        return root / "skills"

    def test_outside_read_path_guides_model_to_tool_and_script_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._backend(Path(tmp)).read("/tmp/outside.txt")

        self.assertIsNotNone(result.error)
        self.assertIn("For filesystem tools", result.error)
        self.assertIn("'/document.docx'", result.error)
        self.assertIn("'/scripts/process.py'", result.error)
        self.assertIn("'skill://docx/SKILL.md'", result.error)
        self.assertIn("writing code/scripts", result.error)
        self.assertIn("'./scripts/process.py'", result.error)

    def test_outside_write_path_uses_same_model_guidance(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._backend(Path(tmp)).write("/tmp/outside.txt", "content")

        self.assertIsNotNone(result.error)
        self.assertIn("For filesystem tools", result.error)
        self.assertIn("writing code/scripts", result.error)

    def test_validated_skill_uri_reads_from_read_only_skill_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_root = self._write_docx_skill(root)
            backend = self._backend(root, read_only_roots=[skill_root])

            result = backend.read("/skill:/docx/SKILL.md")

        self.assertIsNone(result.error)
        self.assertIsNotNone(result.file_data)
        self.assertIn("name: docx", result.file_data["content"])

    def test_validated_skill_uri_remains_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_root = self._write_docx_skill(root)
            backend = self._backend(root, read_only_roots=[skill_root])

            write_result = backend.write("/skill:/docx/SKILL.md", "changed")
            edit_result = backend.edit("/skill:/docx/SKILL.md", "docx", "pdf")

        self.assertIsNotNone(write_result.error)
        self.assertIn("Skills are read-only", write_result.error)
        self.assertIsNotNone(edit_result.error)
        self.assertIn("Skills are read-only", edit_result.error)

    def test_filesystem_middleware_skill_uri_read_reaches_dynamic_backend(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_root = self._write_docx_skill(root)
            backend = self._backend(root, read_only_roots=[skill_root])
            middleware = FilesystemMiddleware(backend=backend)
            read_tool = next(tool for tool in middleware.tools if tool.name == "read_file")
            runtime = ToolRuntime(
                state=FilesystemState(messages=[], files={}),
                context=None,
                tool_call_id="skill-read",
                store=None,
                stream_writer=lambda _: None,
                config={},
            )

            result = read_tool.invoke(
                {
                    "file_path": "skill://docx/SKILL.md",
                    "limit": 1000,
                    "runtime": runtime,
                }
            )

        self.assertEqual(result.status, "success")
        self.assertIn("name: docx", result.content)

    def test_decodes_gbk_process_output(self) -> None:
        self.assertEqual(_decode_process_output("测试".encode("gbk")), "测试")

    def test_execute_tolerates_non_utf8_process_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            backend = self._backend(Path(tmp))
            command = (
                f'"{sys.executable}" -c "import sys; '
                "sys.stdout.buffer.write('测试'.encode('gbk'))\""
            )

            result = backend.execute(command)

        self.assertEqual(result.exit_code, 0)
        self.assertIn("测试", result.output)


if __name__ == "__main__":
    unittest.main()

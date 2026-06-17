import json
import os
import tempfile
import unittest
from pathlib import Path

from market_gyan.dataset import write_jsonl
from test_dataset import ready_rows


class NotebookTest(unittest.TestCase):
    def test_training_notebooks_are_valid_and_linear(self):
        root = Path(__file__).resolve().parents[1] / "notebooks"
        expected = {
            "xlmr_baseline.ipynb": [
                "xlm-roberta-base",
                "ProsusAI/finbert",
                "confusion matrix",
                "early_stopping_patience=2",
            ],
            "qwen3_8b_qlora.ipynb": [
                "unsloth/Qwen3-8B",
                "FastLanguageModel.get_peft_model",
                "load_in_4bit=True",
                "enable_thinking=False",
                "three_shot",
            ],
        }
        for name, markers in expected.items():
            notebook = json.loads((root / name).read_text(encoding="utf-8"))
            self.assertEqual(notebook["nbformat"], 4)
            self.assertGreaterEqual(len(notebook["cells"]), 10)
            source = "\n".join(
                "".join(cell.get("source", []))
                for cell in notebook["cells"]
            )
            for marker in markers:
                self.assertIn(marker, source)

    def test_notebook_python_cells_compile(self):
        root = Path(__file__).resolve().parents[1] / "notebooks"
        for path in root.glob("*.ipynb"):
            notebook = json.loads(path.read_text(encoding="utf-8"))
            for index, cell in enumerate(notebook["cells"]):
                if cell["cell_type"] != "code":
                    continue
                source = "".join(cell.get("source", []))
                python_lines = [
                    line for line in source.splitlines()
                    if not line.lstrip().startswith(("!", "%"))
                    and not line.startswith("  '")
                ]
                try:
                    compile(
                        "\n".join(python_lines),
                        "%s:%d" % (path.name, index),
                        "exec",
                    )
                except SyntaxError:
                    if any(
                        line.lstrip().startswith("!")
                        for line in source.splitlines()
                    ):
                        continue
                    raise

    def test_notebook_data_cells_execute_with_fixture_dataset(self):
        root = Path(__file__).resolve().parents[1] / "notebooks"
        rows = ready_rows()
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            write_jsonl(
                project / "data/processed/nepse-impact-500.jsonl",
                rows,
            )
            previous = os.environ.get("MARKET_GYAN_PROJECT")
            os.environ["MARKET_GYAN_PROJECT"] = str(project)
            try:
                for name in ("xlmr_baseline.ipynb", "qwen3_8b_qlora.ipynb"):
                    notebook = json.loads((root / name).read_text(encoding="utf-8"))
                    namespace = {}
                    for cell in notebook["cells"]:
                        if cell["cell_type"] != "code":
                            continue
                        if cell.get("metadata", {}).get("tags") != ["data"]:
                            continue
                        exec("".join(cell["source"]), namespace)
            finally:
                if previous is None:
                    os.environ.pop("MARKET_GYAN_PROJECT", None)
                else:
                    os.environ["MARKET_GYAN_PROJECT"] = previous

            manifest = json.loads(
                (project / "data/processed/splits/manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(sum(manifest["counts"].values()), 500)


if __name__ == "__main__":
    unittest.main()

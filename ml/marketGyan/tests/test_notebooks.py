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
                "from market_gyan.direction_training import",
                "merge_neutral_uncertain=True",
                "neutral_or_uncertain",
                "class_weight_scheme=\"effective_number\"",
                "oversample_direction=True",
                "tune_logit_bias",
            ],
            "qwen3_8b_qlora.ipynb": [
                "Qwen/Qwen3.5-9B",
                "FastLanguageModel.get_peft_model",
                "MARKET_GYAN_LOAD_IN_4BIT",
                "load_in_4bit=LOAD_IN_4BIT",
                "enable_thinking=False",
                "three_shot",
                "compact_qwen_label",
                "compact_qwen_response_format",
                "oversample_training_rows",
                "marketgyan-qwen35-9b-l4-bf16-lora",
                "marketgyan-qwen35-9b-a100-40gb-bf16-lora",
                "marketgyan-qwen35-9b-a100-80gb-bf16-lora",
                "qwen35_9b_a100_80gb_targeted_v2.env",
                "marketgyan-qwen35-9b-a100-80gb-bf16-lora-targeted-v2",
                "MARKET_GYAN_PER_DEVICE_TRAIN_BATCH_SIZE",
                "MARKET_GYAN_GENERATION_BATCH_SIZE",
                "MARKET_GYAN_OVERSAMPLE_PROFILE",
                "MARKET_GYAN_SAVE_BEST_MODEL",
                "MARKET_GYAN_FAIL_ON_QWEN_SMOKE_GATE",
                "text_tokenizer = getattr(tokenizer, \"tokenizer\", tokenizer)",
                "previous_side = getattr(text_tokenizer, \"truncation_side\", None)",
                "tokenizer=text_tokenizer",
                "text_tokenizer.save_pretrained(output_dir)",
                "\"save_strategy\": \"steps\" if SAVE_BEST_MODEL else \"no\"",
                "\"metric_for_best_model\": \"eval_loss\"",
                "\"greater_is_better\": False",
                "training_profile.json",
                "deep_error_slices.json",
                "def generate_json_batch",
                "unit=\"batch\"",
                "qwen_base_zero_shot.jsonl",
                "qwen_vllm_constrained_zero_shot.jsonl",
                "qwen_model_gate",
                "model_gate.json",
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
            self.assertEqual(
                manifest["splitStrategy"],
                "balanced-near-duplicate-grouped-70-15-15",
            )


if __name__ == "__main__":
    unittest.main()

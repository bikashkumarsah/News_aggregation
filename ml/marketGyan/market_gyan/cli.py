import argparse
import json
from collections import Counter
from pathlib import Path

from .dataset import (
    balanced_group_split,
    chronological_group_split,
    coverage_report,
    dataset_readiness,
    read_jsonl,
    split_manifest,
    validate_dataset,
    write_jsonl,
)
from .metrics import (
    agreement_metrics,
    benchmark_predictions,
    benchmark_predictions_with_repair,
    bootstrap_difference,
    candidate_review_metrics,
    reaction_analysis,
)
from .system_evaluation import (
    deployment_gate,
    retrieval_metrics,
    scenario_metrics,
)


def command_validate(args):
    rows = read_jsonl(args.input)
    issues = validate_dataset(rows)
    result = {
        "valid": not issues,
        "issues": issues,
        "coverage": coverage_report(rows),
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if issues:
        raise SystemExit(1)


def command_split(args):
    rows = read_jsonl(args.input)
    issues = validate_dataset(rows)
    if issues:
        raise ValueError("Dataset is invalid; run the validate command for details")
    if args.strategy == "chronological":
        splits = chronological_group_split(rows)
    else:
        splits = balanced_group_split(rows)
    output = Path(args.output)
    for name, split_rows in splits.items():
        write_jsonl(output / ("%s.jsonl" % name), split_rows)
    (output / "manifest.json").write_text(
        json.dumps(
            split_manifest(splits, strategy=args.strategy),
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(json.dumps({
        name: coverage_report(split_rows)
        for name, split_rows in splits.items()
    }, indent=2, ensure_ascii=False))


def command_gate(args):
    rows = read_jsonl(args.input)
    issues = validate_dataset(rows)
    result = dataset_readiness(
        rows,
        min_records=args.min_records,
    )
    result["valid"] = not issues
    result["issues"] = issues
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if issues or not result["ready"]:
        raise SystemExit(1)


def command_evaluate(args):
    rows = read_jsonl(args.input)
    report = {
        "dataset": coverage_report(rows),
        "gemmaReview": candidate_review_metrics(rows),
        "runtimeInferenceEnabled": False,
        "notes": [
            "Relevance, event, and impact-direction metrics are added by the training notebooks.",
            "Runtime remains disabled until the deployment-gate command passes.",
        ],
    }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(target))


def command_benchmark(args):
    truth = read_jsonl(args.truth)
    predictions = read_jsonl(args.predictions)
    if args.repair_diagnostic:
        report = benchmark_predictions_with_repair(truth, predictions)
    else:
        report = benchmark_predictions(truth, predictions)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(target))


def _read_prediction_rows(path):
    value = Path(path).read_text(encoding="utf-8").strip()
    if value.startswith("["):
        return json.loads(value)
    return read_jsonl(path)


def command_audit_predictions(args):
    truth = read_jsonl(args.truth)
    truth_by_id = {row["id"]: row for row in truth}
    predictions = _read_prediction_rows(args.predictions)
    field = "relevance" if args.task == "relevance" else "impactDirection"
    confusion = Counter()
    errors = []
    missing = []
    for row in predictions:
        row_id = row.get("id")
        truth_row = truth_by_id.get(row_id)
        if not truth_row:
            missing.append(row_id)
            continue
        expected = row.get("expected", truth_row["gold"].get(field))
        predicted = row.get("predicted")
        if predicted is None and isinstance(row.get("prediction"), dict):
            predicted = row["prediction"].get(field)
        confusion["%s -> %s" % (expected, predicted)] += 1
        if expected != predicted:
            gold = truth_row["gold"]
            errors.append({
                "id": row_id,
                "expected": expected,
                "predicted": predicted,
                "title": truth_row.get("title"),
                "source": truth_row.get("source", {}).get("name"),
                "publishedAt": truth_row.get("publishedAt"),
                "language": gold.get("language"),
                "relevance": gold.get("relevance"),
                "eventType": gold.get("eventType"),
                "impactDirection": gold.get("impactDirection"),
                "summary": gold.get("summary"),
                "rationale": gold.get("rationale"),
                "evidenceSentenceIds": gold.get("evidenceSentenceIds", []),
            })
    report = {
        "task": args.task,
        "truthRows": len(truth),
        "predictionRows": len(predictions),
        "matchedRows": len(predictions) - len(missing),
        "errorRows": len(errors),
        "confusion": dict(confusion),
        "missingPredictionIds": missing,
        "truthCoverage": coverage_report(truth),
        "errors": errors,
    }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(str(target))


def command_agreement(args):
    rows = read_jsonl(args.input)
    report = agreement_metrics(rows)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(str(target))
    if (
        report["doubleAnnotated"] < args.minimum
        or report["relevanceKappa"] < 0.70
        or report["directionKappa"] < 0.70
    ):
        raise SystemExit(1)


def command_reaction(args):
    rows = read_jsonl(args.input)
    report = reaction_analysis(
        rows,
        material_threshold=args.material_threshold,
        samples=args.bootstrap_samples,
    )
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(str(target))


def command_compare_models(args):
    base = json.loads(Path(args.base).read_text(encoding="utf-8"))
    tuned = json.loads(Path(args.tuned).read_text(encoding="utf-8"))
    report = bootstrap_difference(
        base["pairedScores"],
        tuned["pairedScores"],
        samples=args.bootstrap_samples,
    )
    report["adaptationSuccessful"] = (
        report["difference"] >= 0.05 or report["ci95"][0] > 0
    )
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(str(target))


def command_system_evaluate(args):
    retrieval_rows = json.loads(Path(args.retrieval).read_text(encoding="utf-8"))
    scenario_rows = json.loads(Path(args.scenarios).read_text(encoding="utf-8"))
    report = {
        "retrieval": retrieval_metrics(retrieval_rows),
        "system": scenario_metrics(scenario_rows),
    }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(str(target))


def command_deployment_gate(args):
    xlmr = json.loads(Path(args.xlmr).read_text(encoding="utf-8"))
    qwen = json.loads(Path(args.qwen).read_text(encoding="utf-8"))
    xlmr_macro = (
        xlmr.get("macro avg", {}).get("f1-score")
        or xlmr.get("macroF1")
        or xlmr.get("eval_macro_f1")
        or 0.0
    )
    direction = qwen.get("direction", {})
    per_class = {
        label: direction.get("perClass", {}).get(label, {}).get("f1", 0.0)
        for label in ("bullish", "bearish", "neutral", "uncertain")
    }
    report = deployment_gate(
        xlmr_macro_f1=xlmr_macro,
        qwen_macro_f1=direction.get("macroF1", 0.0),
        qwen_per_class_f1=per_class,
        structured_validity=qwen.get("structuredOutputValidity", 0.0),
        evidence_grounding=qwen.get(
            "evidenceGrounding",
            qwen.get("rationaleGrounding", 0.0),
        ),
        min_per_class_f1=args.min_per_class_f1,
    )
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(str(target))
    if not report["eligible"]:
        raise SystemExit(1)


def build_parser():
    parser = argparse.ArgumentParser(description="Market Gyan modeling utilities")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("input")
    validate.set_defaults(func=command_validate)

    split = subparsers.add_parser("split")
    split.add_argument("input")
    split.add_argument("output")
    split.add_argument(
        "--strategy",
        choices=("balanced", "chronological"),
        default="balanced",
    )
    split.set_defaults(func=command_split)

    gate = subparsers.add_parser("gate")
    gate.add_argument("input")
    gate.add_argument("--min-records", type=int, default=500)
    gate.set_defaults(func=command_gate)

    evaluate = subparsers.add_parser("evaluate")
    evaluate.add_argument("input")
    evaluate.add_argument("output")
    evaluate.set_defaults(func=command_evaluate)

    benchmark = subparsers.add_parser("benchmark")
    benchmark.add_argument("truth")
    benchmark.add_argument("predictions")
    benchmark.add_argument("output")
    benchmark.add_argument(
        "--repair-diagnostic",
        action="store_true",
        help="Report tolerant repaired-output metrics for Qwen failure analysis only.",
    )
    benchmark.set_defaults(func=command_benchmark)

    audit = subparsers.add_parser("audit-predictions")
    audit.add_argument("truth")
    audit.add_argument("predictions")
    audit.add_argument("output")
    audit.add_argument("--task", choices=("relevance", "direction"), required=True)
    audit.set_defaults(func=command_audit_predictions)

    agreement = subparsers.add_parser("agreement")
    agreement.add_argument("input")
    agreement.add_argument("output")
    agreement.add_argument("--minimum", type=int, default=110)
    agreement.set_defaults(func=command_agreement)

    reaction = subparsers.add_parser("reaction-analysis")
    reaction.add_argument("input")
    reaction.add_argument("output")
    reaction.add_argument("--material-threshold", type=float, default=0.5)
    reaction.add_argument("--bootstrap-samples", type=int, default=2000)
    reaction.set_defaults(func=command_reaction)

    compare = subparsers.add_parser("compare-models")
    compare.add_argument("base")
    compare.add_argument("tuned")
    compare.add_argument("output")
    compare.add_argument("--bootstrap-samples", type=int, default=2000)
    compare.set_defaults(func=command_compare_models)

    system_evaluate = subparsers.add_parser("system-evaluate")
    system_evaluate.add_argument("retrieval")
    system_evaluate.add_argument("scenarios")
    system_evaluate.add_argument("output")
    system_evaluate.set_defaults(func=command_system_evaluate)

    gate = subparsers.add_parser("deployment-gate")
    gate.add_argument("xlmr")
    gate.add_argument("qwen")
    gate.add_argument("output")
    gate.add_argument("--min-per-class-f1", type=float, default=0.40)
    gate.set_defaults(func=command_deployment_gate)
    return parser


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

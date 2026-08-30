# MarketGyan Technical Progress Report

This directory contains a compact, job-application-ready sample weekly report.
It emphasizes checked-in code, reproducible experiments, measured results,
execution logs, limitations, and next actions.

## Files

- `main.tex`: report layout and narrative.
- `status_snapshot.tex`: verified metrics and report metadata.
- `assets/`: experiment plots embedded in the PDF.
- `marketgyan-technical-progress-report.pdf`: compiled showcase document.
- `references.bib`: retained archival references from the long-form report;
  the compact report does not require a bibliography.

## Build

From this directory:

```bash
python3 /Users/bikashkumarsah/.codex/plugins/cache/openai-bundled/latex/0.2.6/scripts/compile_latex.py \
  main.tex --output-directory build
cp build/main.pdf marketgyan-technical-progress-report.pdf
```

## Evidence policy

- GPU training and live provider metrics come only from retained local JSON
  metrics and report plots;
  the report does not imply they were rerun locally.
- The included validation logs cover dataset validation, dataset gating,
  Python unit tests, backend tests, and the focused frontend suite.
- Update `status_snapshot.tex` only when a corresponding artifact or fresh log
  exists.

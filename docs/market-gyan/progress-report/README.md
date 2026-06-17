# MarketGyan Progress Report

This directory contains the living engineering report for MarketGyan:

- `main.tex`: stable data-pipeline and model-development chapters.
- `status_snapshot.tex`: current metrics, milestone state, and dated history.
- `references.bib`: primary technical and source references.

The generated PDF is a verification artifact and is not committed.

## Build

From this directory:

```bash
tectonic --reruns 2 main.tex
```

To keep generated files outside the repository:

```bash
mkdir -p /tmp/market-gyan-report
tectonic --reruns 2 --outdir /tmp/market-gyan-report main.tex
```

## Milestone Update

When a new milestone is achieved:

1. Re-query MongoDB and update the macros in `status_snapshot.tex`.
2. Append one dated item to `\MarketGyanMilestoneHistory`.
3. Add measured experiment results to `main.tex` only after artifacts exist.
4. Compile with Tectonic and inspect warnings before committing the sources.

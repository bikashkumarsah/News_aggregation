## Khabar AI — LaTeX Project Report

This folder contains the full project report in LaTeX:
- `main.tex` — the report
- `references.bib` — BibTeX references used in the report (incl. experimentation citations)

### Build (recommended: latexmk)

```bash
cd docs/report
latexmk -pdf -interaction=nonstopmode -file-line-error main.tex
```

### Build (manual: pdflatex + bibtex)

```bash
cd docs/report
pdflatex -interaction=nonstopmode -file-line-error main.tex
bibtex main
pdflatex -interaction=nonstopmode -file-line-error main.tex
pdflatex -interaction=nonstopmode -file-line-error main.tex
```


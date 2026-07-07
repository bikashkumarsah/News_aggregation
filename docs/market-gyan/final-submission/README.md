# MarketGyan Final Submission

This folder contains the final KU-style project submission deliverables derived from:

- `docs/market-gyan/proposal_marketgyan.tex`
- `docs/market-gyan/progress-report/main.tex`

## Deliverables

- `report/marketgyan-final-ku-report.tex` - final KU-style report source.
- `report/marketgyan-final-ku-report.pdf` - compiled final report.
- `presentation/build_final_presentation.mjs` - reproducible deck build script.
- `presentation/marketgyan-final-presentation.pptx` - final presentation deck.
- `presentation/rendered/` - slide previews, layout JSON, and montage used for visual QA.
- `presentation-latex/marketgyan-final-presentation.tex` - Beamer/LaTeX presentation source.
- `presentation-latex/marketgyan-final-presentation.pdf` - compiled Beamer/LaTeX presentation.
- `presentation-latex/assets/loss.png` and `test_results.png` - targeted-v2 training/evaluation plots extracted from the latest model zip.
- `presentation-latex/assets/demo-frames/` and `report/images/` - screenshots extracted from `/tmp/marketgyan-demo-recording/marketgyan-qwen-demo.mp4`.
- `demo-recording/marketgyan-qwen-demo.mp4` - copied demo recording used as screenshot provenance.

## Final Decision

The final project status is demo-only / research prototype. The Qwen3.5-9B targeted-v2 adapter passes strict JSON validity and grounding gates, and the local single-pass RAG demo passes citation checks. Deployment remains blocked by retrieval Precision@5 and content-metric gaps for neutral direction, sectors, symbols, and evidence recall.

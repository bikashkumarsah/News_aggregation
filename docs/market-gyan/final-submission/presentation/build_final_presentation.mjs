import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const outDir = path.resolve("rendered");
const pptxPath = path.resolve("marketgyan-final-presentation.pptx");

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

function addText(slide, text, position, style = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontSize: style.fontSize ?? 20,
    bold: style.bold ?? false,
    color: style.color ?? "#172554",
    alignment: style.alignment ?? "left",
    ...style,
  };
  return shape;
}

function addBox(slide, position, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry ?? "roundRect",
    position,
    fill: options.fill ?? "#ffffff",
    line: { style: "solid", fill: options.lineFill ?? "#cbd5e1", width: options.lineWidth ?? 1 },
    borderRadius: options.borderRadius ?? "rounded-md",
    shadow: options.shadow ?? "none",
  });
}

function addHeader(slide, section, number) {
  addText(slide, section.toUpperCase(), { left: 72, top: 36, width: 600, height: 24 }, {
    fontSize: 12,
    bold: true,
    color: "#64748b",
  });
  addText(slide, String(number).padStart(2, "0"), { left: 1160, top: 34, width: 48, height: 28 }, {
    fontSize: 14,
    bold: true,
    color: "#ca8a04",
    alignment: "right",
  });
  const rule = slide.shapes.add({
    geometry: "rect",
    position: { left: 72, top: 66, width: 1136, height: 2 },
    fill: "#e2e8f0",
    line: { style: "solid", fill: "none", width: 0 },
  });
  return rule;
}

function addBullets(slide, items, position, style = {}) {
  const text = items.map((item) => `- ${item}`).join("\n");
  addText(slide, text, position, {
    fontSize: style.fontSize ?? 23,
    color: style.color ?? "#0f172a",
    breakLine: true,
  });
}

function addMetricCard(slide, label, value, note, x, y, width = 250) {
  addBox(slide, { left: x, top: y, width, height: 116 }, { fill: "#f8fafc", lineFill: "#cbd5e1" });
  addText(slide, value, { left: x + 18, top: y + 18, width: width - 36, height: 36 }, {
    fontSize: 28,
    bold: true,
    color: "#172554",
  });
  addText(slide, label, { left: x + 18, top: y + 56, width: width - 36, height: 26 }, {
    fontSize: 14,
    bold: true,
    color: "#334155",
  });
  addText(slide, note, { left: x + 18, top: y + 82, width: width - 36, height: 22 }, {
    fontSize: 11,
    color: "#64748b",
  });
}

function createDeck() {
  const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });

  // Slide 1
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#f8fafc";
    addBox(slide, { left: 0, top: 0, width: 1280, height: 720 }, {
      geometry: "rect",
      fill: "#172554",
      lineFill: "none",
      lineWidth: 0,
      borderRadius: "rounded-none",
    });
    addBox(slide, { left: 0, top: 604, width: 1280, height: 116 }, {
      geometry: "rect",
      fill: "#facc15",
      lineFill: "none",
      lineWidth: 0,
      borderRadius: "rounded-none",
    });
    addText(slide, "Kathmandu University\nDepartment of Artificial Intelligence", { left: 82, top: 56, width: 760, height: 78 }, {
      fontSize: 22,
      color: "#dbeafe",
      bold: true,
    });
    addText(slide, "MarketGyan", { left: 82, top: 182, width: 820, height: 86 }, {
      fontSize: 62,
      bold: true,
      color: "#ffffff",
    });
    addText(slide, "NEPSE and Financial News Analysis\nAn Extension of Khabar AI", { left: 86, top: 284, width: 860, height: 88 }, {
      fontSize: 30,
      color: "#bfdbfe",
    });
    addText(slide, "Final Project Submission | Bikash Kumar Sah | Roll 16", { left: 86, top: 640, width: 900, height: 32 }, {
      fontSize: 22,
      bold: true,
      color: "#172554",
    });
    addText(slide, "July 3, 2026", { left: 1030, top: 642, width: 170, height: 28 }, {
      fontSize: 18,
      bold: true,
      color: "#172554",
      alignment: "right",
    });
  }

  // Slide 2
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#ffffff";
    addHeader(slide, "Problem", 2);
    addText(slide, "Nepal-market information is fragmented", { left: 72, top: 104, width: 930, height: 58 }, {
      fontSize: 42,
      bold: true,
      color: "#172554",
    });
    addBullets(slide, [
      "NEPSE movement, sector activity, news, and regulatory updates live in separate sources.",
      "General summaries do not answer whether a story is market-relevant.",
      "Financial users need evidence-backed explanation, not generic positive or negative tone.",
      "The system must avoid buy/sell advice and show why each claim is grounded.",
    ], { left: 90, top: 190, width: 720, height: 260 }, { fontSize: 24 });
    addBox(slide, { left: 875, top: 182, width: 300, height: 240 }, { fill: "#eff6ff", lineFill: "#93c5fd" });
    addText(slide, "Core Question", { left: 902, top: 216, width: 250, height: 28 }, {
      fontSize: 19,
      bold: true,
      color: "#1d4ed8",
    });
    addText(slide, "Can a Nepal-specific system connect market data, bilingual financial news, and citation-grounded generation?", { left: 902, top: 265, width: 245, height: 118 }, {
      fontSize: 22,
      color: "#0f172a",
    });
  }

  // Slide 3
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#f8fafc";
    addHeader(slide, "Contribution", 3);
    addText(slide, "What MarketGyan contributes", { left: 72, top: 104, width: 850, height: 56 }, {
      fontSize: 42,
      bold: true,
      color: "#172554",
    });
    const cards = [
      ["NEPSE-Impact-500", "500 adjudicated English/Nepali rows with sentence evidence."],
      ["Qwen3.5-9B LoRA", "Targeted-v2 adapter for compact structured impact extraction."],
      ["Finance RAG", "Qdrant evidence chunks with URL, hash, sentence IDs, and excerpts."],
      ["Demo System", "React dashboard for Ask, Evidence Search, Reports, and System status."],
    ];
    cards.forEach(([title, body], i) => {
      const x = 82 + (i % 2) * 548;
      const y = 192 + Math.floor(i / 2) * 174;
      addBox(slide, { left: x, top: y, width: 500, height: 130 }, { fill: "#ffffff", lineFill: "#cbd5e1" });
      addText(slide, title, { left: x + 24, top: y + 24, width: 440, height: 32 }, {
        fontSize: 24,
        bold: true,
        color: "#172554",
      });
      addText(slide, body, { left: x + 24, top: y + 66, width: 430, height: 46 }, {
        fontSize: 18,
        color: "#334155",
      });
    });
  }

  // Slide 4
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#ffffff";
    addHeader(slide, "Architecture", 4);
    addText(slide, "Final system architecture", { left: 72, top: 104, width: 760, height: 54 }, {
      fontSize: 40,
      bold: true,
      color: "#172554",
    });
    const nodes = [
      ["Sources", "NEPSE, news,\nNRB/SEBON", 74, 220],
      ["Backend", "Khabar AI\nNode APIs", 314, 220],
      ["Storage", "MongoDB\nrecords", 554, 220],
      ["Evidence", "Qdrant\n2038 chunks", 794, 220],
      ["Agent", "FastAPI\nsingle-pass RAG", 314, 420],
      ["Model", "Lightning vLLM\nQwen3.5-9B LoRA", 554, 420],
      ["Frontend", "React dashboard\nAsk/Search/Reports", 794, 420],
    ];
    nodes.forEach(([title, body, x, y]) => {
      addBox(slide, { left: x, top: y, width: 184, height: 102 }, { fill: title === "Model" ? "#fef3c7" : "#eff6ff", lineFill: "#93c5fd" });
      addText(slide, title, { left: x + 16, top: y + 14, width: 152, height: 22 }, { fontSize: 17, bold: true, color: "#172554" });
      addText(slide, body, { left: x + 16, top: y + 44, width: 154, height: 45 }, { fontSize: 16, color: "#334155" });
    });
    addBullets(slide, [
      "Changing facts stay in retrieval, not model weights.",
      "Citations are materialized from retrieved evidence rows.",
      "Unsupported answers fail closed.",
    ], { left: 74, top: 555, width: 1030, height: 78 }, { fontSize: 20 });
  }

  // Slide 5
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#f8fafc";
    addHeader(slide, "Dataset", 5);
    addText(slide, "NEPSE-Impact-500", { left: 72, top: 104, width: 600, height: 54 }, {
      fontSize: 42,
      bold: true,
      color: "#172554",
    });
    addMetricCard(slide, "Gold records", "500", "human-adjudicated", 80, 198);
    addMetricCard(slide, "Direct / indirect / hard-negative", "300 / 100 / 100", "balanced relevance gate", 365, 198, 320);
    addMetricCard(slide, "Languages", "299 EN / 200 NE", "plus 1 mixed", 724, 198, 310);
    addMetricCard(slide, "Symbol-level rows", "273", "listed-entity mapping", 80, 354);
    addMetricCard(slide, "Frozen split", "350 / 75 / 75", "train / validation / test", 365, 354, 320);
    addMetricCard(slide, "Core event floor", ">= 20", "per required category", 724, 354, 310);
    addText(slide, "Schema v2 fixed the pilot issue by separating relevance from potential impact and requiring numbered source-sentence evidence.", { left: 92, top: 540, width: 960, height: 58 }, {
      fontSize: 22,
      color: "#334155",
    });
  }

  // Slide 6
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#ffffff";
    addHeader(slide, "Modeling", 6);
    addText(slide, "Model path and final candidate", { left: 72, top: 104, width: 890, height: 54 }, {
      fontSize: 40,
      bold: true,
      color: "#172554",
    });
    addBullets(slide, [
      "Baselines: XLM-R, English-only FinBERT, and base Qwen prompting.",
      "Earlier Qwen3-8B QLoRA runs were diagnostic and failed strict schema/grounding gates.",
      "Final candidate: Qwen3.5-9B BF16 LoRA, targeted-v2 oversampling, best validation checkpoint.",
      "Training used only the frozen train split; test failures were not reused as training data.",
    ], { left: 90, top: 186, width: 920, height: 218 }, { fontSize: 23 });
    addBox(slide, { left: 92, top: 460, width: 990, height: 92 }, { fill: "#fefce8", lineFill: "#eab308" });
    addText(slide, "Final served adapter: marketgyan-qwen35-9b-targeted-v2", { left: 122, top: 490, width: 900, height: 30 }, {
      fontSize: 24,
      bold: true,
      color: "#713f12",
    });
  }

  // Slide 7
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#f8fafc";
    addHeader(slide, "Results", 7);
    addText(slide, "Frozen test-set result", { left: 72, top: 104, width: 690, height: 54 }, {
      fontSize: 40,
      bold: true,
      color: "#172554",
    });
    addMetricCard(slide, "Structured validity", "1.000", "passes gate", 78, 190);
    addMetricCard(slide, "Evidence grounding", "1.000", "passes gate", 352, 190);
    addMetricCard(slide, "Relevance macro-F1", "0.796", "passes target", 626, 190);
    addMetricCard(slide, "Direction macro-F1", "0.575", "below target", 900, 190);
    addMetricCard(slide, "Event macro-F1", "0.633", "below 0.65", 78, 344);
    addMetricCard(slide, "Sector F1", "0.677", "recall weak", 352, 344);
    addMetricCard(slide, "Symbol F1", "0.793", "below 0.81", 626, 344);
    addMetricCard(slide, "Evidence sentence F1", "0.736", "below 0.77", 900, 344);
    addText(slide, "Interpretation: the adapter learned schema and relevance, but content quality is still not deployable.", { left: 82, top: 540, width: 980, height: 36 }, {
      fontSize: 23,
      bold: true,
      color: "#334155",
    });
  }

  // Slide 8
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#ffffff";
    addHeader(slide, "Runtime", 8);
    addText(slide, "Why the live path is single-pass RAG", { left: 72, top: 104, width: 930, height: 54 }, {
      fontSize: 40,
      bold: true,
      color: "#172554",
    });
    addBullets(slide, [
      "Unconstrained direct prompting can emit reasoning text and is diagnostic only.",
      "vLLM JSON Schema constrained decoding is the structured model-only path.",
      "The CrewAI-style multi-agent prompt exceeded 4k, 8k, and 16k context limits.",
      "The final agent retrieves compact evidence and asks Qwen for evidence indexes in one pass.",
      "Public citations are reconstructed from retrieved rows, not hallucinated by the model.",
    ], { left: 88, top: 182, width: 940, height: 282 }, { fontSize: 23 });
    addBox(slide, { left: 92, top: 515, width: 930, height: 58 }, { fill: "#ecfdf5", lineFill: "#86efac" });
    addText(slide, "Result: 20/20 live scenarios passed schema, citation, grounding, disclaimer, and advice-safety checks.", { left: 116, top: 534, width: 880, height: 26 }, {
      fontSize: 20,
      bold: true,
      color: "#166534",
    });
  }

  // Slide 9
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#f8fafc";
    addHeader(slide, "System Evaluation", 9);
    addText(slide, "Proposal-aligned evaluation", { left: 72, top: 104, width: 780, height: 54 }, {
      fontSize: 40,
      bold: true,
      color: "#172554",
    });
    addMetricCard(slide, "Constrained validity", "0.987", "75-row frozen split", 80, 192, 270);
    addMetricCard(slide, "Constrained grounding", "0.987", "above 0.95 gate", 382, 192, 270);
    addMetricCard(slide, "Judged-query P@5", "0.262", "13 query groups", 684, 192, 270);
    addMetricCard(slide, "All-query P@5", "0.113", "30 query groups", 986, 192, 210);
    addBox(slide, { left: 86, top: 380, width: 1010, height: 118 }, { fill: "#fff7ed", lineFill: "#fdba74" });
    addText(slide, "Retrieval is the deployment blocker", { left: 116, top: 408, width: 780, height: 30 }, {
      fontSize: 25,
      bold: true,
      color: "#9a3412",
    });
    addText(slide, "Most empty query groups used sector or source filters that did not match the indexed payload metadata.", { left: 116, top: 452, width: 880, height: 32 }, {
      fontSize: 20,
      color: "#7c2d12",
    });
  }

  // Slide 10
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#ffffff";
    addHeader(slide, "Frontend Demo", 10);
    addText(slide, "Demo-ready workflow", { left: 72, top: 104, width: 720, height: 54 }, {
      fontSize: 40,
      bold: true,
      color: "#172554",
    });
    const checks = [
      ["System", "runtime status shows Qwen, agent, Qdrant, snapshot, and report readiness"],
      ["Ask", "live Qwen answer includes disclaimer, citations, sentence IDs, and expanded text"],
      ["Evidence", "search returns sentence-anchored ShareSansar evidence"],
      ["Reports", "2026-06-11 report published with 3 citations and 3 sector rows"],
    ];
    checks.forEach(([name, body], i) => {
      const y = 188 + i * 92;
      addBox(slide, { left: 92, top: y, width: 970, height: 66 }, { fill: "#f8fafc", lineFill: "#cbd5e1" });
      addText(slide, name, { left: 116, top: y + 17, width: 130, height: 24 }, {
        fontSize: 20,
        bold: true,
        color: "#172554",
      });
      addText(slide, body, { left: 270, top: y + 17, width: 760, height: 26 }, {
        fontSize: 19,
        color: "#334155",
      });
    });
  }

  // Slide 11
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#f8fafc";
    addHeader(slide, "Decision", 11);
    addText(slide, "Final decision: demo-only / research prototype", { left: 72, top: 104, width: 1040, height: 54 }, {
      fontSize: 38,
      bold: true,
      color: "#172554",
    });
    addBox(slide, { left: 86, top: 190, width: 480, height: 250 }, { fill: "#ecfdf5", lineFill: "#86efac" });
    addText(slide, "Passes", { left: 116, top: 220, width: 200, height: 30 }, { fontSize: 26, bold: true, color: "#166534" });
    addBullets(slide, [
      "schema validity",
      "evidence grounding",
      "relevance macro-F1",
      "single-pass citation scenarios",
      "local frontend/report smoke",
    ], { left: 120, top: 272, width: 380, height: 130 }, { fontSize: 20, color: "#14532d" });
    addBox(slide, { left: 626, top: 190, width: 480, height: 250 }, { fill: "#fef2f2", lineFill: "#fca5a5" });
    addText(slide, "Blocks deployment", { left: 656, top: 220, width: 300, height: 30 }, { fontSize: 26, bold: true, color: "#991b1b" });
    addBullets(slide, [
      "retrieval Precision@5",
      "neutral direction recall",
      "direction macro-F1",
      "sector/symbol recall",
      "evidence sentence recall",
    ], { left: 660, top: 272, width: 380, height: 130 }, { fontSize: 20, color: "#7f1d1d" });
    addText(slide, "The honest submission claim is a grounded demo system with measured limitations, not a production financial advisor.", { left: 90, top: 508, width: 980, height: 48 }, {
      fontSize: 24,
      bold: true,
      color: "#334155",
    });
  }

  // Slide 12
  {
    const slide = presentation.slides.add();
    slide.background.fill = "#172554";
    addText(slide, "Future Work", { left: 82, top: 72, width: 680, height: 62 }, {
      fontSize: 48,
      bold: true,
      color: "#ffffff",
    });
    addBullets(slide, [
      "Normalize source, sector, ticker, and document-type metadata in retrieval payloads.",
      "Rerun the 30-query retrieval benchmark until P@5 reaches the proposal minimum.",
      "Complete second annotation and report agreement metrics.",
      "Add targeted neutral, regulation, sector-industry, credit-financing, and ticker hard cases.",
      "Keep single-pass RAG and constrained decoding as the safe serving boundary.",
    ], { left: 96, top: 178, width: 980, height: 300 }, { fontSize: 24, color: "#dbeafe" });
    addBox(slide, { left: 82, top: 562, width: 1030, height: 68 }, { fill: "#facc15", lineFill: "none", lineWidth: 0 });
    addText(slide, "Thank you", { left: 112, top: 582, width: 460, height: 30 }, {
      fontSize: 28,
      bold: true,
      color: "#172554",
    });
    addText(slide, "Questions and discussion", { left: 760, top: 588, width: 320, height: 24 }, {
      fontSize: 20,
      color: "#172554",
      alignment: "right",
    });
  }

  return presentation;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const presentation = createDeck();

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    const png = await presentation.export({ slide, format: "png", scale: 1 });
    await writeBlob(path.join(outDir, `${stem}.png`), png);
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(outDir, `${stem}.layout.json`), await layout.text());
  }

  const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
  await writeBlob(path.join(outDir, "deck-montage.webp"), montage);

  const snapshot = await presentation.inspect({
    kind: "slide,textbox,shape,chart,table,layout",
    maxChars: 12000,
  });
  await fs.writeFile(path.join(outDir, "inspect.ndjson"), snapshot.ndjson);

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(pptxPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

# Foundry // System-One (`Microsoft-Decision-1.1` Showcase & Benchmark Suite)

- **Live GitHub Pages (Frontend-Only Mode)**: **`https://system-1.genisisiq.com/`**
- **Repository**: **`https://github.com/vibewatch/system-1`**

Interactive Next.js 15 enterprise showcase and head-to-head correctness & cost benchmark comparing **`Microsoft-Decision-1.1`** (`/providers/microsoft/v1/systemone`) against generative LLMs (such as **`gpt-6.1-terra`** via `/openai/v1/responses`) on **Azure AI Foundry** with **Microsoft Entra ID** or API-key authentication.

## Key Capabilities

1. **Recorded Replay (Default), with Explicit Live Execution**
   - Fresh visitors use 41 real Azure recordings covering 17 solutions, four conversations, three triage rates and the claims workflow. Replay makes no Azure, WebSocket or backend API calls.
   - Open **Demo replay** to pause/resume/stop, change speed, import/export a portable version-1 JSON file or switch to live mode. Original answers, latency, usage and queue timing are preserved; changed inputs require live execution.
   - Live execution defaults to **Frontend + Backend Server**, using `DefaultAzureCredential` / the logged-in Azure CLI.
   - Connect directly from your browser to an Azure AI Foundry endpoint and configure your **`Microsoft-Decision-1.1`** and comparison LLM deployments. Previously saved `Decision-1` deployment names migrate to `Decision-1.1`.
   - Authenticate via **Microsoft Entra ID OAuth2 PKCE Popup** (`@azure/msal-browser`), **Entra ID Bearer Token** (`az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv`), or **Foundry API Key**.
   - Browser-only execution remains selectable in **Connection settings**. Replay and live-transport preferences are separate.

2. **5 Interactive Decision Workflows**
   - **01 · Stream + Decide**: Streams conversations incrementally while both models evaluate `NOUL`, `CHOICE`, and `SCORE` questions with probability sparklines and answer-change markers. Each model permits one in-flight request and can skip intermediate snapshots; their update cadences are not a controlled same-snapshot benchmark.
   - **02 · Decision Studio**: Head-to-head latency race, calibrated probability distributions, Ground-Truth **Correctness Matrix**, raw JSON inspector, and copyable Entra ID `curl` commands.
   - **03 · Triage at Scale**: The same 40 customer messages arrive at 5/10/20 msgs/sec in two model lanes with 8 and 4 workers, respectively. Outstanding work includes running requests; average wait measures arrival to completion. Queue behavior reflects both concurrency and request latency, not an equal-concurrency benchmark.
   - **04 · Agent Gate & Form**: Pre-execution policy gate + 13-field entity span extraction + gated customer reply drafting.
   - **05 · Solutions & Benchmarks Hub**: **16 Enterprise Solutions across 9 Industry Verticals** with multi-case **Ground-Truth Correctness & Model Agreement** benchmarks (`Case 1: Violation / High-Risk` vs `Case 2: Compliant / Safe Pass`), plus an interactive **Custom Solution Studio** to author, test, and save your own solutions.

The comparison workbench leads with a paired result and same-scale latency, reference-correctness and estimated-cost bars. Either model can lead; ties and request failures are explicit. Errors from either model and answer disagreements sort first, and missing reference answers are not scored. Expand recorded-suite evidence for P50/P95 timings and aggregate reference matches, or adjust daily call volume to estimate business impact. Cost figures use repository rate assumptions with an explicit unverified-price notice; confidence is not presented as validated calibration.

Live Triage defaults to **Equal workers · 4 vs 4**. **Workload demo · 8 vs 4** preserves the existing recorded setup; included replays are never relabeled as equal-worker tests. Both lanes report failed attempts separately from successful throughput. Equal worker limits do not remove differences in deployment, region or network conditions.

## Quick Start

```bash
npm install
npm run build
PORT=3000 npm run start
```

Open **`http://localhost:3000`** to use recorded demos without signing in. Open **Demo replay → Return to live mode** for new evaluations; **Connection settings** selects the live transport and browser credentials.

Decision calls default to deployment `Decision-1.1` at `https://icsuaaije.services.ai.azure.com/models`. The `/models` suffix is removed before calling `/providers/microsoft/v1/systemone` or `/openai/v1/responses`. Set `AZURE_FOUNDRY_ENDPOINT` to the resource hosting the comparison LLM; it need not be the Decision resource. Override `AZURE_DECISION_ENDPOINT`, `AZURE_DECISION_DEPLOYMENT`, or `AZURE_TERRA_DEPLOYMENT` in an ignored `.env.local` file. Browser settings likewise keep the main comparison endpoint separate from the Decision endpoint. Authenticate with `az login` (or a managed identity), or set `AZURE_DECISION_API_KEY` securely for Decision requests (`AZURE_FOUNDRY_API_KEY` for the comparison resource). Never put keys in source code or `NEXT_PUBLIC_*` variables. Optionally set `AZURE_FALLBACK_DECISION_ENDPOINT` for a separate Decision-1.1 resource.

Every live model HTTP attempt is recorded, including health probes, comparison requests, extraction, streamed responses, fallback attempts and failures. Backend traces append to ignored `data/traces/model-calls.jsonl` (override with `AZURE_TRACE_FILE`). Browser-only traces persist in IndexedDB and can be downloaded using **Connection settings → Export browser model traces**. Traces include request payloads, raw responses (including SSE events), status, timing and errors; authentication headers are never recorded and credentials/resource identities are redacted. Review traces before sharing: prompts and outputs may still contain confidential prose. Browser storage can be cleared or limited by the browser.

## Replay recordings

The in-app **Watch technical demo** opens a historical 2:37 conversational English walkthrough of Decision-1 Stream and Triage, with English captions and chapter navigation. It follows a frustrated broadband customer and a busy support inbox, then explains the decisions, final outcomes and practical advantages in business terms. The video retains its original Decision-1 model labels and results; it is not a Decision-1.1 recording. It uses original recorded Azure events at 1× speed, with pauses and cuts for narration, and makes no live model calls. The [1080p MP4](public/demo-microsoft-decision-1.mp4) contains no music, promotional narration, or backend concurrency and worker-limit explanations.

`public/replays/showcase.json` contains 41 freshly recorded Decision-1.1 / gpt-6.1-terra Azure workflows and their original event offsets. No responses are synthesized during playback. Infrastructure endpoints and common authentication/identity metadata are redacted recursively on import, recording/checkpoint writes and export, without changing answers or measurements. Imported files remain in the current tab; a reload restores the included bundle. Redaction cannot identify every kind of confidential prose: review custom inputs and outputs before sharing exported files.

Redaction covers the current published assets and shared replay files. Existing Git history and previously downloaded copies are not rewritten.

```bash
npm run replay:test
# With the authenticated backend running:
npm run replay:record -- --include-custom --resume
```

The recorder validates both models, saves redacted resumable checkpoints, and preserves matching existing recordings. Redacted files omit resource identity, so reusing them requires explicit `--resume` and matches model names, inputs and question schemas. Without `--resume`, use a fresh output path to record a separate run.

## Shared typography and controls

Every workspace and dialog uses the font tokens in `src/app/globals.css`: `--font-xs` 11px (caption), `--font-sm` 12px (secondary), `--font-md` 14px (body), `--font-lg` 16px (card), `--font-xl` 20px (section), `--font-2xl` 24px (page), `--font-display` 32px and `--font-metric` 40px. Use these tokens rather than adding ad-hoc sizes; fonts remain non-italic.

`Tooltip` supplies hover/focus descriptions, Escape dismissal and viewport-aware positioning, including inside native dialogs. `IconButton` pairs an accessible label with an optional compact tag. Primary execution actions retain text labels. Header model names come from replay metadata, browser configuration or backend health; detailed connection information is available in **Model details**.

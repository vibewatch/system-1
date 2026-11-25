# Foundry // System-One (`Microsoft-Decision-1.1` Showcase & Benchmark Suite)

- **Live GitHub Pages (Frontend-Only Mode)**: **`https://system-1.genisisiq.com/`**
- **Repository**: **`https://github.com/vibewatch/system-1`**

Interactive Next.js 15 enterprise showcase and head-to-head correctness & cost benchmark comparing **`Microsoft-Decision-1.1`** (`/providers/microsoft/v1/systemone`) against generative LLMs (such as **`gpt-6.1-terra`** via `/openai/v1/responses`) on **Azure AI Foundry** with **Microsoft Entra ID** or API-key authentication.

## Key Capabilities

1. **Recorded Replay (Default), with Explicit Live Execution**
   - Fresh visitors use 49 real Azure recordings covering 17 solutions, four conversations, three triage rates and six claims cases. Replay makes no Azure, WebSocket or backend API calls.
   - Open **Demo replay** to pause/resume/stop, change speed, import/export a portable version-1 JSON file or switch to live mode. Original answers, latency, usage and queue timing are preserved; changed inputs require live execution.
   - Live execution defaults to **Frontend + Backend Server**, using `DefaultAzureCredential` / the logged-in Azure CLI.
   - Connect directly from your browser to an Azure AI Foundry endpoint and configure your **`Microsoft-Decision-1.1`** and comparison LLM deployments. Previously saved `Decision-1` deployment names migrate to `Decision-1.1`.
   - Authenticate via **Microsoft Entra ID OAuth2 PKCE Popup** (`@azure/msal-browser`), **Entra ID Bearer Token** (`az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv`), or **Foundry API Key**.
   - Browser-only execution remains selectable in **Connection settings**. Replay and live-transport preferences are separate.

2. **5 Interactive Decision Workflows**
   - **01 · Stream + Decide**: Symmetric latest-answer rows and transcript checkpoint meters show update cadence for both models. Each model permits one in-flight request and can skip intermediate snapshots; differing checkpoints are not scored as accuracy differences. Entity extraction uses the comparison LLM plus pattern matches; answer-change markers track Decision-1.1.
   - **02 · Decision Workbench**: Shared input beside a compact paired timing/reference/cost summary, criterion verification, probability distributions, raw JSON and copyable Entra ID `curl` commands. Probability calibration has not been evaluated.
   - **03 · Triage at Scale**: The same 40 customer messages arrive at 5/10/20 msgs/sec with four workers per model in the default live mode and included recordings. Outstanding work includes running requests; request timing is separate from arrival-to-completion queue timing.
   - **04 · Claims**: Compact linked workbench with inline email highlights, symmetric policy decisions, 13-field extraction and a safe next-action strip. Six synthetic cases cover complete intake, injury, over-limit repairs, missing police references, unclear fault and the exact GBP 5,000 boundary.
   - **05 · Industry Catalog**: Compact business-task and capability cards, filtered batch evaluation of all matching recorded cases, and a custom solution builder. Failures and incomplete pairs are reported separately, excluded from reference scores and latency. Aggregate timing is weighted by cases, not by solutions. Search and industry filters scope both cards and results.

The comparison workbench puts the original input alongside a paired result and compact, symmetric model table. Either model can lead; ties and request failures are explicit. Errors from either model and answer disagreements sort first, and missing reference answers are not scored. Expand recorded-suite evidence for P50/P95 timings and aggregate reference matches, or expand cost assumptions to adjust daily call volume. Costs use assumed prices, not Azure charges.

Triage defaults to **Equal workers · 4 vs 4**, with freshly recorded equal-worker Azure runs at all three arrival rates. **Workload demo · 8 vs 4** remains available only in live mode and is explicitly labeled unequal. Both lanes report failed attempts separately from successful throughput. Equal worker limits do not remove differences in deployment, region or network conditions.

Tool authorization, model routing and research screening use replacement cases with complete policies rather than ambiguous intent or relevance grades. Tool inputs include actual script definitions and distinguish allow/approval/block. Routing evaluates executable destinations rather than an unanchored complexity score. Research abstracts are explicitly synthetic and distinguish include/exclude/second-review. References are defined before calls; recordings are not selected or retried to improve reference correctness.

Claims compares only the two models' policy requests. Form extraction belongs to the comparison LLM and is not a Decision-1.1 capability or a full-pipeline speed comparison. The application enforces primitive policy facts, validates exact source quotes and extracted repair amounts, and sends contradictions, unknown facts and failures to review or a blocked workflow. A fast-track candidate is never coverage approval or payment authorization. Extraction failures are distinct from missing customer information, and drafts never invent customer details. Edited emails lose their reference score and require live execution. Both browser and backend transports use the same orchestration, parser and outcome rules; Claims replays must match the policy/schema as well as the email.

The Claims email and results link in both directions: select a highlighted phrase to locate its field or policy check, or select a result to focus the original email. Overlapping field/policy spans preserve the complete source. Policy highlights use explicitly labeled fixture references, not invented model explanations; missing fields have no fabricated spans. Gate results appear independently as their real events arrive, while extraction arrives as one actual result rather than simulated per-field streaming. Custom selectors, tooltips, icon buttons and disclosure controls share the surrounding workspace styling; policy text, estimated costs, JSON and reply drafts are available on demand rather than repeated in the main view.

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

The historical Decision-1 video is no longer linked in the interface because its labels and measurements do not represent Decision-1.1. Use the interactive recordings for current model comparisons.

`public/replays/showcase.json` contains 49 freshly recorded Decision-1.1 / gpt-6.1-terra Azure workflows and their original event offsets: 36 paired scenario cases, four streams, three triage rates and six claims cases. No responses are synthesized during playback. Infrastructure endpoints and common authentication/identity metadata are redacted recursively on import, recording/checkpoint writes and export, without changing answers or measurements. Imported files remain in the current tab; a reload restores the included bundle. Redaction cannot identify every kind of confidential prose: review custom inputs and outputs before sharing exported files.

Redaction covers the current published assets and shared replay files. Existing Git history and previously downloaded copies are not rewritten.

```bash
npm run replay:test
# With the authenticated backend running:
npm run replay:record -- --include-custom --resume
```

The recorder validates both models, saves redacted resumable checkpoints, and preserves matching existing recordings. Redacted files omit resource identity, so reusing them requires explicit `--resume` and matches model names, inputs and question schemas. Without `--resume`, use a fresh output path to record a separate run.

## Shared typography and controls

Every workspace and dialog uses the font tokens in `src/app/globals.css`: `--font-xs` 11px (caption), `--font-sm` 12px (secondary), `--font-md` 14px (body), `--font-lg` 16px (card), `--font-xl` 20px (section), `--font-2xl` 24px (page), `--font-display` 32px and `--font-metric` 40px. Use these tokens rather than adding ad-hoc sizes; fonts remain non-italic.

`Tooltip` supplies hover/keyboard-focus descriptions without intercepting page controls. `CustomSelect` supports arrow keys, Home/End, Enter and Escape with focus restoration. All dialogs use the shared styled `Dialog` with modal focus containment and Escape dismissal; expandable details use custom disclosure buttons. Builder and connection grids collapse on narrow screens. `IconButton` pairs an accessible label with an optional compact tag. Primary actions retain text labels. Header model names come from replay metadata, browser configuration or backend health.

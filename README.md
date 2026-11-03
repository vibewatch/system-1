# Foundry // System-One (`Microsoft-Decision-1` Showcase & Benchmark Suite)

- **Live GitHub Pages (Frontend-Only Mode)**: **`https://system-1.genisisiq.com/`**
- **Repository**: **`https://github.com/vibewatch/system-1`**

Interactive Next.js 15 enterprise showcase and head-to-head correctness & cost benchmark comparing **`Microsoft-Decision-1`** (`/providers/microsoft/v1/systemone`) against generative LLMs (such as **`gpt-6.1-terra`** via `/openai/v1/responses`) on **Azure AI Foundry** with **Microsoft Entra ID** authentication.

## Key Capabilities

1. **Recorded Replay (Default), with Explicit Live Execution**
   - Fresh visitors use 41 real Azure recordings covering 17 solutions, four conversations, three triage rates and the claims workflow. Replay makes no Azure, WebSocket or backend API calls.
   - Open **Demo replay** to pause/resume/stop, change speed, import/export a portable version-1 JSON file or switch to live mode. Original answers, latency, usage and queue timing are preserved; changed inputs require live execution.
   - Live execution defaults to **Frontend + Backend Server**, using `DefaultAzureCredential` / the logged-in Azure CLI.
   - Connect directly from your browser to your own Azure AI Foundry endpoint (`https://<your-resource>.cognitiveservices.azure.com`) and configure your **`Microsoft-Decision-1`** and comparison LLM deployments.
   - Authenticate via **Microsoft Entra ID OAuth2 PKCE Popup** (`@azure/msal-browser`), **Entra ID Bearer Token** (`az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv`), or **Foundry API Key**.
   - Browser-only execution remains selectable in **Connection settings**. Replay and live-transport preferences are separate.

2. **5 Interactive Decision Workflows**
   - **01 · Stream + Decide**: Streams conversations incrementally while both models evaluate `NOUL`, `CHOICE`, and `SCORE` questions with probability sparklines and answer-change markers. Each model permits one in-flight request and can skip intermediate snapshots; their update cadences are not a controlled same-snapshot benchmark.
   - **02 · Decision Studio**: Head-to-head latency race, calibrated probability distributions, Ground-Truth **Correctness Matrix**, raw JSON inspector, and copyable Entra ID `curl` commands.
   - **03 · Triage at Scale**: The same 40 customer messages arrive at 5/10/20 msgs/sec in two model lanes with 8 and 4 workers, respectively. Outstanding work includes running requests; average wait measures arrival to completion. Queue behavior reflects both concurrency and request latency, not an equal-concurrency benchmark.
   - **04 · Agent Gate & Form**: Pre-execution policy gate + 13-field entity span extraction + gated customer reply drafting.
   - **05 · Solutions & Benchmarks Hub**: **16 Enterprise Solutions across 9 Industry Verticals** with multi-case **Ground-Truth Correctness & Model Agreement** benchmarks (`Case 1: Violation / High-Risk` vs `Case 2: Compliant / Safe Pass`), plus an interactive **Custom Solution Studio** to author, test, and save your own solutions.

## Quick Start

```bash
npm install
npm run build
PORT=3000 npm run start
```

Open **`http://localhost:3000`** to use recorded demos without signing in. Open **Demo replay → Return to live mode** for new evaluations; **Connection settings** selects the live transport and browser credentials.

For backend live execution, put `AZURE_FOUNDRY_ENDPOINT=https://<your-foundry-resource>.cognitiveservices.azure.com` in an ignored `.env.local` file and authenticate with `az login`. Optionally set `AZURE_FALLBACK_DECISION_ENDPOINT` for a separate Decision-1 resource. Production resource addresses are not frontend defaults or public replay metadata.

## Replay recordings

The in-app **Watch technical demo** opens a 2:58 conversational English walkthrough of Stream and Triage, with English captions and chapter navigation. It introduces Decision-1, follows a frustrated broadband customer and a busy support inbox, then explains the decisions, final outcomes and practical advantages in business terms. It uses original recorded Azure events at 1× speed, acknowledges the different worker limits, and makes no live model calls. The [1080p MP4](public/demo-microsoft-decision-1.mp4) contains no music or promotional narration.

`public/replays/showcase.json` contains original Azure outputs and event offsets, reused from the project's recorded demonstration history. No responses are synthesized during playback. Infrastructure endpoints and common authentication/identity metadata are redacted recursively on import, recording/checkpoint writes and export, without changing answers or measurements. Imported files remain in the current tab; a reload restores the included bundle. Redaction cannot identify every kind of confidential prose: review custom inputs and outputs before sharing exported files.

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

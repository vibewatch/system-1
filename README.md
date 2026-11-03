# Foundry // System-One (`Microsoft-Decision-1` Showcase & Benchmark Suite)

- **Live GitHub Pages (Frontend-Only Mode)**: **`https://huangyingting.github.io/system-1/`**
- **Repository**: **`https://github.com/huangyingting/system-1`**

Interactive Next.js 15 enterprise showcase and head-to-head correctness & cost benchmark comparing **`Microsoft-Decision-1`** (`/providers/microsoft/v1/systemone`) against generative LLMs (such as **`gpt-6.1-terra`** via `/openai/v1/responses`) on **Azure AI Foundry** with **Microsoft Entra ID** authentication.

## Key Capabilities

1. **Backend Server Mode (Default), with Optional Client-Only Entra ID Login**
   - Connect directly from your browser to your own Azure AI Foundry endpoint (`https://<your-resource>.cognitiveservices.azure.com`) and configure your **`Microsoft-Decision-1`** and comparison LLM deployments.
   - Authenticate via **Microsoft Entra ID OAuth2 PKCE Popup** (`@azure/msal-browser`), **Entra ID Bearer Token** (`az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv`), or **Foundry API Key**.
   - Default **Backend Server Mode** uses `WebSocket` + the Node server's `DefaultAzureCredential` / `az cli`. Select client-only mode to use your own endpoint from the browser.

2. **5 Interactive Decision Workflows**
   - **01 · Stream + Decide**: Streams live conversations word-by-word while `Microsoft-Decision-1` re-evaluates `NOUL`, `CHOICE`, and `SCORE` questions on every word with live probability sparklines and mind-change markers.
   - **02 · Decision Studio**: Head-to-head latency race, calibrated probability distributions, Ground-Truth **Correctness Matrix**, raw JSON inspector, and copyable Entra ID `curl` commands.
   - **03 · Triage at Scale**: High-throughput customer message queue simulation at 5/10/20 msgs/sec comparing sub-350ms `Microsoft-Decision-1` routing vs multi-second generative LLM bottlenecks.
   - **04 · Agent Gate & Form**: Pre-execution policy gate + 13-field entity span extraction + gated customer reply drafting.
   - **05 · Solutions & Benchmarks Hub**: **16 Enterprise Solutions across 9 Industry Verticals** with multi-case **Ground-Truth Correctness & Model Agreement** benchmarks (`Case 1: Violation / High-Risk` vs `Case 2: Compliant / Safe Pass`), plus an interactive **Custom Solution Studio** to author, test, and save your own solutions.

## Quick Start

```bash
npm install
npm run build
PORT=3000 npm run start
```

Open **`http://localhost:3000`** and use **Options → Connection settings** to configure execution mode and Azure credentials.

## Recorded demo replay

The homepage leads with **Live story**: an authorized $75 refund, an untrusted
tool redirect to $750, and recovery after fresh Finance approval. Choose
**Play recorded story** for a short, sign-in-free demonstration, or **Run live
checks** with your Azure connection. The input is scripted; both models evaluate
the three checkpoints independently. The displayed action gate is a suggested
application policy decision, not an executed payment or a general safety guarantee.
Use the pastel shortcuts to inspect paired ground truth, queue pressure, or agent supervision.

Alternatively, open **Options → Demo replay → Use recorded demos**. The normal comparison,
conversation, queue and claims controls then play recorded Azure event timelines,
without model calls or Entra ID sign-in. Pause/resume and 0.5×/1×/2×/4× playback
are available. Latency, token usage and costs remain those of the original run;
replay is explicitly labelled and is not a new performance benchmark.

The included file contains **44 real Azure recordings**: 35 test cases for
18 solutions (including the saved custom BGP gate), five stories (one scripted
authorization trace and four generated conversations), three
triage rates, and one claims workflow.
The portable recording is **[`public/replays/showcase.json`](public/replays/showcase.json)**.
Download it from the replay dialog, or import a version-1 JSON file there.
Imported recordings last for the current tab; reload restores the bundled file.
Changed inputs or questions have no recorded result and require live mode.
The default live execution mode remains **Frontend + Backend Server**; client-only
mode is available under **Options → Connection settings**.

To regenerate all built-in test cases, all four conversation scenarios, triage at
5/10/20 messages per second, and the claims workflow against your authenticated
local backend:

```bash
npm run replay:record
npm run replay:test
```

Use `npm run replay:record -- --include-custom` to include saved custom scenarios.
Add `--resume` to retain matching recordings from an existing completed archive
when adding new cases. For changed runtime scripts or backend behavior, record a
fresh archive rather than resuming old results.
`REPLAY_WS_URL` and `REPLAY_OUTPUT` override the server and destination.
Successful sessions are checkpointed so a failed run can resume; the final file
is published only after all requested recordings complete successfully.
Files contain demo inputs, model outputs and event timing, never authorization
headers. Review custom data before committing or sharing recordings.

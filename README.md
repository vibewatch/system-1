# Foundry // System-One (`Microsoft-Decision-1` Showcase & Benchmark Suite)

- **Live GitHub Pages (Frontend-Only Mode)**: **`https://huangyingting.github.io/system-1/`**
- **Repository**: **`https://github.com/huangyingting/system-1`**

Interactive Next.js 15 enterprise showcase and head-to-head correctness & cost benchmark comparing **`Microsoft-Decision-1`** (`/providers/microsoft/v1/systemone`) against generative LLMs (such as **`gpt-6.1-terra`** via `/openai/v1/responses`) on **Azure AI Foundry** with **Microsoft Entra ID** authentication.

## Key Capabilities

1. **Frontend-Only Mode (Default) with Microsoft Entra ID Login**
   - Connect directly from your browser to your own Azure AI Foundry endpoint (`https://<your-resource>.cognitiveservices.azure.com`) and configure your **`Microsoft-Decision-1`** and comparison LLM deployments.
   - Authenticate via **Microsoft Entra ID OAuth2 PKCE Popup** (`@azure/msal-browser`), **Entra ID Bearer Token** (`az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv`), or **Foundry API Key**.
   - Optionally switch to **Backend Server Mode** (`WebSocket` + Node server using `DefaultAzureCredential` / `az cli`).

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

Open **`http://localhost:3000`** and click **⚙ Azure Endpoint & Entra ID** in the top navigation bar to configure your Azure AI Foundry endpoint and Microsoft Entra ID credentials (or switch to Backend Server Mode).

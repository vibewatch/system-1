"use client";

import React, { useState } from "react";
import {
  type AzureClientConfig,
  type BrowserAuthMethod,
  type ExecutionMode,
  callDecision1Browser,
  signInWithEntraPopup,
} from "@/lib/client-foundry";
import { CustomSelect } from "./CustomSelect";
import { Dialog } from "./Dialog";

interface Props {
  open: boolean;
  config: AzureClientConfig;
  onSave: (next: AzureClientConfig) => void;
  onClose: () => void;
}

export function AzureSettingsModal({ open, config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AzureClientConfig>(config);
  const [testing, setTesting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  if (!open) return null;

  const update = (patch: Partial<AzureClientConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleMsalLogin = async () => {
    setSigningIn(true);
    setStatusMsg(null);
    try {
      const res = await signInWithEntraPopup(draft.tenantId, draft.clientId);
      const updated: AzureClientConfig = {
        ...draft,
        accessToken: res.accessToken,
        accountName: res.accountName,
        tokenExpiresAt: res.expiresAt,
      };
      setDraft(updated);
      setStatusMsg({
        ok: true,
        text: `Signed in with Microsoft Entra ID as ${res.accountName}. Access token acquired for https://cognitiveservices.azure.com.`,
      });
    } catch (err: any) {
      setStatusMsg({
        ok: false,
        text:
          err?.message ||
          "Entra ID popup sign-in failed. Ensure Redirect URI matches your SPA App Registration or use Entra ID CLI Bearer Token below.",
      });
    } finally {
      setSigningIn(false);
    }
  };

  const handleTestAndSave = async () => {
    setStatusMsg(null);
    if (draft.mode === "backend") {
      onSave(draft);
      setStatusMsg({
        ok: true,
        text: "Switched to Backend Server Mode (WebSocket + Server DefaultAzureCredential).",
      });
      setTimeout(() => onClose(), 450);
      return;
    }

    if (!draft.endpoint.trim()) {
      setStatusMsg({
        ok: false,
        text: "Please enter your Azure AI Foundry Endpoint URL (e.g. https://<your-resource>.cognitiveservices.azure.com).",
      });
      return;
    }
    if (!draft.accessToken.trim()) {
      setStatusMsg({
        ok: false,
        text: "Please sign in with Microsoft Entra ID or paste your Entra ID Access Token before saving.",
      });
      return;
    }

    setTesting(true);
    try {
      const res = await callDecision1Browser(
        draft,
        "Verify Microsoft-Decision-1 deployment readiness.",
        [
          {
            id: "ready",
            label: "Ready",
            type: "noul",
            instructions: "Is this a readiness check?",
          },
        ]
      );
      onSave(draft);
      setStatusMsg({
        ok: true,
        text: `Connected to ${draft.decisionDeployment} on ${draft.endpoint} (${res.latency_ms}ms). Configuration saved.`,
      });
      setTimeout(() => onClose(), 700);
    } catch (err: any) {
      // Still allow saving configuration even if CORS or network check failed
      onSave(draft);
      setStatusMsg({
        ok: false,
        text: `Saved settings, but live browser probe returned: ${
          err?.message || "Network / CORS error"
        }`,
      });
    } finally {
      setTesting(false);
    }
  };

  const copyAzCliCommand = () => {
    navigator.clipboard.writeText(
      "az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv"
    );
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Connection settings" maxWidth={680}>
      <div
        className="settings-content"
      >
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Connection &amp; Execution Mode
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--text-muted)",
                marginTop: 2,
              }}
            >
              Default is Frontend + Backend Server Mode. Switch to Client-Only
              Mode to connect your own Azure AI Foundry endpoint directly from
              the browser.
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close &times;
          </button>
        </div>

        <div
          className="modal-body"
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {/* Execution Mode Selector */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: draft.mode === "frontend" ? "1fr 1fr" : "1fr",
              gap: 12,
            }}
          >
            <CustomSelect
              label="Execution Architecture Mode"
              value={draft.mode}
              onChange={(val) => update({ mode: val as ExecutionMode })}
              options={[
                {
                  value: "backend",
                  label:
                    "Frontend + Backend Server Mode (Default — WebSocket + Server Entra ID)",
                  badge: "DEFAULT",
                  badgeTone: "d1",
                  description:
                    "Uses the backend server's pre-authenticated Azure CLI / DefaultAzureCredential over real-time WebSocket.",
                },
                {
                  value: "frontend",
                  label:
                    "Client-Only Mode (Direct Browser to Your Azure Foundry Endpoint)",
                  badge: "CLIENT-ONLY",
                  badgeTone: "info",
                  description:
                    "Runs 100% in the browser using your own Azure AI Foundry endpoint and Microsoft Entra ID login.",
                },
              ]}
            />

            {draft.mode === "frontend" && (
              <CustomSelect
                label="Entra ID / Foundry Auth Method"
                value={draft.authMethod}
                onChange={(val) =>
                  update({ authMethod: val as BrowserAuthMethod })
                }
                options={[
                  {
                    value: "entra_msal",
                    label: "Microsoft Entra ID Interactive Login (MSAL OAuth2)",
                    badge: "ENTRA OAUTH",
                    badgeTone: "d1",
                    description:
                      "Sign in via Microsoft Entra ID popup using your Tenant ID & SPA Client ID.",
                  },
                  {
                    value: "entra_token",
                    label: "Microsoft Entra ID Bearer Access Token (az cli)",
                    badge: "ENTRA TOKEN",
                    badgeTone: "info",
                    description:
                      "Paste an Entra ID access token for https://cognitiveservices.azure.com.",
                  },
                  {
                    value: "api_key",
                    label: "Azure Foundry API Key",
                    badge: "API KEY",
                    badgeTone: "neutral",
                    description: "Authenticate with api-key header if enabled.",
                  },
                ]}
              />
            )}
          </div>

          {draft.mode === "frontend" ? (
            <>
              {/* Endpoint & Model Deployments */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    AZURE AI FOUNDRY ENDPOINT URL (REQUIRED)
                  </div>
                  <input
                    className="q-input"
                    style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}
                    placeholder="https://<your-resource>.cognitiveservices.azure.com"
                    value={draft.endpoint}
                    onChange={(e) => update({ endpoint: e.target.value })}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    OPTIONAL SEPARATE DECISION-1 ENDPOINT (BLANK = SAME)
                  </div>
                  <input
                    className="q-input"
                    style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}
                    placeholder="Leave blank if Decision-1 is on the same endpoint"
                    value={draft.decisionEndpoint}
                    onChange={(e) =>
                      update({ decisionEndpoint: e.target.value })
                    }
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    MICROSOFT-DECISION-1 DEPLOYMENT NAME
                  </div>
                  <input
                    className="q-input"
                    style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}
                    placeholder="Decision-1"
                    value={draft.decisionDeployment}
                    onChange={(e) =>
                      update({ decisionDeployment: e.target.value })
                    }
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    COMPARISON LLM DEPLOYMENT NAME (RESPONSES API)
                  </div>
                  <input
                    className="q-input"
                    style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}
                    placeholder="gpt-6.1-terra (or gpt-4o / gpt-4.1)"
                    value={draft.terraDeployment}
                    onChange={(e) =>
                      update({ terraDeployment: e.target.value })
                    }
                  />
                </div>
              </div>

              {/* Entra ID MSAL OAuth2 Section */}
              {draft.authMethod === "entra_msal" && (
                <div
                  className="q-editor-card"
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "0.72rem",
                        color: "var(--accent-d1)",
                      }}
                    >
                      MICROSOFT ENTRA ID INTERACTIVE SIGN-IN (MSAL.JS PKCE)
                    </div>
                    {draft.accountName && (
                      <span className="cselect-badge badge-d1">
                        Signed in: {draft.accountName}
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr auto",
                      gap: 8,
                      alignItems: "end",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: "0.64rem",
                          color: "var(--text-muted)",
                          marginBottom: 3,
                        }}
                      >
                        ENTRA TENANT ID (OR &quot;common&quot;)
                      </div>
                      <input
                        className="q-input"
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: "0.74rem",
                        }}
                        placeholder="common or <tenant-guid>"
                        value={draft.tenantId}
                        onChange={(e) => update({ tenantId: e.target.value })}
                      />
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: "0.64rem",
                          color: "var(--text-muted)",
                          marginBottom: 3,
                        }}
                      >
                        SPA APPLICATION (CLIENT) ID
                      </div>
                      <input
                        className="q-input"
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: "0.74rem",
                        }}
                        placeholder="Enter Azure App Registration Client ID"
                        value={draft.clientId}
                        onChange={(e) => update({ clientId: e.target.value })}
                      />
                    </div>
                    <button
                      type="button"
                      className="primary"
                      disabled={signingIn}
                      onClick={handleMsalLogin}
                    >
                      {signingIn
                        ? "Signing in..."
                        : "Sign in with Microsoft Entra ID"}
                    </button>
                  </div>
                </div>
              )}

              {/* Entra Bearer Token / API Key Input */}
              <div className="q-editor-card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.68rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {draft.authMethod === "api_key"
                      ? "AZURE FOUNDRY API KEY"
                      : "ENTRA ID BEARER ACCESS TOKEN (https://cognitiveservices.azure.com)"}
                  </div>
                  {draft.authMethod !== "api_key" && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.66rem" }}
                      onClick={copyAzCliCommand}
                    >
                      {copiedCmd
                        ? "Copied az cli command!"
                        : "Copy `az account get-access-token` cmd"}
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  className="q-input"
                  style={{ fontFamily: "var(--mono)", fontSize: "0.74rem" }}
                  placeholder={
                    draft.authMethod === "api_key"
                      ? "Paste Azure Foundry API key..."
                      : "Paste Entra ID Bearer token (or use Sign in with Microsoft Entra ID above)..."
                  }
                  value={draft.accessToken}
                  onChange={(e) => update({ accessToken: e.target.value })}
                />
              </div>
            </>
          ) : (
            <div
              style={{
                padding: 14,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg-input)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  color: "var(--primary)",
                  marginBottom: 4,
                }}
              >
                FRONTEND + BACKEND SERVER MODE (DEFAULT)
              </div>
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                }}
              >
                All evaluations and streaming sessions route over WebSocket (
                <code>/ws</code>) and REST APIs through the backend server using
                its pre-authenticated Microsoft Entra ID (
                <code>DefaultAzureCredential</code> / <code>az cli</code>) and
                configured Azure AI Foundry endpoint. Switch to{" "}
                <b>Client-Only Mode</b> above anytime to run directly from the
                browser against your own Azure endpoint.
              </div>
            </div>
          )}

          {statusMsg && (
            <div
              style={{
                padding: "9px 12px",
                borderRadius: 6,
                border: `1px solid ${
                  statusMsg.ok ? "var(--border-strong)" : "var(--danger)"
                }`,
                background: statusMsg.ok
                  ? "var(--primary-soft)"
                  : "var(--danger-soft)",
                color: statusMsg.ok ? "var(--primary)" : "var(--danger)",
                fontFamily: "var(--mono)",
                fontSize: "0.73rem",
              }}
            >
              {statusMsg.text}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 4,
              paddingTop: 12,
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const next: AzureClientConfig = {
                  ...draft,
                  mode: draft.mode === "backend" ? "frontend" : "backend",
                };
                setDraft(next);
              }}
            >
              {draft.mode === "backend"
                ? "Switch to Client-Only Mode"
                : "Reset to Default Backend Mode"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              {draft.mode === "frontend" && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    onSave(draft);
                    onClose();
                  }}
                >
                  Save Without Probe
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={testing}
                onClick={handleTestAndSave}
              >
                {testing
                  ? "Verifying Endpoint..."
                  : draft.mode === "frontend"
                  ? "Verify Endpoint & Save"
                  : "Apply Default Backend Mode"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

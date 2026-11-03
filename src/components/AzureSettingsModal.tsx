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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(3, 7, 18, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{
          width: "100%",
          maxWidth: 740,
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid var(--accent-d1)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.65)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <div>
            <div className="panel-title">
              Azure AI Foundry &amp; Entra ID Configuration
            </div>
            <div className="panel-sub">
              Default mode is Frontend-Only (Direct Browser to Your Azure
              Foundry Endpoint with Entra ID). You can also switch to Backend
              Server Mode.
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close &times;
          </button>
        </div>

        <div
          className="panel-body"
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {/* Execution Mode Selector */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <CustomSelect
              label="Execution Architecture Mode (Configurable)"
              value={draft.mode}
              onChange={(val) => update({ mode: val as ExecutionMode })}
              options={[
                {
                  value: "frontend",
                  label:
                    "Frontend-Only Mode (Default — Direct Browser to User Azure Endpoint)",
                  badge: "DEFAULT",
                  badgeTone: "d1",
                  description:
                    "Runs 100% in the browser using your own Azure AI Foundry endpoint and Entra ID login.",
                },
                {
                  value: "backend",
                  label:
                    "Backend Server Mode (Node WebSocket + Server Entra ID)",
                  badge: "SERVER WS",
                  badgeTone: "neutral",
                  description:
                    "Uses the server's pre-authenticated Azure CLI / DefaultAzureCredential over WebSocket.",
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
                      className="btn btn-primary"
                      disabled={signingIn}
                      onClick={handleMsalLogin}
                    >
                      {signingIn
                        ? "Signing in..."
                        : "Sign in with Microsoft Entra ID"}
                    </button>
                  </div>

                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Tip: You can also paste an Entra ID Bearer token directly
                    below if your organization restricts third-party SPA client
                    registrations.
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
            <div className="q-editor-card">
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "0.74rem",
                  color: "var(--accent-d1)",
                  marginBottom: 4,
                }}
              >
                BACKEND SERVER MODE ACTIVE
              </div>
              <div
                style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}
              >
                All evaluations and streaming sessions route over WebSocket (
                <code>/ws</code>) through the backend server using its logged-in
                Microsoft Entra ID (<code>DefaultAzureCredential</code> /{" "}
                <code>az cli</code>) and configured Azure AI Foundry endpoint.
              </div>
            </div>
          )}

          {statusMsg && (
            <div
              style={{
                padding: "9px 12px",
                borderRadius: 6,
                border: `1px solid ${
                  statusMsg.ok
                    ? "rgba(16, 185, 129, 0.4)"
                    : "rgba(239, 68, 68, 0.4)"
                }`,
                background: statusMsg.ok
                  ? "var(--accent-d1-soft)"
                  : "rgba(239, 68, 68, 0.1)",
                color: statusMsg.ok ? "var(--accent-d1)" : "var(--danger)",
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
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={() => {
                const next: AzureClientConfig = {
                  ...draft,
                  mode: "backend",
                };
                setDraft(next);
                onSave(next);
                onClose();
              }}
            >
              Use Demo Backend Server Instead
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onSave(draft);
                  onClose();
                }}
              >
                Save Without Probe
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={testing}
                onClick={handleTestAndSave}
              >
                {testing
                  ? "Verifying Endpoint..."
                  : draft.mode === "frontend"
                  ? "Verify Endpoint & Save"
                  : "Apply Backend Mode"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

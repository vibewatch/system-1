"use client";

import React from "react";
import type { RuntimeScenario } from "@/lib/demo-data";
import type { NormalizedDecision } from "@/lib/foundry";
import { storyAction, type NavigationProgress } from "@/lib/decision-story";

interface Props {
  scenario: RuntimeScenario;
  index: number;
  answers: Record<string, NormalizedDecision>;
  navigationProgress: NavigationProgress | null;
}

const displayFacts = (scenario: RuntimeScenario, index: number) => (
  <dl className="scene-facts">{Object.entries(scenario.stages?.[index]?.facts || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
);

export function DecisionScene({ scenario, index, answers, navigationProgress }: Props) {
  const story = scenario.story!;
  const rawChoice = String(answers.next_action?.key || "");
  const suggestion = storyAction(scenario, answers);
  const chosen = suggestion?.label === story.actions[rawChoice]?.label ? rawChoice : "";
  const returned = Boolean(answers.next_action);

  if (story.visual === "adaptive") {
    const ordered = [...(story.items || [])].sort((a, b) => (answers[b.questionId!]?.value || 0) - (answers[a.questionId!]?.value || 0));
    return <div className="decision-scene adaptive-scene" data-layout={chosen}>
      <div className="scene-topline"><strong>Approved component catalogue</strong><span>App-rendered · model-ranked</span></div>
      <div className={`adaptive-widgets ${chosen}`}>
        {ordered.map((item) => {
          const answer = answers[item.questionId!];
          const hidden = answer?.key === 0;
          return <div key={item.id} className={`adaptive-widget widget-${item.id} ${answer?.key === 2 ? "primary-widget" : ""} ${hidden ? "hidden-widget" : ""}`} data-widget={item.id} data-relevance={answer?.label || "pending"}>
            <div><strong>{item.label}</strong><span>{answer?.label || "Available"}</span></div>
            {!hidden && <div className="widget-preview">
              {item.id === "map" ? <div className="mini-zone-map"><span>A</span><span>B</span><span>C</span></div>
                : item.id === "review" ? <div className="mini-review-inbox"><span>Refund approval · DEMO-1042</span><span>Pending recipient check</span></div>
                : <div className="mini-summary"><strong>48</strong><small>simulated robots</small><strong>3</strong><small>scripted zones</small></div>}
            </div>}
            <small>{hidden ? "Hidden by the returned relevance score" : item.text}</small>
          </div>;
        })}
      </div>
      <div className="scene-response">{chosen ? story.actions[chosen].label : "Catalogue preview · no supported layout selection yet"}</div>
      <small>Widget order follows returned scores. Preview contents are synthetic constants, not generated model output.</small>
    </div>;
  }

  if (story.visual === "navigation" && scenario.navigation) {
    const graph = scenario.navigation;
    const path = navigationProgress?.path || [graph.start];
    const position = (id: string) => {
      const i = graph.nodes.findIndex((item) => item.id === id);
      return { x: 73 + (i % 3) * 137, y: 38 + Math.floor(i / 3) * 64 };
    };
    return <div className="decision-scene navigation-scene" data-path={path.join(",")} data-outcome={navigationProgress?.status || "ready"}>
      <div className="scene-topline"><strong>Legal links · actual choices</strong><span>No hidden route planner</span></div>
      <svg viewBox="0 0 420 335" role="img" aria-label={`Model-selected path: ${path.join(" → ")}`}>
        {graph.nodes.flatMap((node) => node.links.map((id) => {
          const from = position(node.id), to = position(id);
          const used = path.some((item, i) => item === node.id && path[i + 1] === id);
          return <line key={`${node.id}-${id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`graph-edge ${used ? "visited-edge" : ""}`} />;
        }))}
        {graph.nodes.map((node) => {
          const p = position(node.id);
          return <g key={node.id} className={`graph-node ${path.includes(node.id) ? "visited-node" : ""} ${node.id === graph.target ? "target-node" : ""}`} data-node={node.id} data-visited={path.includes(node.id)}>
            <rect x={p.x - 62} y={p.y - 21} width="124" height="42" rx="12" />
            <text x={p.x} y={p.y + 3} textAnchor="middle">{node.label}</text>
          </g>;
        })}
      </svg>
      <div className="graph-path">{path.map((id, step) => <React.Fragment key={`${step}-${id}`}>{step > 0 && <span aria-hidden="true">→</span>}<strong>{graph.nodes.find((item) => item.id === id)?.label || id}</strong></React.Fragment>)}</div>
      <div className="scene-response">{navigationProgress?.status === "reached" ? "Target reached through observed model selections." : navigationProgress?.status === "review" ? navigationProgress.reason : "Only Decision-1's supported legal choices move the path. The baseline never drives it."}</div>
    </div>;
  }

  if (story.visual === "warehouse") {
    const obstructed = scenario.stages?.[index]?.facts?.Lane === "Blocked";
    const held = chosen === "hold_for_operator";
    return <div className={`decision-scene warehouse-scene ${held ? "held" : ""}`} data-action={chosen}>
      <div className="scene-topline"><strong>Northstar warehouse</strong><span>Scripted telemetry</span></div>
      <svg viewBox="0 0 420 230" role="img" aria-label={`Simulated warehouse map${held ? ", zone held for operator review" : ""}`}>
        {["A", "B", "C"].map((zone, z) => <g key={zone}><rect x={8 + z * 138} y="12" width="128" height="202" rx="14" className={`warehouse-zone ${held && z === 2 ? "zone-held" : obstructed && z === 1 ? "zone-blocked" : ""}`} /><text x={22 + z * 138} y="36">ZONE {zone}</text></g>)}
        {Array.from({ length: 48 }, (_, id) => {
          const zone = Math.floor(id / 16);
          const x = 27 + zone * 138 + (id % 4) * 27;
          const y = 62 + Math.floor((id % 16) / 4) * 36;
          return <circle key={id} cx={x} cy={y} r="5" className={held && zone === 2 ? "robot held-robot" : "robot"} />;
        })}
        {obstructed && <rect x="174" y="172" width="52" height="25" rx="4" className="crate" />}
        {chosen === "reroute_dispatch" && <path d="M160 184L160 48L256 48L256 184" className="reroute-path" />}
      </svg>
      <div className="scene-response">{held ? "Decision-1 selected operator handoff · simulation zone highlighted" : chosen === "reroute_dispatch" ? "Decision-1 selected alternate dispatch · route highlighted" : chosen === "keep_schedule" ? "Decision-1 selected the normal charging schedule" : returned ? "The application holds this uncertain suggestion for review" : "No model decision yet · map is scenario data"}</div>
      {displayFacts(scenario, index)}
    </div>;
  }

  if (story.visual === "documents") {
    const route = chosen === "payable_invoice" ? "Accounts payable" : chosen === "quote_archive" ? "Quotation archive" : chosen === "manual_review" ? "OCR review" : "Awaiting Decision-1";
    return <div className="decision-scene document-scene" data-route={chosen}>
      <div className="scene-topline"><strong>Incoming OCR record</strong><span>Original synthetic document</span></div>
      <div className="paper-document"><span className="paper-fold" aria-hidden="true" /><strong>{scenario.stages?.[index]?.facts?.Heading}</strong>{displayFacts(scenario, index)}<div className="paper-lines" aria-hidden="true"><i /><i /><i /></div></div>
      <div className="document-flow-arrow" aria-hidden="true">↓</div>
      <div className={`document-destination ${chosen === "manual_review" ? "needs-review" : ""}`}>{route}</div>
      <div className="scene-lanes">{["payable_invoice", "quote_archive", "manual_review"].map((id) => <span key={id} data-selected={chosen === id}>{story.actions[id].label}</span>)}</div>
      <small>Routing visualization only. No accounting entry or payment.</small>
    </div>;
  }

  if (story.visual === "banking" || story.visual === "healthcare") {
    const bank = story.visual === "banking";
    return <div className={`decision-scene switchboard-scene ${bank ? "banking-scene" : "care-scene"}`} data-route={chosen}>
      <div className="scene-topline"><strong>{bank ? "Bank service queues" : "Qualified service queues"}</strong><span>Sandbox routing</span></div>
      <div className="incoming-request"><span aria-hidden="true">{bank ? "↗" : "+"}</span><strong>{scenario.stages?.[index]?.title}</strong><small>Classify this request, not the previous one</small></div>
      <div className="switchboard-connector" aria-hidden="true" />
      {Object.entries(story.actions).map(([id, action], position) => <div key={id} className={`service-lane ${chosen === id ? "selected" : ""}`} data-selected={chosen === id}><span className="service-lane-number">0{position + 1}</span><div><strong>{action.label}</strong><small>{chosen === id ? "Selected by Decision-1" : "Available service route"}</small></div><span aria-hidden="true">{chosen === id ? "●" : "○"}</span></div>)}
      <small>{bank ? "No account operations occur." : "Administrative/clinical handoff only · no diagnosis or treatment advice."}</small>
    </div>;
  }

  if (story.visual === "wardrobe") {
    const rain = chosen === "rain_kit";
    const formal = chosen === "evening_formal";
    return <div className={`decision-scene wardrobe-scene ${rain ? "rain" : formal ? "formal" : ""}`} data-outfit={chosen}>
      <div className="scene-topline"><strong>Fixed wardrobe catalogue</strong><span>SVG presets, not image generation</span></div>
      <div className="wardrobe-display">
        <svg viewBox="0 0 240 240" role="img" aria-label={returned ? `Catalogue selection: ${story.actions[chosen]?.label || "review"}` : "Catalogue preview, not a model selection"}>
          <path d="M70 32L99 18L120 34L141 18L170 32L203 83L177 101L163 73L163 165L77 165L77 73L63 101L37 83Z" className="outfit-coat" />
          <path d="M99 18L120 34L141 18L129 77L111 77Z" className="outfit-shirt" />
          <path d="M78 169L162 169L155 222L129 222L120 185L111 222L85 222Z" className="outfit-trousers" />
          {formal && <path d="M120 42L125 48L123 76L117 76L115 48Z" className="outfit-tie" />}
          {rain && <path d="M87 221L111 221L111 233L79 233L79 228Z M129 221L155 221L163 228L163 233L129 233Z" className="outfit-boots" />}
        </svg>
        <span>{returned ? story.actions[chosen]?.label || "No supported outfit" : "Preview · awaiting model choice"}</span>
      </div>
      <div className="wardrobe-options">{story.items?.map((item) => <div key={item.id} data-selected={chosen === item.id}><strong>{item.label}</strong><small>{item.text}</small></div>)}</div>
      <small>The model selects an ID; the app draws that existing preset.</small>
    </div>;
  }

  if (story.visual === "brands") {
    return <div className="decision-scene brand-scene" data-match={chosen}>
      <div className="scene-topline"><strong>One event · three briefs</strong><span>Scripted news</span></div>
      <div className="brand-event-orb"><span aria-hidden="true">◎</span><strong>{scenario.stages?.[index]?.title}</strong></div>
      <div className="brand-score-list">{story.items?.map((item) => {
        const answer = answers[item.questionId!];
        return <div key={item.id} data-selected={chosen === item.id}><div><strong>{item.label}</strong><b>{answer ? answer.label : "Not scored"}</b></div><small>{item.text}</small><meter min="0" max="1" value={answer?.value || 0} aria-label={`${item.label} relevance`} /></div>;
      })}</div>
      {suggestion?.tone === "review" && <div className="no-match-badge">{suggestion.label}</div>}
    </div>;
  }
  return null;
}

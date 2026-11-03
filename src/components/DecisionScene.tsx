"use client";

import React, { useEffect, useId, useRef } from "react";
import type { RuntimeScenario } from "@/lib/demo-data";
import type { NormalizedDecision } from "@/lib/foundry";
import { storyAction, type NavigationProgress } from "@/lib/decision-story";

interface Props {
  scenario: RuntimeScenario;
  index: number;
  answers: Record<string, NormalizedDecision>;
  navigationProgress: NavigationProgress | null;
  modelName?: string;
  comparison?: boolean;
  paused?: boolean;
}

type Point = readonly [number, number];

function MotionActor({ points, active, motionKey, paused, children }: {
  points: Point[]; active: boolean; motionKey: string; paused: boolean; children: React.ReactNode;
}) {
  const ref = useRef<SVGGElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const route = points.map(([x, y]) => `translate(${x}px, ${y}px)`).join("|");

  useEffect(() => {
    const node = ref.current!;
    const frames = route.split("|");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => {
      animationRef.current?.cancel();
      animationRef.current = null;
      node.style.transform = active ? frames.at(-1)! : frames[0];
      node.dataset.motion = active ? "complete" : "waiting";
    };
    if (!active || reduced.matches) settle();
    else {
      node.dataset.motion = "moving";
      const animation = node.animate(frames.map(transform => ({ transform })), {
        duration: 1200, fill: "forwards", easing: "cubic-bezier(.25,.65,.25,1)",
      });
      animationRef.current = animation;
      if (pausedRef.current) animation.pause();
      void animation.finished.then(() => { node.dataset.motion = "complete"; }).catch(() => {});
    }
    const onPreference = () => { if (reduced.matches) settle(); };
    reduced.addEventListener("change", onPreference);
    return () => {
      reduced.removeEventListener("change", onPreference);
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, [route, active, motionKey]);

  useEffect(() => {
    const animation = animationRef.current;
    if (!animation || animation.playState === "finished") return;
    if (paused) animation.pause();
    else animation.play();
  }, [paused]);

  return <g ref={ref} className="motion-actor" data-motion="waiting" data-motion-key={motionKey} style={{ transform: `translate(${points[0][0]}px, ${points[0][1]}px)` }}>{children}</g>;
}

function TextLines({ text, x, y, width = 23, className = "" }: { text: string; x: number; y: number; width?: number; className?: string }) {
  const words = text.split(/\s+/);
  const lines: string[] = [""];
  for (const word of words) {
    if (lines.at(-1)!.length + word.length > width && lines.length < 3) lines.push("");
    lines[lines.length - 1] += `${lines.at(-1) ? " " : ""}${word}`;
  }
  return <text x={x} y={y} className={className}>{lines.map((line, index) => <tspan key={index} x={x} dy={index ? 19 : 0}>{line}</tspan>)}</text>;
}

const ticket = <><rect x="-18" y="-14" width="36" height="28" rx="7" className="actor-ticket" /><path d="M-9-4H9M-9 3H4" className="actor-detail" /></>;
const person = <><circle cx="0" cy="-13" r="10" className="person-head" /><path d="M-19 18Q-18-2 0-2Q18-2 19 18Z" className="person-body" /></>;
const robot = <><rect x="-17" y="-13" width="34" height="26" rx="9" className="actor-robot" /><rect x="-11" y="-8" width="22" height="10" rx="4" className="robot-screen" /><circle cx="-6" cy="-3" r="2" /><circle cx="6" cy="-3" r="2" /><path d="M-13 13V17M13 13V17" className="robot-wheels" /></>;
const pageIcon = <><rect x="-17" y="-23" width="34" height="46" rx="4" className="actor-paper" /><path d="M-10-12H8M-10-4H10M-10 4H6M-10 12H10" className="paper-rule" /></>;

export function DecisionScene({ scenario, index, answers, navigationProgress, modelName = "Decision-1", comparison = false, paused = false }: Props) {
  const story = scenario.story!;
  const svgId = useId().replace(/:/g, "");
  const rawChoice = String(answers.next_action?.key || "");
  const suggestion = storyAction(scenario, answers);
  let chosen = suggestion?.label === story.actions[rawChoice]?.label ? rawChoice : "";
  const returned = Boolean(answers.next_action);
  const stage = scenario.stages?.[index];
  const path = navigationProgress?.path || (scenario.navigation ? [scenario.navigation.start] : []);
  const current = navigationProgress?.lastEvaluated || scenario.navigation?.start;
  if (comparison && scenario.navigation && chosen) {
    const source = scenario.navigation.nodes.find(node => node.id === current);
    const visited = path.slice(0, Math.max(0, path.indexOf(current!)) + 1);
    if (!source?.links.includes(chosen) || visited.includes(chosen)) chosen = "";
  }
  const motionKey = `${scenario.id}:${index}:${chosen}`;
  const actor = (points: Point[], children: React.ReactNode, active = Boolean(chosen), key = motionKey) =>
    <MotionActor points={points} active={active} motionKey={key} paused={paused}>{children}</MotionActor>;
  let artwork: React.ReactNode;
  let caption = returned ? suggestion?.label || "No supported action" : "Input preview · waiting for a model response";

  if (story.visual === "warehouse") {
    const blocked = stage?.facts?.Lane === "Blocked";
    const held = chosen === "hold_for_operator";
    const route: Point[] = chosen === "reroute_dispatch" ? [[356, 306], [448, 306], [448, 87], [258, 87], [258, 322]]
      : held ? [[575, 228], [575, 228]] : chosen === "keep_schedule" ? [[135, 177], [72, 177], [72, 322]]
      : [index === 1 ? [356, 306] : index === 2 ? [575, 228] : [135, 177]];
    artwork = <>
      {[0, 1, 2].map(zone => <g key={zone}>
        <rect x={25 + zone * 224} y="36" width="210" height="330" rx="22" className={`warehouse-zone ${held && zone === 2 ? "zone-held" : blocked && zone === 1 ? "zone-blocked" : ""}`} />
        <text x={43 + zone * 224} y="65" className="scene-heading">ZONE {["A", "B", "C"][zone]}</text>
        {[0, 1, 2].map(row => <g key={row}>{[0, 1].map(column => <rect key={column} x={45 + zone * 224 + column * 100} y={102 + row * 67} width="75" height="38" rx="5" className="warehouse-rack" />)}</g>)}
        {Array.from({ length: 16 }, (_, id) => zone === Math.min(index, 2) && id === 8 ? null : <circle key={id} cx={43 + zone * 224 + (id % 4) * 49} cy={154 + Math.floor(id / 4) * 45} r="4" className={`fleet-dot ${held && zone === 2 ? "held-robot" : ""}`} />)}
        <text x={44 + zone * 224} y="350" className="scene-small">16 simulated robots</text>
      </g>)}
      <rect x="49" y="310" width="48" height="26" rx="5" className="charger" /><path d="M72 314L65 325H73L69 332" className="actor-detail" />
      {blocked && <g><rect x="335" y="205" width="50" height="34" rx="5" className="crate" /><path d="M340 210L380 234M380 210L340 234" className="crate-mark" /></g>}
      {chosen && !held && <polyline points={route.map(point => point.join(",")).join(" ")} className="selected-route" />}
      {held && <g className="safety-gate"><rect x="507" y="299" width="135" height="29" rx="8" /><text x="519" y="319">OPERATOR HOLD</text></g>}
      {actor(route, <>{robot}<text x="-17" y="-24" className="scene-small">{index === 0 ? "R-08" : "Dispatch"}</text></>)}
      <text x="265" y="388" className="scene-small">A route suggestion, never a physical dispatch</text>
    </>;
  } else if (story.visual === "banking" || story.visual === "healthcare") {
    const bank = story.visual === "banking";
    const routes = Object.entries(story.actions);
    const selected = routes.findIndex(([id]) => id === chosen);
    const targetY = 91 + Math.max(0, selected) * 116;
    artwork = <>
      <rect x="28" y="116" width="186" height="168" rx="24" className="intake-panel" />
      <g transform="translate(120 167)">{person}</g>
      <TextLines text={stage?.title || "Incoming request"} x={49} y={220} width={21} className="scene-heading" />
      <text x="50" y="266" className="scene-small">{bank ? "Customer request" : "Service call · not a diagnosis"}</text>
      {routes.map(([id, action], position) => <g key={id} className={chosen === id ? "route-selected" : ""}>
        <path d={`M220 200H335V${91 + position * 116}H474`} className={chosen === id ? "selected-route" : "available-route"} />
        <rect x="475" y={43 + position * 116} width="218" height="98" rx="17" className="service-desk" />
        <g transform={`translate(504 ${67 + position * 116})`}>{bank ? <path d="M-10 6V-3L0-10L10-3V6M-5 6V-2M5 6V-2" className="service-icon" /> : <path d="M-8 0H8M0-8V8" className="service-icon" />}</g>
        <TextLines text={action.label} x={493} y={position * 116 + 98} width={23} className="scene-heading" />
      </g>)}
      {actor([[245, 200], [335, 200], [335, targetY], [457, targetY]], ticket)}
      <text x="258" y="363" className="scene-small">{returned && !chosen ? "Held at intake for human review" : "The returned route moves the request"}</text>
    </>;
  } else if (story.visual === "documents") {
    const routes = Object.entries(story.actions);
    const selected = routes.findIndex(([id]) => id === chosen);
    const targetY = 81 + Math.max(0, selected) * 119;
    artwork = <>
      <rect x="41" y="76" width="161" height="250" rx="9" className="document-sheet" /><path d="M170 76V106H202" className="paper-rule" />
      <TextLines text={stage?.facts?.Heading || "Incoming OCR"} x={56} y={128} width={17} className="scene-heading" />
      {[0, 1, 2, 3, 4].map(row => <path key={row} d={`M58 ${185 + row * 23}H${row % 2 ? 150 : 180}`} className="paper-rule" />)}
      <rect x="279" y="76" width="107" height="250" rx="19" className="scanner-body" />
      <rect x="294" y="98" width="77" height="170" rx="10" className="scanner-window" />
      <path d="M295 115H370" className="ocr-scan" /><text x="305" y="301" className="scene-heading">OCR</text>
      {routes.map(([id, action], position) => <g key={id} className={chosen === id ? "route-selected" : ""}>
        <path d={`M391 201H452V${81 + position * 119}H502`} className={chosen === id ? "selected-route" : "available-route"} />
        <rect x="505" y={34 + position * 119} width="184" height="94" rx="15" className="service-desk" />
        <TextLines text={action.label} x={520} y={66 + position * 119} width={19} className="scene-heading" />
      </g>)}
      {actor([[220, 201], [333, 201], [452, 201], [452, targetY], [488, targetY]], pageIcon)}
      <text x="51" y="364" className="scene-small">Synthetic OCR input → typed decision → suggested document tray</text>
    </>;
  } else if (story.visual === "wardrobe") {
    const rain = chosen === "rain_kit";
    const formal = chosen === "evening_formal";
    artwork = <>
      <rect x="238" y="25" width="255" height="348" rx="120" className="fitting-room" /><ellipse cx="365" cy="360" rx="92" ry="12" className="scene-shadow" />
      <circle cx="365" cy="79" r="24" className="mannequin" /><path d="M351 105L320 122L294 211L316 220L333 164V251H398V164L415 220L437 211L411 122L379 105Z M338 257H392L387 338H370L365 290L360 338H343Z" className="mannequin" />
      <path d="M45 92H181M57 92V330M170 92V330M44 330H184" className="clothes-rail" />
      {[0, 1, 2].map(item => <path key={item} d={`M${72 + item * 39} 95q-7-16 4-16q9 0 4 10l-18 23h36l-18-23`} className="hanger" />)}
      {story.items?.map((item, position) => <g key={item.id} className={chosen === item.id ? "route-selected" : ""}>
        <rect x="532" y={42 + position * 111} width="157" height="91" rx="17" className="service-desk" />
        <TextLines text={item.label} x={547} y={78 + position * 111} width={17} className="scene-heading" />
      </g>)}
      {actor([[113, 165], [365, 164]], <>
        <path d="M-47-44L-18-57L0-40L18-57L47-44L72 23L50 34L34-8V82H-34V-8L-50 34L-72 23Z" className={`animated-coat ${rain ? "rain-coat" : formal ? "formal-coat" : ""}`} />
        <path d="M-18-57L0-40L18-57L8-6H-8Z" className="outfit-shirt" />
        <path d="M-33 86H33L28 169H9L0 113L-9 169H-28Z" className="outfit-trousers" />
        {formal && <path d="M0-30L5-24L3 1H-3L-5-24Z" className="outfit-tie" />}
        {rain && <path d="M-28 166H-9V182H-39V175Z M9 166H28L39 175V182H9Z" className="outfit-boots" />}
      </>)}
      <text x="43" y="361" className="scene-small">{index === 1 ? "Cool rain · outdoors" : index === 2 ? "Formal evening · indoors" : "Mild, dry commute"}</text>
    </>;
  } else if (story.visual === "brands") {
    const selected = story.items?.findIndex(item => item.id === chosen) ?? -1;
    const unmatched = returned && !chosen || chosen === "no_match";
    const destination: Point = unmatched ? [337, 318] : [442, 80 + Math.max(0, selected) * 119];
    artwork = <>
      <rect x="30" y="118" width="175" height="167" rx="19" className="news-sheet" />
      <text x="48" y="149" className="scene-small">FICTIONAL BULLETIN</text>
      <TextLines text={stage?.title || "Current event"} x={48} y={181} width={19} className="scene-heading" />
      <path d="M48 237H179M48 251H153M48 265H171" className="paper-rule" />
      {story.items?.map((item, position) => {
        const answer = answers[item.questionId!];
        return <g key={item.id} className={chosen === item.id ? "route-selected" : ""}>
          <path d={`M220 199H337V${80 + position * 119}H453`} className={chosen === item.id ? "selected-route" : "available-route"} />
          <rect x="456" y={29 + position * 119} width="233" height="105" rx="17" className="service-desk" />
          <text x="473" y={57 + position * 119} className="scene-heading">{item.label}</text>
          <text x="473" y={80 + position * 119} className="scene-small">{answer?.label || "Not scored"}</text>
          <rect x="473" y={95 + position * 119} width="195" height="7" rx="4" className="score-track" />
          <rect x="473" y={95 + position * 119} width={195 * (answer?.value || 0)} height="7" rx="4" className="score-fill" />
        </g>;
      })}
      {unmatched && <g className="review-tray"><rect x="263" y="289" width="149" height="58" rx="14" /><text x="277" y="326" className="scene-heading">No forced match</text></g>}
      {actor([[221, 199], [337, 199], [337, destination[1]], destination], pageIcon, returned)}
    </>;
  } else if (story.visual === "adaptive") {
    const ordered = [...(story.items || [])].sort((a, b) => (answers[b.questionId!]?.value || 0) - (answers[a.questionId!]?.value || 0));
    artwork = <>
      <rect x="24" y="27" width="672" height="346" rx="20" className="workspace-window" /><path d="M24 65H696" className="paper-rule" />
      {[0, 1, 2].map(dot => <circle key={dot} cx={43 + dot * 16} cy="46" r="4" className="window-dot" />)}
      <text x="513" y="50" className="scene-small">Approved widget catalogue</text>
      {ordered.map((item, position) => {
        const answer = answers[item.questionId!];
        const primary = answer?.key === 2;
        const hidden = answer?.key === 0;
        const selected = Boolean(chosen);
        const x = selected ? position === 0 ? 40 : 478 : 40 + position * 218;
        const y = selected && position > 0 ? 82 + (position - 1) * 139 : 82;
        const width = selected && position === 0 ? 420 : 201;
        const height = selected ? position === 0 ? 273 : 125 : 273;
        return <g key={item.id} className={`widget-motion ${primary ? "primary-widget" : ""} ${hidden ? "hidden-widget" : ""}`} data-widget={item.id} data-relevance={answer?.label || "pending"} style={{ transform: `translate(${x}px, ${y}px)` }}>
          <rect width={width} height={height} rx="14" className="widget-panel" style={{ width, height }} />
          <text x="14" y="26" className="scene-heading">{item.label}</text>
          <text x="14" y="49" className="scene-small">{answer?.label || "Preview · not ranked"}</text>
          {!hidden && (item.id === "map" ? <g>{[0, 1, 2].map(zone => <g key={zone}><rect x={14 + zone * (width - 37) / 3} y="66" width={(width - 46) / 3} height={height - 83} rx="8" className="mini-warehouse-zone" /><text x={27 + zone * (width - 37) / 3} y="92" className="scene-heading">{["A", "B", "C"][zone]}</text></g>)}</g>
            : item.id === "review" ? <g>{Array.from({ length: height > 150 ? 4 : 1 }, (_, row) => <g key={row}><rect x="13" y={65 + row * 44} width={width - 26} height="34" rx="7" className="inbox-row" /><text x="23" y={87 + row * 44} className="scene-small">{row ? "Recipient check · pending" : "Refund approval · DEMO-1042"}</text></g>)}</g>
            : <g>{[0, 1, 2, 3, 4].map(bar => <rect key={bar} x={16 + bar * (width - 28) / 5} y={height - 20 - (bar + 1) * (height > 150 ? 28 : 7)} width={(width - 60) / 5} height={(bar + 1) * (height > 150 ? 28 : 7)} rx="5" className="summary-bar" />)}</g>)}
          {hidden && <text x="14" y="88" className="scene-small">Excluded by returned score</text>}
        </g>;
      })}
    </>;
  } else if (story.visual === "navigation" && scenario.navigation) {
    const graph = scenario.navigation;
    const position = (id: string): Point => {
      const item = graph.nodes.findIndex(node => node.id === id);
      return [104 + item % 4 * 170, 64 + Math.floor(item / 4) * 89];
    };
    const sourceId = comparison ? current! : path.at(-2) || graph.start;
    const targetId = comparison ? chosen || current! : path.at(-1)!;
    const actualMove = comparison ? Boolean(chosen) : Boolean(navigationProgress?.appliedChoice);
    artwork = <>
      <defs><marker id={`${svgId}-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" className="graph-arrow" /></marker></defs>
      {graph.nodes.flatMap(node => node.links.map(id => {
        const from = position(node.id), to = position(id);
        const used = comparison ? node.id === current && id === chosen : path.some((step, offset) => step === node.id && path[offset + 1] === id);
        return <path key={`${node.id}-${id}`} d={`M${from.join(" ")}L${to.join(" ")}`} className={used ? "selected-route" : "available-route"} markerEnd={used ? `url(#${svgId}-arrow)` : undefined} />;
      }))}
      {graph.nodes.map(node => {
        const [x, y] = position(node.id);
        const visited = comparison ? node.id === current || node.id === chosen : path.includes(node.id);
        return <g key={node.id} transform={`translate(${x - 73} ${y - 26})`} className={`topic-node ${visited ? "visited-node" : ""} ${node.id === graph.target ? "target-node" : ""}`} data-node={node.id} data-visited={visited}>
          <rect width="146" height="53" rx="12" />
          <TextLines text={node.label} x={11} y={23} width={17} className="scene-heading" />
        </g>;
      })}
      {actor([position(sourceId), position(targetId)], <><circle r="12" className="graph-traveler" /><circle r="4" className="traveler-center" /></>, actualMove, `${motionKey}:${sourceId}:${targetId}`)}
      <text x="224" y="365" className="scene-small">{comparison ? "One proposed edge from the shared current state" : "Observed legal moves · no hidden route planner"}</text>
    </>;
    caption = comparison ? returned ? chosen ? `Proposed link: ${graph.nodes.find(node => node.id === chosen)?.label}` : "Stop for guidance · no supported legal move" : "Waiting for a link selection"
      : navigationProgress?.status === "reached" ? `Reached ${graph.nodes.find(node => node.id === graph.target)?.label}` : navigationProgress?.status === "review" ? "Stop for guidance" : path.map(id => graph.nodes.find(node => node.id === id)?.label).join(" → ");
  } else {
    const allowed = chosen === "allow_original_refund";
    artwork = <>
      <rect x="40" y="133" width="178" height="137" rx="21" className="intake-panel" /><text x="61" y="178" className="scene-heading">Refund request</text><text x="61" y="205" className="scene-small">Original authorization</text>
      <path d="M223 199H494" className={allowed ? "selected-route" : "available-route"} />
      <path d="M357 115L407 137V186Q407 235 357 261Q307 235 307 186V137Z" className="policy-shield" />
      <path d={allowed ? "M333 185L352 204L384 160" : "M339 162L376 201M376 162L339 201"} className="shield-symbol" />
      <rect x="500" y="139" width="173" height="119" rx="19" className="service-desk" /><text x="517" y="188" className="scene-heading">Original card</text><text x="517" y="214" className="scene-small">Sandbox suggestion only</text>
      {actor([[238, 199], [357, 199], [allowed ? 480 : 357, 199]], ticket)}
    </>;
  }

  return <div className={`decision-scene animated-scene ${story.visual === "banking" ? "banking" : story.visual === "healthcare" ? "care" : story.visual === "documents" ? "document" : story.visual === "brands" ? "brand" : story.visual}-scene`} data-model={modelName} data-choice={chosen} data-checkpoint={index} data-paused={paused} data-action={story.visual === "warehouse" ? chosen : undefined} data-layout={story.visual === "adaptive" ? chosen : undefined} data-route={["banking", "healthcare", "documents"].includes(story.visual!) ? chosen : undefined} data-outfit={story.visual === "wardrobe" ? chosen : undefined} data-match={story.visual === "brands" ? chosen : undefined} data-path={story.visual === "navigation" ? path.join(",") : undefined}>
    <svg viewBox="0 0 720 400" role="img" aria-label={`${story.title}: ${caption}`} className="business-stage">
      <defs><pattern id={`${svgId}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" className="stage-grid" /></pattern></defs>
      <rect width="720" height="400" rx="20" className="stage-floor" /><rect width="720" height="400" rx="20" fill={`url(#${svgId}-grid)`} />
      {artwork}
    </svg>
    <div className="scene-caption" aria-live="polite"><span className={`scene-result-dot ${returned ? "returned" : ""}`} /><strong>{caption}</strong><span>{returned ? "Driven by returned decisions" : "No action applied yet"}</span></div>
  </div>;
}

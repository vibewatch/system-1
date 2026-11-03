"use client";

import { Dialog } from "./Dialog";
import { CustomSelect } from "./CustomSelect";
import type { ReplayBundle, ReplayProgress } from "@/lib/replay";
import { IconButton } from "./IconButton";
import { Download, Pause, Play, Square, X } from "lucide-react";

export function ReplayControls({
  open, onClose, bundle, enabled, loading, error, progress, speed,
  onEnable, onLoadDefault, onImport, onPause, onResume, onStop, onSpeed,
}: {
  open: boolean;
  onClose: () => void;
  bundle: ReplayBundle | null;
  enabled: boolean;
  loading: boolean;
  error: string;
  progress: ReplayProgress | null;
  speed: number;
  onEnable: (enabled: boolean) => void;
  onLoadDefault: () => void;
  onImport: (file: File) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSpeed: (speed: number) => void;
}) {
  const download = () => {
    if (!bundle) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "system-1-demo-replay.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const seconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`;

  return <Dialog open={open} onClose={onClose} title="Demo replay" maxWidth={700}>
    <div className="modal-head"><h2>Demo replay</h2><IconButton label="Close replay options" icon={<X size={18} />} onClick={onClose} /></div>
    <div className="modal-body replay-settings">
      <p>Recorded Azure results, replayed in the same interface. No model calls or sign-in are needed. Timings, probabilities and costs come from the original run, not a new benchmark.</p>
      {error && <p role="alert" className="comparison-error">{error}</p>}
      {bundle ? <div className="replay-file-summary">
        <strong>{bundle.scenarios.length} solutions · {bundle.recordings.length} recordings</strong>
        <span>Recorded {new Date(bundle.recordedAt).toLocaleString()}</span>
        <span>{bundle.models.decision1} vs {bundle.models.terra}</span>
        <span>{bundle.recordings.filter((recording) => recording.action === "run_compare").length} test cases · {bundle.recordings.filter((recording) => recording.action === "start_runtime").length} conversations · {bundle.recordings.filter((recording) => recording.action === "start_triage").length} triage rates · claims workflow</span>
      </div> : <p>{loading ? "Loading the recorded showcase…" : "Load the included showcase or import a recording file."}</p>}
      <div className="replay-file-actions">
        <button className="ghost" disabled={loading} onClick={onLoadDefault}>{loading ? "Loading…" : "Load included recordings"}</button>
        <label className="replay-import">Import JSON<input type="file" accept=".json,application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = "";
        }} /></label>
        {bundle && <IconButton label="Download replay file" icon={<Download size={16} />} tag="JSON" onClick={download} />}
      </div>
      <CustomSelect label="Playback speed" minWidth={0} value={speed} onChange={(value) => onSpeed(Number(value))} searchable={false} options={[
        { value: 0.5, label: "0.5× · Slow walkthrough" },
        { value: 1, label: "1× · Original event timing" },
        { value: 2, label: "2× · Quick demo" },
        { value: 4, label: "4× · Fast overview" },
      ]} />
      {progress && <div className="replay-file-summary" role="status">
        <strong>{progress.label}</strong>
        <span>{seconds(progress.elapsedMs)} / {seconds(progress.durationMs)} · {progress.playing ? progress.paused ? "Paused" : "Playing" : "Complete"}</span>
        <progress max={progress.durationMs || 1} value={progress.elapsedMs} />
        {progress.playing && <div className="replay-file-actions"><IconButton label={progress.paused ? "Resume replay" : "Pause replay"} icon={progress.paused ? <Play size={16} /> : <Pause size={16} />} tag={progress.paused ? "Resume" : "Pause"} onClick={progress.paused ? onResume : onPause} /><IconButton label="Stop replay" icon={<Square size={16} />} tag="Stop" onClick={onStop} /></div>}
      </div>}
      <p className="detail-note">Use the normal Compare, Stream, Triage and Claims buttons after enabling replay. Unrecorded inputs and custom questions are rejected rather than given invented results. Imported files stay in this tab; reloading restores the included recordings. Downloaded files include demo inputs and outputs; review any custom data before sharing.</p>
      <button className="primary" disabled={!enabled && (!bundle || loading)} onClick={() => { onEnable(!enabled); onClose(); }}>{enabled ? "Return to live mode" : "Use recorded demos"} &rarr;</button>
    </div>
  </Dialog>;
}

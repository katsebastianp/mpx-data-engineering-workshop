"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Upload, RefreshCw, X, ArrowRight } from "lucide-react";
import { ChapterIntro, Prompt } from "./WorkshopApp";
import type { useParticipantProgress } from "./useParticipantProgress";
import { personaliseWorkshopText } from "../lib/participant";
import type { LeaderboardResponse, LeaderboardEntry, RankedEntry } from "../lib/competition";

const format = (value: number | undefined, decimals = 3) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(decimals) : "—";
const finalPrompt = [
  "- On {{branch}}, confirm both reviewed PRs are integrated and the single trained model was selected on validation.",
  "- Keep the frozen features, parameters, seed, explanation and team: {{participantId}} in config/experiments.yaml.",
  "- Reuse an existing final result. Otherwise set evaluation: test and run predict then postprocessing once with Compose project {{composePrefix}}-integration and no competing heavy jobs.",
  "- Validate the generated data/04_submissions/ JSON against config/evaluation.json with the trusted postprocessing.leaderboard collector. Check complete IDs and the fixed timing protocol.",
  "- Show the exact file under 1 MB and a concise result summary. I will upload it here under my signed-in account.",
  "- Preserve the final model and measurements. Do not tune from test results or submit a leaderboard PR to main.",
].join("\n");
type Props = { participant: ReturnType<typeof useParticipantProgress> };
type PendingUpload = { name: string; text: string; model: string; subject: string };
type AwardTab = "quality" | "efficiency" | "references";

export function Leaderboard({ participant }: Props) {
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<AwardTab>("quality");
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0);
  const fileReadNumber = useRef(0);
  const pickerSubject = useRef<string | null>(null);
  const workspace = participant.status === "authenticated" ? participant.workspace : null;
  const subject = participant.status === "authenticated" ? participant.account?.subject ?? null : null;
  // A focus refresh temporarily sets status=loading. Preserve the selected file
  // for that same account, but keep it hidden and disable upload until verified.
  const knownSubject = participant.account?.subject ?? null;
  const currentSubject = useRef(knownSubject);
  currentSubject.current = knownSubject;
  const uploadReady = !!subject && !!workspace && board?.authenticated === true && board.participant?.id === workspace.id;
  const currentPending = pending?.subject === subject && uploadReady ? pending : null;

  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    try {
      const response = await fetch("/api/leaderboard", { cache: "no-store", credentials: "same-origin" });
      const data = await response.json() as LeaderboardResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load the leaderboard");
      if (request !== requestNumber.current) return;
      setBoard(data);
      setError("");
      setUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (cause) {
      if (request !== requestNumber.current) return;
      console.warn("Leaderboard refresh failed", cause);
      setBoard(null);
      setError(cause instanceof Error ? cause.message : "Could not load the leaderboard");
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPending(null);
    setNotice("");
    ++fileReadNumber.current;
    void load();
    const onFocus = () => { void load(); };
    const interval = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    window.addEventListener("focus", onFocus);
    return () => { ++requestNumber.current; clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [load, knownSubject]);

  async function selectFile(chosen: File | undefined, selectedSubject: string | null) {
    if (!chosen || !selectedSubject || selectedSubject !== knownSubject || busy) return;
    const read = ++fileReadNumber.current;
    setNotice(""); setError(""); setPending(null);
    try {
      if (chosen.size > (board?.max_upload_bytes || 1_000_000)) throw new Error("Choose the generated submission JSON under 1 MB");
      if (!chosen.name.toLowerCase().endsWith(".json")) throw new Error("Choose a .json file from data/04_submissions/");
      const text = await chosen.text();
      const json = JSON.parse(text);
      if (!json || typeof json !== "object" || typeof json.model !== "string" || !Array.isArray(json.predictions)) throw new Error("Use the generated workshop submission from data/04_submissions/");
      if (read === fileReadNumber.current && currentSubject.current === selectedSubject) setPending({ name: chosen.name, text, model: json.model, subject: selectedSubject });
    } catch (cause) {
      if (read === fileReadNumber.current) setError(cause instanceof Error ? cause.message : "Could not read this file");
    } finally { if (file.current) file.current.value = ""; }
  }

  async function submit() {
    if (!currentPending || !subject || busy) return;
    const upload = currentPending;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/leaderboard", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Workshop-Account": upload.subject },
        body: upload.text,
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        if ([401, 403, 409].includes(response.status)) {
          setPending(null);
          void participant.refresh();
          void load();
        }
        throw new Error(result.error || "The submission was not accepted");
      }
      if (currentSubject.current !== upload.subject) return;
      setNotice("Your result is saved. Quality metrics were recomputed against the fixed evaluation data.");
      setPending(null);
      await load();
    } catch (cause) {
      console.warn("Submission failed", cause);
      if (currentSubject.current === upload.subject) setError(cause instanceof Error ? cause.message : "Upload failed. Please try again");
    } finally { setBusy(false); }
  }

  const entries = board?.awards[tab] || [];
  const isSelected = (entry: LeaderboardEntry) => selected?.participant.id === entry.participant.id && selected?.run_id === entry.run_id;
  return <div>
    <ChapterIntro number="04" eyebrow="THE LEADERBOARD" title="Participant leaderboard" description="Compare final results across two awards: predictive quality and inference efficiency"/>
    <section className="section-wrap board-section">
      <div className="upload-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (uploadReady) void selectFile(event.dataTransfer.files[0], subject); }}>
        <div className="upload-left"><span className="upload-icon"><Upload size={21}/></span><div><h3>Submit your result</h3><p>Upload the generated JSON from <code>data/04_submissions/</code>. Your signed-in account identifies your submission automatically. Include predictions, timings, and your explanation.</p></div></div>
        {participant.status === "anonymous"
          ? <a className="secondary-button" href="/signin-with-chatgpt?return_to=/leaderboard" target="_top">Sign in to upload <ArrowUpRight size={14}/></a>
          : <button className="primary-button" onClick={() => { pickerSubject.current = subject; file.current?.click(); }} disabled={!uploadReady || busy}>{uploadReady ? "Choose results file" : "Checking your account"} <Upload size={14}/></button>}
        <input ref={file} className="file-input" type="file" accept="application/json,.json" aria-label="Choose workshop results JSON" disabled={!knownSubject || busy} onChange={event => { void selectFile(event.target.files?.[0], pickerSubject.current); }}/>
      </div>
      {uploadReady && <p className="board-note">Submitting as <strong>{board?.participant?.displayName}</strong>{board?.own_entry ? " · A new upload replaces your previous result" : " · One result per participant"} · Your name and explanation appear on the leaderboard</p>}
      {participant.status === "error" && <p className="message error">Your account could not be verified. <button className="text-link" onClick={() => participant.refresh()}>Retry account</button></p>}
      {currentPending && <div className="submission-detail"><div className="detail-head"><h3>Review your submission</h3><button className="icon-button" onClick={() => setPending(null)} aria-label="Cancel upload" disabled={busy}><X size={15}/></button></div><p><strong>{board?.participant?.displayName}</strong> · {currentPending.model} · {currentPending.name}</p><p>The server checks the dataset, evaluation IDs, scores, and timing protocol, then recomputes quality. The result is attached to your account.</p><button className="primary-button" style={{ marginTop: 20 }} onClick={submit} disabled={busy}>{busy ? "Validating…" : "Submit my result"} <ArrowRight size={14}/></button></div>}
      {error && <div role="alert" className="message error">{error}</div>}
      {notice && <div role="status" className="message success">{notice}</div>}
      <div className="board-toolbar"><div className="segmented" aria-label="Leaderboard award">{(["quality", "efficiency", "references"] as const).map(award => <button key={award} aria-pressed={tab === award} onClick={() => { setTab(award); setSelected(null); }}>{award === "quality" ? "Best quality" : award === "efficiency" ? "Best efficiency" : "Sophon reference"}</button>)}</div><button className="board-refresh" onClick={() => { setLoading(true); void load(); }} disabled={loading}><RefreshCw size={12} className={loading ? "spinning" : ""}/>{loading ? "LOADING" : updated ? "UPDATED " + updated : "REFRESH"}</button></div>
      {loading && <div className="loading-line"/>}
      {entries.length ? <div className="table-wrap"><table><thead><tr><th>RANK</th><th>PARTICIPANT / MODEL</th><th>TEST AUC ↑</th><th>NORMALISED TIME ↓</th><th>INFERENCE / JET</th><th>TRAINING</th><th>APPROACH</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={entry.participant.id + entry.run_id}><td>{tab === "references" ? "REF" : String((entry as RankedEntry).rank || index + 1).padStart(2, "0")}</td><td><span className="team-name">{entry.participant.displayName}</span><small>{entry.model === "logistic" ? "Logistic regression" : entry.model === "xgboost" ? "XGBoost" : "Sophon"} · {entry.feature_set}</small></td><td className="metric">{format(entry.metrics.test?.roc_auc ?? undefined, 4)}</td><td className="metric">{format(entry.timings.normalized_inference_time, 5)}</td><td className="metric">{format(entry.timings.per_jet_ms, 4)} ms</td><td className="metric">{format(entry.timings.training_seconds, 2)} s</td><td><button className="text-link" onClick={() => setSelected(isSelected(entry) ? null : entry)} aria-expanded={isSelected(entry)}>Read <ArrowUpRight size={13}/></button></td></tr>)}</tbody></table></div>
        : <div className="empty-board"><div className="empty-orbit" aria-hidden="true"/><span className="section-kicker">{loading ? "CONNECTING TO THE BOARD" : tab === "references" ? "FROZEN MODEL REFERENCE" : "PARTICIPANT RESULTS"}</span><h3>{tab === "references" ? "No reference submitted yet" : tab === "efficiency" ? "No eligible efficiency result yet" : "No results yet"}</h3><p>{tab === "references" ? "A supplied Sophon result appears here for comparison. It is excluded from participant awards." : tab === "efficiency" ? "Final trained models within 0.02 AUC of the best qualify. Lower normalised inference time wins." : "Choose your model on validation, run the final test, and upload your generated results file."}</p></div>}
      <p className="board-note">{tab === "quality" ? "Ranked by final test ROC-AUC. Higher is better." : tab === "efficiency" ? "Only trained models within 0.02 AUC of the best result qualify." + (board?.awards.best_test_auc != null ? " Current cutoff: " + format(board.awards.best_test_auc - .02, 4) + " AUC." : "") : "Sophon uses richer particle inputs and prior training. It is a reference, excluded from the two awards."} Timings are self-reported; CPU normalisation is an approximate hardware adjustment.</p>
      {selected && <div className="submission-detail"><div className="detail-head"><h3>{selected.participant.displayName} / model details</h3><button className="icon-button" aria-label="Close approach" onClick={() => setSelected(null)}><X size={15}/></button></div><p>{selected.explanation}</p><div className="detail-metrics"><span>Accuracy <strong>{format(selected.metrics.test?.accuracy)}</strong></span><span>F1 <strong>{format(selected.metrics.test?.f1)}</strong></span><span>Signal retention <strong>{format(selected.metrics.test?.signal_retention ?? undefined)}</strong></span><span>Background rejection <strong>{format(selected.metrics.test?.background_rejection ?? undefined)}</strong></span></div><p><strong>Features:</strong> {selected.feature_names.join(", ")}</p><p><strong>Parameters:</strong> {Object.entries(selected.parameters).map(([key, value]) => key + "=" + value).join(" · ") || "Frozen reference"} · seed {selected.seed}</p>{!selected.reported_metrics_match && <p className="accent">Uploaded metric claims differed from the recomputed results. The board uses the recomputed values.</p>}</div>}
      {board && board.awards.quality.length > 1 && <div className="board-chart"><h3>Test ROC-AUC by participant</h3><p className="board-note">Test ROC-AUC · 0 = inverse ranking · 0.5 = random · 1 = perfect ranking</p>{board.awards.quality.map(entry => <div className="chart-row" key={entry.participant.id}><span>{entry.participant.displayName}</span><span className="chart-track"><i style={{ width: (entry.test_auc * 100) + "%" }}/></span><span className="mono">{format(entry.test_auc)}</span></div>)}</div>}
      <div className="rules-grid"><article><span className="rule-number">01 / QUALITY</span><h3>Best predictive quality</h3><p>Highest final test ROC-AUC among participant-trained models. Choose the model using validation first. The test set is for your final evaluation.</p></article><article><span className="rule-number">02 / EFFICIENCY</span><h3>Best inference efficiency</h3><p>Lowest normalised inference time among trained models within 0.02 AUC of the best. Quality and efficiency are ranked separately.</p></article><article><span className="rule-number">03 / FAIR COMPARISON</span><h3>How timings are compared</h3><p>128 jets, one thread, three timed repeats after warmup. Normalised time = (inference seconds / 128) ÷ (CPU reference seconds / 64). We check predictions; we do not rerun your model.</p></article></div>
      {workspace && <Prompt title="Reveal the final submission prompt">{personaliseWorkshopText(finalPrompt, workspace, participant.repository || null)}</Prompt>}
    </section>
  </div>;
}

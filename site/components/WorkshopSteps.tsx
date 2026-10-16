"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import { ChapterIntro, Prompt } from "./WorkshopApp";
import { coreWorkshopExercises, workshopExercises, WORKSHOP_SOURCE_URL, SOPHON_PAPER_URL } from "./workshop-content";
import type { useParticipantProgress } from "./useParticipantProgress";
import { ParticipantAccountPanel } from "./ParticipantAccount";
import { WorktreeJourney } from "./WorktreeJourney";
import { SampleDownloads } from "./SampleDownloads";
import { NextStepsFlow, PipelineVisual, WorktreeVisual } from "./LearningVisuals";
import { personaliseWorkshopText } from "../lib/participant";

const exerciseIds = new Set(workshopExercises.map(exercise => exercise.id));
const firstStep = workshopExercises[0].id;
const previews: Record<string, string> = {
  runName: "your-run-name",
  branch: "your-name",
  integrationBranch: "your-name",
  pipelineBranch: "your-name-pipeline_optimization",
  modelsBranch: "your-name-predictive_models",
  participantId: "your participant ID",
  composePrefix: "your-compose-project",
  repositoryUrl: "the facilitator’s repository URL",
};

export function WorkshopSteps({ participant }: { participant: ReturnType<typeof useParticipantProgress> }) {
  const completed = participant.status === "authenticated" ? participant.completed : [];
  const workspace = participant.status === "authenticated" ? participant.workspace : null;
  const canSave = participant.status === "authenticated" && !participant.saving;
  const [selectedId, setSelectedId] = useState(firstStep);
  const panel = useRef<HTMLElement>(null);
  const selected = workshopExercises.find(exercise => exercise.id === selectedId) ?? workshopExercises[0];
  // The repository is supplied directly in Codex; no extra Site setting is needed.
  const personalise = (value: string) => workspace
    ? personaliseWorkshopText(value, workspace, null)
    : value.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => previews[key] || "available after sign-in");
  const done = completed.includes(selected.id);
  const total = coreWorkshopExercises.length;
  const completedCore = coreWorkshopExercises.filter(exercise => completed.includes(exercise.id)).length;

  useEffect(() => {
    const readStep = () => {
      const id = new URLSearchParams(window.location.search).get("step");
      setSelectedId(id && exerciseIds.has(id) ? id : firstStep);
    };
    readStep();
    window.addEventListener("popstate", readStep);
    return () => window.removeEventListener("popstate", readStep);
  }, []);

  function selectStep(id: string) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("step", id);
    history.replaceState({}, "", url.pathname + url.search);
    requestAnimationFrame(() => {
      if (!panel.current) return;
      panel.current.scrollTop = 0;
      if (window.matchMedia("(max-width: 980px)").matches) {
        panel.current.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
          block: "start",
        });
        panel.current.focus({ preventScroll: true });
      }
    });
  }

  async function toggleComplete() {
    if (canSave) await participant.setStepComplete(selected.id, !done);
  }

  return <div className="workshop-tree-page">
    <ChapterIntro number="03" eyebrow="WORKSHOP" title="Workshop instructions" description={`${total} steps · 2-hour target with the image built`} />
    <ParticipantAccountPanel participant={participant} />

    <div className="worktree-progress-bar section-wrap">
      <div><strong>{completedCore}<span> / {total}</span></strong><span> core steps complete</span></div>
      <div className="worktree-total-progress" role="progressbar" aria-label="Completed core workshop steps" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completedCore}>
        <span style={{ width: `${completedCore / total * 100}%` }} />
      </div>
      <p aria-live="polite">{participant.saving ? "Saving…" : participant.status === "authenticated" ? "Your checklist · saved to your account" : "Sign in to save your progress"}</p>
    </div>

    <div className="worktree-workspace section-wrap">
      <div id="worktree-journey" className="worktree-map-column">
        <WorktreeJourney completed={completed} selectedId={selected.id} onSelect={selectStep} />
      </div>
      <aside id="workshop-step-details" ref={panel} className={`step-detail-panel lane-${selected.location}`} aria-labelledby="selected-step-title" tabIndex={-1}>
        {selected.time && <span className="step-time">{selected.optional ? "OPTIONAL · " : ""}{selected.time}</span>}
        <div className="step-detail-title"><h2 id="selected-step-title">{selected.title}</h2></div>
        <p className="step-instruction">{personalise(selected.instruction)}</p>
        {selected.id === "codex-project" && <a className="text-link" href={WORKSHOP_SOURCE_URL} target="_blank" rel="noreferrer">Open the workshop repository <ArrowUpRight size={13}/></a>}
        {selected.id === "sophon-reference" && <a className="text-link" href={SOPHON_PAPER_URL} target="_blank" rel="noreferrer">Read the Sophon paper <ArrowUpRight size={13}/></a>}
        {selected.id === "smoke" && <NextStepsFlow />}
        {selected.id === "worktrees" && <WorktreeVisual />}
        {selected.id === "profile" && <PipelineVisual />}
        {selected.decision && <p className="step-decision">{personalise(selected.decision)}</p>}
        {selected.actions && <ol className="step-actions">{selected.actions.map(action => <li key={action}>{personalise(action)}</li>)}</ol>}
        {selected.id === "download-data" && <SampleDownloads />}
        {selected.download && <a className="secondary-button" href={selected.download.href} download>{selected.download.label} <ArrowUpRight size={13}/></a>}

        <div key={`${selected.id}-${workspace?.branch ?? "signed-out"}-prompt`}>
          {workspace || selected.id === "download-data" ? <>
            {selected.prompt && <Prompt title="Example prompt">{personalise(selected.prompt)}</Prompt>}
            {selected.extraPrompts?.map(item => <Prompt key={item.title} title={item.title}>{personalise(item.prompt)}</Prompt>)}
          </> : selected.prompt || selected.extraPrompts?.length ? <p className="step-signin-notice">Sign in to get a prompt with your personal branch names.</p> : null}
        </div>
        {selected.commands && workspace && <details className="step-command-details"><summary>{selected.commandTitle || "Show terminal commands"}</summary><pre>{personalise(selected.commands)}</pre></details>}
        {(selected.concept || selected.hint || selected.checkpoint) && <details className="step-help"><summary>More context</summary>
          {selected.concept && <p className="step-context"><strong>{selected.concept.title} </strong>{personalise(selected.concept.body)}</p>}
          {selected.hint && <p className="step-hint">{personalise(selected.hint)}</p>}
          {selected.checkpoint && <p className="step-context"><strong>Done when: </strong>{personalise(selected.checkpoint)}</p>}
        </details>}

        <button className={`complete-step-button${done ? " is-complete" : ""}`} onClick={toggleComplete} aria-pressed={done} disabled={!canSave}>
          {done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
          {participant.saving ? "Saving…" : participant.status !== "authenticated" ? "Sign in to track this step" : done ? "Completed · Undo" : "Mark complete"}
        </button>
        {selected.id === "worktrees" && <p className="completion-explainer">Mark complete saves this checklist. It does not merge your code.</p>}
        {participant.status === "anonymous" && <a href={participant.signInUrl || "/signin-with-chatgpt?return_to=/workshop"} target="_top" className="step-signin-link">Sign in with ChatGPT <ArrowUpRight size={13} /></a>}
        {participant.error && <p role="alert" className="step-save-error">{participant.error}</p>}
        {selected.id === "upload" && <a href="/leaderboard" className="workshop-next">Open the leaderboard <ArrowUpRight size={15} /></a>}
        <a className="back-to-tree" href="#worktree-journey">Back to the steps ↑</a>
      </aside>
    </div>
  </div>;
}

"use client";

import { Check, Circle, GitBranch, GitMerge, Laptop, MoveDown } from "lucide-react";
import { workshopParts, type WorkshopExercise } from "./workshop-content";

type WorktreeJourneyProps = {
  completed: string[];
  selectedId: string;
  onSelect: (id: string) => void;
};

const exercises = workshopParts.flatMap((part) => part.exercises);
const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
const nodeLabels: Record<string, { title: string; detail: string }> = {
  project: { title: "Create your personal branch", detail: "Pull main + verify GitHub access" },
  overview: { title: "Map the code and data flow", detail: "Markdown diagram + folder guide" },
  smoke: { title: "Run the baseline", detail: "Smoke tests + prepared data" },
  worktrees: { title: "Create two worktrees", detail: "Two Codex chats, one starting commit" },
  profile: { title: "Profile the pipeline", detail: "Measure the bottleneck" },
  optimise: { title: "Optimise + verify", detail: "Same outputs, measured timings" },
  "pr-review": { title: "/review + pipeline PR", detail: "Codex reviews and creates the PR" },
  experiments: { title: "Plan model experiments", detail: "Models + features + parameters" },
  train: { title: "Train + compare", detail: "Use validation results" },
  select: { title: "Select + /review + model PR", detail: "Freeze and review the chosen model" },
  integrate: { title: "Merge back to your branch", detail: "Both worktrees → your final branch" },
  preprocess: { title: "Verify the combined result", detail: "Features + selected model" },
  "results-site": { title: "Build your results Site", detail: "Explain the validation evidence" },
  "final-test": { title: "Run the final test", detail: "One frozen model, one evaluation" },
  upload: { title: "Submit to the leaderboard", detail: "Upload + share your findings" },
};

function getStatus(exercise: WorkshopExercise, completed: string[]) {
  if (completed.includes(exercise.id)) return "Complete";
  return exercise.dependsOn.every((id) => completed.includes(id)) ? "Ready" : "Upcoming";
}

function JourneyNode({ id, completed, selectedId, onSelect }: WorktreeJourneyProps & { id: string }) {
  const exercise = exerciseById.get(id);
  if (!exercise) return null;
  const label = nodeLabels[id];
  const status = getStatus(exercise, completed);
  const selected = id === selectedId;
  const number = String(exercises.findIndex((entry) => entry.id === id) + 1).padStart(2, "0");

  return (
    <button
      className={`worktree-node worktree-node--${exercise.location}${selected ? " is-selected" : ""}${status === "Complete" ? " is-complete" : ""}`}
      type="button"
      aria-label={`Step ${number}: ${label?.title || exercise.title}, ${status}`}
      aria-pressed={selected}
      aria-controls="workshop-step-details"
      data-step-id={id}
      data-status={status.toLowerCase()}
      onClick={() => onSelect(id)}
    >
      <span className="worktree-node-number" aria-hidden="true">{status === "Complete" ? <Check size={13} strokeWidth={2.5} /> : number}</span>
      <span className="worktree-node-copy">
        <strong>{label?.title || exercise.title}</strong>
        <span>{label?.detail || exercise.title}</span>
      </span>
      <span className={`worktree-node-status is-${status.toLowerCase()}`}>
        <i aria-hidden="true" />{status}
      </span>
    </button>
  );
}

function NodeSequence({ ids, ...props }: WorktreeJourneyProps & { ids: string[] }) {
  return (
    <ol className="journey-map-sequence">
      {ids.map((id) => (
        <li key={id}>
          <JourneyNode id={id} {...props} />
        </li>
      ))}
    </ol>
  );
}

function BranchConnector({ join = false }: { join?: boolean }) {
  return (
    <svg className={`journey-map-connector${join ? " is-join" : ""}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      {join ? (
        <>
          <path className="journey-map-wire is-pipeline" d="M25 0V11Q25 18 32 18H43Q50 18 50 25V38" />
          <path className="journey-map-wire is-models" d="M75 0V11Q75 18 68 18H57Q50 18 50 25V38" />
        </>
      ) : (
        <>
          <path className="journey-map-wire is-pipeline" d="M50 0V9Q50 16 43 16H32Q25 16 25 23V40" />
          <path className="journey-map-wire is-models" d="M50 0V9Q50 16 57 16H68Q75 16 75 23V40" />
        </>
      )}
    </svg>
  );
}

export function WorktreeJourney(props: WorktreeJourneyProps) {
  return (
    <section className="journey-map" aria-labelledby="journey-map-heading">
      <header className="journey-map-header">
        <div><GitBranch size={18} aria-hidden="true" /><h2 id="journey-map-heading">Your workshop journey</h2></div>
        <p>Select a step for instructions and prompts</p>
      </header>

      <div className="journey-map-spine">
        <div className="journey-map-stage-label"><Laptop size={13} aria-hidden="true" /><span>Your branch <em>/ frozen baseline</em></span></div>
        <NodeSequence ids={["project", "overview", "smoke", "worktrees"]} {...props} />
      </div>

      <div className="journey-map-parallel-caption"><span>Work in parallel</span></div>
      <BranchConnector />
      <div className="journey-map-lanes">
        <section className="journey-map-lane is-pipeline" aria-labelledby="journey-map-pipeline-heading">
          <h3 id="journey-map-pipeline-heading"><GitBranch size={13} aria-hidden="true" /><span>Worktree A <em>/ pipeline</em></span></h3>
          <NodeSequence ids={["profile", "optimise", "pr-review"]} {...props} />
        </section>
        <section className="journey-map-lane is-models" aria-labelledby="journey-map-models-heading">
          <h3 id="journey-map-models-heading"><GitBranch size={13} aria-hidden="true" /><span>Worktree B <em>/ models</em></span></h3>
          <NodeSequence ids={["experiments", "train", "select"]} {...props} />
        </section>
      </div>
      <BranchConnector join />

      <div className="journey-map-spine journey-map-integration">
        <div className="journey-map-stage-label"><GitMerge size={13} aria-hidden="true" /><span>Your branch <em>/ both changes merged</em></span></div>
        <NodeSequence ids={["integrate", "preprocess", "results-site", "final-test", "upload"]} {...props} />
      </div>

      <footer className="journey-map-footer">
        <span><MoveDown size={12} aria-hidden="true" /> Connectors show prerequisites</span>
        <span><Circle size={9} aria-hidden="true" /> Any step can be explored</span>
      </footer>
    </section>
  );
}

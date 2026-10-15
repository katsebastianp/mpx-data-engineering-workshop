"use client";

import { Check, GitBranch, GitMerge, Laptop } from "lucide-react";
import { workshopExercises, optionalWorkshopExercises } from "./workshop-content";

type WorktreeJourneyProps = {
  completed: string[];
  selectedId: string;
  onSelect: (id: string) => void;
};

const exercises = workshopExercises;
const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
function JourneyNode({ id, completed, selectedId, onSelect }: WorktreeJourneyProps & { id: string }) {
  const exercise = exerciseById.get(id);
  if (!exercise) return null;
  const done = completed.includes(id);
  const selected = id === selectedId;
  const number = exercise.optional ? "+" : String(exercises.findIndex((entry) => entry.id === id) + 1).padStart(2, "0");

  return (
    <button
      className={`worktree-node worktree-node--${exercise.location}${selected ? " is-selected" : ""}${done ? " is-complete" : ""}`}
      type="button"
      aria-label={`Step ${number}: ${exercise.title}${done ? ", complete" : ""}`}
      aria-pressed={selected}
      aria-controls="workshop-step-details"
      data-step-id={id}
      onClick={() => onSelect(id)}
    >
      <span className="worktree-node-number" aria-hidden="true">{done ? <Check size={13} strokeWidth={2.5} /> : number}</span>
      <span className="worktree-node-copy">
        <strong>{exercise.title}</strong>
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
        <div><GitBranch size={18} aria-hidden="true" /><h2 id="journey-map-heading">Workshop steps</h2></div>
        <p>Select a step to get started</p>
      </header>

      <div className="journey-map-spine">
        <div className="journey-map-stage-label"><Laptop size={13} aria-hidden="true" /><span>Get set up</span></div>
        <NodeSequence ids={["codex-project", "download-data", "project", "overview", "smoke", "worktrees"]} {...props} />
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
        <div className="journey-map-stage-label"><GitMerge size={13} aria-hidden="true" /><span>Bring it together</span></div>
        <NodeSequence ids={["integrate", "preprocess", "results-site"]} {...props} />
      </div>
      <details className="optional-journey" open={optionalWorkshopExercises.some(exercise => exercise.id === props.selectedId) || undefined}>
        <summary>Optional · share results or enter the challenge</summary>
        <p>The core workshop ends with your results Site. For the optional leaderboard challenge, freeze your model, run the final test once, then upload its generated result.</p>
        <NodeSequence ids={optionalWorkshopExercises.map(exercise => exercise.id)} {...props} />
      </details>
    </section>
  );
}

"use client";

import { useState } from "react";

export function NextStepsFlow() {
  return <div className="learning-visual next-steps-flow"><h3>Two things we’ll improve</h3><p>Run once and save the starting results.</p><div className="next-flow-branches"><p><strong>A · Pipeline</strong>Can we process the same data faster?</p><p><strong>B · Model</strong>Can we distinguish signal from background more accurately?</p></div></div>;
}

export function PipelineVisual() {
  const [partitions, setPartitions] = useState(2048);
  return <section className="learning-visual"><h3>Same work, fewer pieces</h3><p>Spark splits the work into partitions. Each piece takes time to schedule.</p><div className="learning-switch" aria-label="Illustrative partition count">{[2048, 4].map(value => <button type="button" key={value} aria-pressed={partitions === value} onClick={() => setPartitions(value)}>{value.toLocaleString("en-US")} partitions</button>)}</div><div className="partition-grid" aria-label={`${partitions} illustrative partitions`}>{Array.from({ length: partitions }, (_, index) => <span key={index}/>)}</div><div className="learning-code"><code>src/preprocessing/pipeline.py · SHUFFLE_PARTITIONS</code></div><p className="learning-caption">Compare three runs per setting; check that the values stay identical.</p></section>;
}

export function WorktreeVisual() {
  return <div className="learning-visual"><h3>Two chats, two folders</h3><div className="worktree-explainer"><span>Your personal branch</span><div><p><strong>Worktree A</strong>Pipeline code</p><p><strong>Worktree B</strong>Model choices</p></div><span>Review PRs → merge back</span></div><p className="learning-caption">Each chat edits its own copy.</p></div>;
}

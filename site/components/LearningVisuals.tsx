"use client";

export function NextStepsFlow() {
  return <div className="learning-visual next-steps-flow"><h3>What comes next?</h3><div className="next-flow-line"><span>Particles</span><b>→</b><span>Features</span><b>→</b><span>Model</span><b>→</b><span>Signal / background</span></div><div className="next-flow-branches"><p><strong>A · Pipeline</strong>Can we do the same work faster?</p><p><strong>B · Model</strong>Can we make fewer mistakes?</p></div></div>;
}

export function PipelineVisual() {
  const [partitions, setPartitions] = useState(64);
  return <section className="learning-visual"><h3>Same work, fewer pieces</h3><p>Spark splits the work into partitions. Each piece takes time to schedule.</p><div className="learning-switch" aria-label="Illustrative partition count">{[64, 4].map(value => <button type="button" key={value} aria-pressed={partitions === value} onClick={() => setPartitions(value)}>{value} partitions</button>)}</div><div className="partition-grid" aria-label={`${partitions} illustrative partitions`}>{Array.from({ length: partitions }, (_, index) => <span key={index}/>)}</div><div className="learning-code"><code>src/preprocessing/pipeline.py · SHUFFLE_PARTITIONS</code></div><p className="learning-caption">Illustration. Your run will tell us whether it is faster.</p></section>;
}

export function WorktreeVisual() {
  return <div className="learning-visual"><h3>Two chats, two folders</h3><div className="worktree-explainer"><span>Your personal branch</span><div><p><strong>Worktree A</strong>Pipeline code</p><p><strong>Worktree B</strong>Model choices</p></div><span>Review PRs → merge back</span></div><p className="learning-caption">Each chat edits its own copy.</p></div>;
}

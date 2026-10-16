"use client";

import { useState } from "react";
import examples from "../lib/jet-examples.json";

const stages = ["Raw jet", "Make features", "Predict", "Decide"];
const codeLocations = [
  "src/preprocessing/pipeline.py · check_inputs()",
  "src/preprocessing/features.py · particle_features() → build_features()",
  "src/predict/logistic.py · LogisticPredictor._predict()",
  "tools/model-explorer/app.js · renderThreshold()",
];

/** Historical validation examples, copied from docs/assets/jet-examples.json. */
export function DataFlowExplorer() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [stage, setStage] = useState(0);
  const [threshold, setThreshold] = useState(0.5);
  const jet = examples.examples[exampleIndex];
  const score = jet.scores["linear-basic"];
  const predictedSignal = score >= threshold;
  return <section className="learning-visual" aria-label="Follow a real jet through the code">
    <div className="learning-visual-heading"><h3>Follow one jet</h3></div>
    <div className="learning-switch" aria-label="Choose a validation example">
      {examples.examples.map((example, index) => <button key={example.record_id} type="button" aria-pressed={index === exampleIndex} onClick={() => setExampleIndex(index)}>{example.truth_group === "signal" ? "Signal jet" : "Background jet"}</button>)}
    </div>
    <div className="data-flow-stages" aria-label="Processing steps">{stages.map((name, index) => <button key={name} type="button" aria-pressed={stage === index} onClick={() => setStage(index)}><span>0{index + 1}</span>{name}</button>)}</div>
    <div className="data-flow-content" aria-live="polite">
      {stage === 0 && <>
        <svg viewBox="0 0 340 180" role="img" aria-label={`Measured particle directions for the ${jet.truth_group} jet. Circle area shows energy.`}>
          <line x1="45" y1="88" x2="310" y2="88" stroke="#73808e"/><line x1="177" y1="15" x2="177" y2="155" stroke="#73808e"/>
          {jet.part_energy.map((energy, i) => <circle key={i} cx={177 + jet.part_deta[i] * 108} cy={88 - jet.part_dphi[i] * 108} r={Math.sqrt(energy) * .55} fill={exampleIndex === 0 ? "#ff929d" : "#9ecce3"} fillOpacity=".8"><title>{energy.toFixed(2)} GeV · Δη {jet.part_deta[i].toFixed(3)} · Δφ {jet.part_dphi[i].toFixed(3)}</title></circle>)}
          <text x="294" y="106" fill="currentColor" fontSize="11">Δη</text><text x="188" y="22" fill="currentColor" fontSize="11">Δφ</text>
        </svg>
        <p>{jet.particle_count} particles. Dots show direction; size shows energy.</p>
        <div className="learning-values"><span>Momentum <b>{jet.jet_pt.toFixed(1)} GeV</b></span><span>Mass <b>{jet.jet_sdmass.toFixed(1)} GeV</b></span></div>
        <details><summary>Inspect the first three particles</summary><pre>{JSON.stringify({ part_energy: jet.part_energy.slice(0, 3), part_deta: jet.part_deta.slice(0, 3), part_dphi: jet.part_dphi.slice(0, 3) }, null, 2)}</pre></details>
      </>}
      {stage === 1 && <>
        <p>Spark turns each particle list into eight numbers.</p>
        <div className="learning-calculation">Add all {jet.particle_count} particle energies <span>↓</span><strong>{jet.energy_sum.toFixed(1)} GeV</strong><small>energy_sum</small></div>
        <dl className="learning-feature-list">{[
          ["jet_pt", jet.jet_pt], ["jet_sdmass", jet.jet_sdmass], ["particle_count", jet.particle_count],
          ["energy_sum", jet.energy_sum], ["leading_energy_fraction", jet.leading_energy_fraction],
          ["radial_energy_moment", jet.radial_energy_moment], ["energy_dispersion", jet.energy_dispersion], ["ecf2_beta1", jet.ecf2_beta1],
        ].map(([name, value], index) => <div key={name}><dt><code>{name}</code>{index < 3 && <small>basic</small>}</dt><dd>{Number(value).toFixed(index < 4 ? 1 : 4)}</dd></div>)}</dl>
        <p className="learning-caption">basic = first 3 · shape = all 8 · truth is kept separate</p>
      </>}
      {stage === 2 && <>
        <p>Logistic regression reads three features and returns a score.</p>
        <div className="learning-calculation"><code>[{jet.jet_pt.toFixed(1)}, {jet.jet_sdmass.toFixed(1)}, {jet.particle_count}]</code><span>↓ trained model ↓</span><strong>{score.toFixed(3)}</strong><small>signal score</small></div>
        <p className="learning-caption">Higher = more signal-like. Not a calibrated probability.</p>
      </>}
      {stage === 3 && <>
        <p>Score ≥ threshold → signal. Move the slider.</p>
        <label className="learning-threshold">Threshold <strong>{threshold.toFixed(2)}</strong><input aria-label="Example decision threshold" type="range" min="0" max="1" step=".01" value={threshold} onChange={event => setThreshold(Number(event.target.value))}/></label>
        <div className="learning-values"><span>Score <b>{score.toFixed(3)}</b></span><span>Prediction <b>{predictedSignal ? "Signal" : "Background"}</b></span><span>Known truth <b>{jet.truth_group === "signal" ? "Signal" : "Background"}</b></span></div>
        <p className="learning-verdict">{predictedSignal === (jet.truth_group === "signal") ? "Correct for this jet." : predictedSignal ? "False alarm: background called signal." : "Missed signal: signal called background."}</p>
        <p className="learning-caption">One example only. Compare models on all 1,000 validation jets.</p>
      </>}
    </div>
    <div className="learning-code"><code>{codeLocations[stage]}</code></div>
    <details className="learning-provenance"><summary>Example source and limits</summary><p>Saved validation examples from <code>docs/assets/jet-examples.json</code>, historical run <code>{examples.prediction_runs["linear-basic"]}</code>. This is a teaching example, not your new run. First record in each class within the reference training range; two examples, not class averages.</p><p>Record: <code>{jet.record_id}</code></p><p>Dataset: <code>{examples.dataset_id}</code></p></details>
  </section>;
}

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

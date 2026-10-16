"use client";

import { useState } from "react";
import { ArrowRight, ArrowDown } from "lucide-react";
import examples from "../lib/jet-examples.json";

const features = [
  { name: "jet_pt", description: "Momentum across the beam", unit: "GeV" },
  { name: "jet_sdmass", description: "Mass after removing soft, wide-angle radiation", unit: "GeV" },
  { name: "particle_count", description: "Number of particles in the jet", unit: "" },
  { name: "energy_sum", description: "Total energy of the particles", unit: "GeV" },
  { name: "leading_energy_fraction", description: "Share of energy carried by the leading particle", unit: "" },
  { name: "radial_energy_moment", description: "Energy-weighted spread around the jet axis", unit: "" },
  { name: "energy_dispersion", description: "How concentrated the energy is among particles", unit: "" },
  { name: "ecf2_beta1", description: "Energy-weighted separation between particle pairs", unit: "" },
] as const;

function ModelDrawing() {
  return <svg viewBox="0 0 160 130" aria-hidden="true">
    <rect x="27" y="24" width="106" height="82" rx="6" fill="none" stroke="currentColor" strokeOpacity=".6"/>
    {[44, 65, 86].map(y => <path key={y} d={`M7 ${y}H27M133 ${y}H153`} stroke="currentColor" strokeOpacity=".4"/>)}
    <text x="80" y="73" textAnchor="middle" fill="currentColor" fontFamily="var(--mono)" fontSize="26">f(x)</text>
  </svg>;
}

function JetGlyph({decay = false}:{decay?: boolean}) {
  return <svg viewBox="0 0 64 40" aria-hidden="true">
    {Array.from({length:7}, (_, i) => <path key={i} d={decay ? `M4 20 Q26 20 58 ${i < 4 ? 2 + i * 3 : 28 + (i - 4) * 4}` : `M4 20 Q28 20 58 ${7 + i * 4}`} fill="none" stroke="currentColor" strokeWidth={i === 3 ? 1.6 : .8} opacity={i === 3 ? 1 : .55}/>)}
    <circle cx="4" cy="20" r="2" fill="currentColor"/>
  </svg>;
}

export function PredictionFlow() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const jet = examples.examples[exampleIndex];
  const groups = [
    { id: "supplied" as const, title: "Supplied with the data", count: "03", rows: features.slice(0, 3) },
    { id: "calculated" as const, title: "Calculated in preprocessing", count: "05", rows: features.slice(3) },
  ];

  return <section className="prediction-section section-wrap" aria-labelledby="prediction-title">
    <div className="section-heading prediction-heading"><div><span className="section-kicker">THE LEARNING PROBLEM</span><h2 id="prediction-title">From a jet to a prediction</h2></div></div>
    <div className="prediction-flow">
      <div className="prediction-stage jet-stage">
        <span className="prediction-step">01 / INPUT DATA</span>
        <h3>One jet</h3>
        <svg className="jet-cloud" viewBox="0 0 180 160" role="img" aria-label={`Jet ${exampleIndex === 0 ? "A" : "B"}: ${jet.particle_count} particles; dot size shows energy`}>
          {[24, 48, 72].map(r => <circle key={r} cx="90" cy="80" r={r} className="jet-guide"/>)}
          <path d="M8 80H172M90 4V156" className="jet-guide"/>
          {jet.part_energy.map((energy, i) => <circle key={i} cx={90 + jet.part_deta[i] * 100} cy={80 - jet.part_dphi[i] * 100} r={2 + Math.sqrt(energy) * .36} className="jet-particle"><title>{energy.toFixed(1)} GeV</title></circle>)}
          <circle cx="90" cy="80" r="2" fill="var(--ink)"/>
        </svg>
        <div className="jet-example-picker" aria-label="Choose a jet example">{examples.examples.map((example, i) => <button key={example.record_id} type="button" aria-pressed={i === exampleIndex} onClick={() => setExampleIndex(i)}>Jet {i === 0 ? "A" : "B"}</button>)}</div>
      </div>
      <ArrowRight className="prediction-arrow" size={22} strokeWidth={1}/>
      <div className="prediction-stage feature-stage">
        <span className="prediction-step">02 / PREPROCESSING</span><h3>8 features</h3>
        <div className="feature-origin-buttons">{groups.map(group => <a key={group.id} className={`origin-button ${group.id}`} href={`#features-${group.id}`}>
          <span className="origin-count">{group.count}</span><span>{group.id === "supplied" ? "From the data" : "Calculated"}<span className="feature-ticks" aria-hidden="true">{group.rows.map(row => <i key={row.name}/>)}</span></span><ArrowDown size={14}/>
        </a>)}</div>
      </div>
      <ArrowRight className="prediction-arrow" size={22} strokeWidth={1}/>
      <div className="prediction-stage model-stage"><span className="prediction-step">03 / MODEL</span><h3>Predict</h3><ModelDrawing/></div>
      <ArrowRight className="prediction-arrow" size={22} strokeWidth={1}/>
      <div className="prediction-stage outcome-stage"><span className="prediction-step">04 / TWO CLASSES</span><h3>Which origin?</h3><div className="prediction-outcomes">
        <div className="ordinary-outcome"><JetGlyph/><strong>Ordinary jet</strong><span>QCD background</span></div>
        <span className="outcome-or">or</span>
        <div className="decay-outcome"><JetGlyph decay/><strong>Jet from decay</strong><span>Signal · X → bb</span></div>
      </div></div>
    </div>
    <div className="prediction-feature-heading"><h3>The eight features</h3><span>Values for Jet {exampleIndex === 0 ? "A" : "B"}</span></div>
    <div className="prediction-feature-groups">{groups.map(group => <div key={group.id} id={`features-${group.id}`} tabIndex={-1} className={`prediction-feature-group ${group.id}`}>
      <h4><span>{group.count}</span>{group.title}</h4>
      <dl>{group.rows.map(feature => <div className="prediction-feature-row" key={feature.name}><dt><code>{feature.name}</code><span>{feature.description}</span></dt><dd>{jet[feature.name].toFixed(feature.name === "particle_count" ? 0 : feature.unit ? 1 : 3)}{feature.unit && <small>{feature.unit}</small>}</dd></div>)}</dl>
    </div>)}</div>
  </section>;
}

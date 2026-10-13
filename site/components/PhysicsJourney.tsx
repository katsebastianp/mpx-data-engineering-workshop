"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Maximize2, Pause, Play, RotateCcw } from "lucide-react";

const ColliderJourneyScene = lazy(() => import("./ColliderJourneyScene"));

const stages = [
  {
    label: "Collision",
    title: "Protons collide",
    formula: "p + p → interaction",
    bullets: [
      "Two proton beams travel in opposite directions around the LHC",
      "Quarks or gluons inside the protons interact at the collision point",
      "The interaction can produce new particles"
    ],
    animation: "Watch the two proton bunches meet at the centre of the detector"
  },
  {
    label: "Decay",
    title: "Particle decay",
    formula: "X → b + b̄",
    bullets: [
      "In our simulated signal, a hypothetical particle X decays into a bottom quark and a bottom antiquark",
      "X is a generic signal particle, not necessarily the Higgs boson",
      "A large boost can bring the two decay branches close together"
    ],
    animation: "Watch X travel briefly, then split into two moving decay branches"
  },
  {
    label: "Shower",
    title: "The particle shower",
    formula: "radiation → hadronisation",
    bullets: [
      "Quarks radiate, producing a branching shower of quarks and gluons",
      "The shower forms hadrons, some of which decay further",
      "The detector measures the resulting particles, not isolated quarks"
    ],
    animation: "Watch the branches grow as the shower develops"
  },
  {
    label: "Jet",
    title: "Reconstructing a jet",
    formula: "particle measurements → jet",
    bullets: [
      "Particles close in direction are grouped into a jet",
      "For a boosted X decay, both branches can sit inside one large-radius jet",
      "Our models distinguish this pattern from ordinary quark and gluon jets"
    ],
    animation: "Watch the jet boundary appear around the two particle branches"
  }
];

export default function PhysicsJourney() {
  const [zoom, setZoom] = useState(0);
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [travelling, setTravelling] = useState(false);
  const frame = useRef(0);
  const zoomRef = useRef(0);
  const inside = zoom > 0.96;
  const current = stages[stage];

  useEffect(() => {
    const jump = () => {
      if (window.location.hash === "#collision") {
        zoomRef.current = 1;
        setZoom(1);
      }
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => { window.removeEventListener("hashchange", jump); cancelAnimationFrame(frame.current); };
  }, []);

  function travel(target: number) {
    cancelAnimationFrame(frame.current);
    const start = zoomRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      zoomRef.current = target;
      setZoom(target);
      setTravelling(false);
      return;
    }
    const started = performance.now();
    setTravelling(true);
    const tick = (now: number) => {
      const t = Math.min((now - started) / 2400, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      zoomRef.current = start + (target - start) * eased;
      setZoom(zoomRef.current);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else { setTravelling(false); if (target === 1) setReplayKey(key => key + 1); }
    };
    frame.current = requestAnimationFrame(tick);
  }

  function chooseStage(next: number) {
    setPaused(false);
    setStage(next);
    setReplayKey(key => key + 1);
    if (!inside) travel(1);
  }

  return <section className="physics-journey">
    <header className="physics-intro">
      <div className="eyebrow"><span className="swiss-cross" aria-hidden="true"/><span>RINGIER × OPENAI · CODEX WORKSHOP</span></div>
      <h1>From particle collisions<br/><span>to better models</span></h1>
      <p>A hands-on workshop in data engineering and machine learning with Codex</p>
    </header>

    <div className={`journey-exhibit${inside ? " is-inside" : ""}`} id="collision">
      <div className="journey-exhibit-header">
        <div><span className="live-dot"/><span>{inside ? "INSIDE THE DETECTOR" : travelling ? "ENTERING THE DETECTOR" : "CERN / LARGE HADRON COLLIDER"}</span></div>
        <span className="journey-location">{inside ? "Illustrative X → bb̄ event" : "Geneva · Switzerland / France"}</span>
      </div>
      <div className="journey-viewport">
        <Suspense fallback={<img className="journey-poster" src="/collider-v2-poster.png" alt="Schematic cutaway model of the Large Hadron Collider"/>}>
          <ColliderJourneyScene zoom={zoom} stage={stage} paused={paused} replayKey={replayKey}/>
        </Suspense>
        {!inside && zoom < 0.2 && <div className="journey-scale"><strong>27 <span>km</span></strong><span>Ring circumference</span></div>}
        {inside && <div className="journey-formula" aria-hidden="true">{current.formula}</div>}
        {zoom > 0.08 && zoom < 0.95 && <div className="zoom-caption">{zoom < 0.48 ? "Approaching the collision point" : "Inside the detector"}</div>}
        <div className="journey-viewport-footer">
          <span>{inside ? "Schematic event · not to scale" : "Schematic cutaway · drag to rotate"}</span>
          <div className="scene-buttons">
            <button onClick={() => setPaused(!paused)} aria-label={paused ? "Play animation" : "Pause animation"} title={paused ? "Play animation" : "Pause animation"}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
            {inside && <button onClick={() => {setReplayKey(key=>key+1);setPaused(false)}} aria-label="Replay this stage" title="Replay this stage"><RotateCcw size={15}/></button>}
          </div>
        </div>
      </div>

      <div className="journey-navigation">
        <button className="journey-travel-button" onClick={() => travel(inside ? 0 : 1)} disabled={travelling}>
          {inside ? <ArrowLeft size={17}/> : <Maximize2 size={16}/>}
          {travelling ? "Moving through the collider…" : inside ? "Back to the LHC" : "Zoom into the detector"}
          {!inside && !travelling && <ArrowRight size={17}/>}
        </button>
        <div className="zoom-track">
          <label htmlFor="collider-zoom">LHC overview</label>
          <input id="collider-zoom" aria-label="Zoom from the LHC into the detector" type="range" min="0" max="100" step="1" value={Math.round(zoom*100)} onChange={e=>{cancelAnimationFrame(frame.current);setTravelling(false);const value=Number(e.target.value)/100;zoomRef.current=value;setZoom(value)}}/>
          <span>Collision point</span>
        </div>
      </div>
      <div className="journey-stages" role="tablist" aria-label="Particle event stages">
        {stages.map((s,i)=><button key={s.label} id={`event-stage-${i}`} role="tab" aria-selected={inside && stage===i} aria-controls="event-explanation" onClick={()=>chooseStage(i)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=(i+(e.key==='ArrowRight'?1:3))%4;chooseStage(next);document.getElementById(`event-stage-${next}`)?.focus()}}}><span>0{i+1}</span>{s.label}<span className="stage-arrow" aria-hidden="true">→</span></button>)}
      </div>
      <div id="event-explanation" className="journey-explanation" role="tabpanel" aria-labelledby={inside?`event-stage-${stage}`:undefined}>
        <div><span className="section-kicker">{inside ? `STAGE 0${stage+1}` : "THE ACCELERATOR"}</span><h2>{inside ? current.title : "The Large Hadron Collider"}</h2><p>{inside ? current.animation : "Explore the machine, then zoom into a collision point to see what happens inside"}</p></div>
        <ul>{(inside ? current.bullets : ["Two beams circulate in opposite directions through a 27-kilometre underground ring", "Superconducting magnets guide the beams towards collision points", "Detectors record the particles produced in each interaction"]).map(item=><li key={item}>{item}</li>)}</ul>
      </div>
    </div>
    <div className="journey-footnote"><span>Blender model & interactive 3D</span><span>Geometry, distances and time are illustrative</span><a href="#workshop-data">Explore the workshop data <ArrowDown size={12}/></a></div>
  </section>;
}

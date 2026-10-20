"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Maximize2, Pause, Play, RotateCcw } from "lucide-react";

const ColliderJourneyScene = lazy(() => import("./ColliderJourneyScene"));

const stages = [
  {
    label: "Collision",
    title: "Two examples start with a collision",
    bullets: [
      "At CERN, proton beams collide at very high energy and can produce new particles",
      "Pink shows a simulated target signal; blue shows ordinary background",
      "We show the two examples together for comparison, not as one measured event"
    ],
    animation: "Start with the collision, then follow what each example produces."
  },
  {
    label: "Origin",
    title: "Different origins, different patterns",
    bullets: [
      "Signal: a hypothetical particle X decays into a bottom quark and a bottom antiquark",
      "Background: we follow an ordinary outgoing quark or gluon",
      "Different origins can leave different patterns. Can we tell them apart?"
    ],
    animation: "Pink starts with the hypothetical X decay; blue starts with a quark or gluon."
  },
  {
    label: "Shower",
    title: "Both examples form particle showers",
    bullets: [
      "The quarks and gluons radiate, creating branching showers",
      "They form hadrons, which leave measurements in the detector",
      "Both examples produce sprays of particles; a spray alone does not identify the signal"
    ],
    animation: "Follow how both starting points develop into sprays of particles."
  },
  {
    label: "Jet",
    title: "Group the particles into jets",
    bullets: [
      "The outlines group the existing particle measurements into jets; no new particles are added",
      "The two nearby branches from the boosted X decay fit inside one signal jet",
      "The model scores each whole jet as more signal-like or more like QCD background"
    ],
    animation: "Only the jet boundaries are added. Real signal and QCD background jets can look similar."
  }
];

export default function PhysicsJourney() {
  const [zoom, setZoom] = useState(0);
  const [stage, setStage] = useState(0);
  const [playAll, setPlayAll] = useState(true);
  const [staticPreview, setStaticPreview] = useState(false);
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
      else setTravelling(false);
    };
    frame.current = requestAnimationFrame(tick);
  }

  function chooseStage(next: number) {
    setPaused(false);
    setPlayAll(false);
    setStage(next);
    if (!inside) travel(1);
  }

  function replaySequence() {
    setStage(0);
    setPlayAll(true);
    setPaused(false);
    setReplayKey(key => key + 1);
  }

  return <section className="physics-journey">
    <header className="physics-intro">
      <div className="eyebrow"><span className="swiss-cross" aria-hidden="true"/><span>RINGIER × OPENAI · CODEX WORKSHOP</span></div>
      <h1>Collision Lab:<br/><span>Data Engineering with Codex</span></h1>
      <p>Explore the data. Improve the pipeline. Compare the models.</p>
    </header>

    <div className={`journey-exhibit${inside ? " is-inside" : ""}`} id="collision">
      <div className="journey-exhibit-header">
        <div><span className="live-dot"/><span>{inside ? "SIGNAL & QCD BACKGROUND" : travelling ? "ENTERING THE DETECTOR" : "CERN / LARGE HADRON COLLIDER"}</span></div>
        <span className="journey-location">{inside ? "Two synchronized examples · not one event" : "Geneva · Switzerland / France"}</span>
      </div>
      <div className={`journey-viewport${inside ? " is-comparing" : ""}`}>
        <Suspense fallback={<img className="journey-poster" src="/collider-v2-poster.png" alt="Schematic cutaway model of the Large Hadron Collider"/>}>
          <ColliderJourneyScene zoom={zoom} stage={stage} paused={paused} replayKey={replayKey} playAll={playAll} onStageChange={setStage} onFallbackChange={setStaticPreview}/>
        </Suspense>
        {!inside && zoom < 0.2 && <div className="journey-scale"><strong>27 <span>km</span></strong><span>Ring circumference</span></div>}
        {zoom > 0.08 && zoom < 0.95 && <div className="zoom-caption">{zoom < 0.48 ? "Approaching the collision point" : "Inside the detector"}</div>}
        <div className="journey-viewport-footer">
          <span>{inside ? "Two synchronized examples · not to scale" : "Schematic cutaway · drag to rotate"}</span>
          {!staticPreview && <div className="scene-buttons">
            <button onClick={() => setPaused(!paused)} aria-label={paused ? "Play animation" : "Pause animation"} title={paused ? "Play animation" : "Pause animation"}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
            {inside && <button onClick={replaySequence} aria-label="Replay full sequence" title="Replay full sequence"><RotateCcw size={15}/></button>}
          </div>}
        </div>
      </div>

      <div className="journey-navigation">
        <button className="journey-travel-button" onClick={() => {if (!inside) replaySequence(); travel(inside ? 0 : 1)}} disabled={travelling}>
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
      {inside && <div className="journey-playback"><span>{staticPreview ? "Static preview · select a stage below (3D unavailable)" : playAll ? "Collision → Origin → Shower → Jet" : "Selected stage · both examples stay synchronized"}</span>{!staticPreview && <button onClick={replaySequence}><RotateCcw size={13}/> Replay full sequence</button>}</div>}
      <div className="journey-stages" role="tablist" aria-label="Particle event stages">
        {stages.map((s,i)=><button key={s.label} id={`event-stage-${i}`} role="tab" aria-selected={inside && stage===i} aria-controls="event-explanation" onClick={()=>chooseStage(i)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=(i+(e.key==='ArrowRight'?1:3))%4;chooseStage(next);document.getElementById(`event-stage-${next}`)?.focus()}}}><span>0{i+1}</span>{s.label}<span className="stage-arrow" aria-hidden="true">→</span></button>)}
      </div>
      <div id="event-explanation" className="journey-explanation" role="tabpanel" aria-labelledby={inside?`event-stage-${stage}`:undefined}>
        <div><span className="section-kicker">{inside ? `STAGE 0${stage+1}` : "THE ACCELERATOR"}</span><h2>{inside ? current.title : "The Large Hadron Collider"}</h2><p>{inside ? current.animation : "Explore the machine, then zoom into a collision point to see what happens inside"}</p></div>
        <ul>{(inside ? current.bullets : ["Two beams circulate in opposite directions through a 27-kilometre underground ring", "Superconducting magnets guide the beams towards collision points", "Detectors record the particles produced in each interaction"]).map(item=><li key={item}>{item}</li>)}</ul>
      </div>
    </div>
    <div className="journey-footnote"><span>Blender model & interactive 3D</span><span>Geometry, distances and time are illustrative</span><a href="/brief#prediction-title">Explore the workshop data <ArrowDown size={12}/></a></div>
  </section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildColliderOverview } from "./scene/collider-overview";
import { buildParticleEvent } from "./scene/particle-event";
import { advanceTime, stageAtTime, STAGE_ENDS } from "./scene/event-timeline";
import { clamp, disposeObject, EVENT_SCALE, glowTexture, smooth, STATION } from "./scene/scene-primitives";

type Props = {
  zoom: number;
  stage: number;
  paused: boolean;
  replayKey: number;
  playAll: boolean;
  onStageChange: (stage: number) => void;
  onFallbackChange: (fallback: boolean) => void;
  onReady?: () => void;
};

function SceneFallback({ zoom, stage }: { zoom: number; stage: number }) {
  if (zoom < .55) return <Image unoptimized src="/collider-v2-poster.png" alt="Schematic cutaway of the Large Hadron Collider" width={1800} height={1100} draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />;
  return <svg viewBox="0 0 900 520" preserveAspectRatio="none" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
    <g fill="none" stroke="#83909d" strokeWidth="7" opacity=".55">{[170,220,270,320].map(x=><ellipse key={x} cx={x} cy="260" rx="75" ry="175"/>)}</g>
    <path d="M100 260H350" stroke="#e7e8e9" strokeWidth="2" strokeDasharray="5 6"/>
    <path d="M350 260L420 223" stroke="#ff929d" strokeWidth="3"/>
    <path d="M350 260L420 280" stroke="#86caff" strokeWidth="3"/>
    {stage >= 1 && <>
      <g fill="none" stroke="#ff929d" strokeWidth="3"><path d="M420 223L580 137L720 111M420 223L570 203L720 206"/></g>
      <path d="M420 280L510 310L730 351" fill="none" stroke="#86caff" strokeWidth="3"/>
    </>}
    {stage >= 2 && <>
      <g fill="none" stroke="#ff929d" strokeWidth="2">{Array.from({length:10},(_,i)=><path key={i} d={`M${i<5?580:570} ${i<5?137:203}L${650+i%3*12} ${i<5?110+i*10:182+(i-5)*10}L${716+i%3*8} ${i<5?92+i*12:179+(i-5)*13}`}/>)}</g>
      <g fill="none" stroke="#86caff" strokeWidth="2">{Array.from({length:11},(_,i)=><path key={i} d={`M${470+i%3*30} ${299+i%3*8}L${610+i%4*14} ${310+i*6}L${718+i%3*8} ${298+i*10}`}/>)}</g>
    </>}
    {stage >= 3 && <>
      <path d="M350 260L740 80Q790 165 740 245Z" fill="#f15f6718" stroke="#ff929d" strokeWidth="2"/>
      <path d="M350 260L740 285Q778 350 740 415Z" fill="#86caff18" stroke="#86caff" strokeWidth="2"/>
    </>}
    <circle cx="350" cy="260" r="6" fill="#fff"/>
  </svg>;
}

export default function ColliderJourneyScene({ zoom, stage, paused, replayKey, playAll, onStageChange, onFallbackChange, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const signalLabel = useRef<HTMLDivElement>(null);
  const backgroundLabel = useRef<HTMLDivElement>(null);
  const signalLeader = useRef<SVGLineElement>(null);
  const backgroundLeader = useRef<SVGLineElement>(null);
  const parameters = useRef({ zoom, stage, paused, replayKey, playAll, onStageChange, onReady });
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  useEffect(() => { onFallbackChange(status === "fallback"); }, [status, onFallbackChange]);
  useEffect(() => {
    // Without WebGL, show a useful static comparison; tabs still select stages.
    if (status === "fallback" && playAll) onStageChange(3);
  }, [status, playAll, replayKey, onStageChange]);
  useEffect(() => { parameters.current = { zoom, stage, paused, replayKey, playAll, onStageChange, onReady }; }, [zoom, stage, paused, replayKey, playAll, onStageChange, onReady]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (error) {
      console.warn("[collision-lab] Interactive 3D unavailable; displaying an accessible schematic", error);
      let mounted = true;
      queueMicrotask(() => { if (mounted) { setStatus("fallback"); parameters.current.onReady?.(); } });
      return () => { mounted = false; };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.setClearColor(0x292c30, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .94;
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:pan-y;opacity:0;transition:opacity .3s";
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, .003, 100);
    scene.add(new THREE.HemisphereLight(0xe9f0f6, 0x505561, .9));
    const key = new THREE.DirectionalLight(0xfff4e9, 2.2);
    key.position.set(-5, 12, 9);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbecede, 1.65);
    rim.position.set(9, 5, -8);
    scene.add(rim);
    const front = new THREE.DirectionalLight(0xffffff, .75);
    front.position.set(4, 2, 12);
    scene.add(front);
    let environment: THREE.WebGLRenderTarget | undefined;
    try {
      const generator = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = generator.fromScene(room, .045);
      scene.environment = environment.texture;
      scene.environmentIntensity = .55;
      room.dispose();
      generator.dispose();
    } catch (error) {
      console.warn("[collision-lab] Environment lighting unavailable; using direct studio lights", error);
    }
    const texture = glowTexture();
    const overview = buildColliderOverview(scene, texture);
    const event = buildParticleEvent(scene, texture);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = .075;
    controls.rotateSpeed = .38;
    controls.minPolarAngle = .25;
    controls.maxPolarAngle = Math.PI * .76;
    renderer.domElement.style.touchAction = "pan-y";

    const overviewPosition = new THREE.Vector3(11.6, 10.8, 13.5);
    const closePosition = STATION.clone().add(new THREE.Vector3(6.9, 4.2, 10.8).multiplyScalar(EVENT_SCALE));
    const closeTarget = STATION.clone().add(new THREE.Vector3(1.45, .05, 0).multiplyScalar(EVENT_SCALE));
    const cameraPath = new THREE.CatmullRomCurve3([
      overviewPosition,
      new THREE.Vector3(10.3, 7.6, 10.2),
      new THREE.Vector3(7.55, 3.9, 6.5),
      new THREE.Vector3(5.55, 1.6, 3.45),
      closePosition,
    ], false, "catmullrom", .38);
    const lookPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(.25, .1, 0),
      new THREE.Vector3(2.2, .3, 0),
      new THREE.Vector3(4.55, .48, 0),
      STATION,
      closeTarget,
    ], false, "catmullrom", .3);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let renderedZoom = clamp(parameters.current.zoom, 0, 1);
    let lastAppliedZoom = -1;
    let visible = true;
    let failed = false;
    let disposed = false;
    let frame = 0;
    let elapsed = 0;
    let flowTime = 0;
    let beamTime = 0;
    let lastReportedStage = -1;
    let lastReplay = parameters.current.replayKey;
    let previous = performance.now();
    let firstFrame = true;
    let fit = 1;
    let aspect = 1;

    const positionCamera = () => {
      const position = cameraPath.getPoint(renderedZoom);
      const target = lookPath.getPoint(renderedZoom);
      const comparisonFit = 1 + renderedZoom * .22;
      position.sub(target).multiplyScalar(fit * comparisonFit).add(target);
      camera.position.copy(position);
      controls.target.copy(target);
      camera.lookAt(target);
      controls.update();
      lastAppliedZoom = renderedZoom;
    };
    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      aspect = width / height;
      fit = aspect < 1.25 ? Math.min(2.15, 1.65 / aspect) : 1;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      positionCamera();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: "140px" });
    intersection.observe(container);

    const keyboardOrbit = (keyboard: KeyboardEvent) => {
      if (!controls.enabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(keyboard.key)) return;
      keyboard.preventDefault();
      const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (keyboard.key === "ArrowLeft") orbit.theta -= .085;
      if (keyboard.key === "ArrowRight") orbit.theta += .085;
      if (keyboard.key === "ArrowUp") orbit.phi -= .085;
      if (keyboard.key === "ArrowDown") orbit.phi += .085;
      orbit.phi = clamp(orbit.phi, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.setFromSpherical(orbit).add(controls.target);
      controls.update();
    };
    container.addEventListener("keydown", keyboardOrbit);
    const contextLost = (loss: Event) => {
      loss.preventDefault();
      failed = true;
      cancelAnimationFrame(frame);
      renderer.domElement.style.visibility = "hidden";
      console.warn("[collision-lab] WebGL context lost; displaying the schematic preview");
      setStatus("fallback");
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    resize();

    const render = (now: number) => {
      if (failed || disposed) return;
      frame = requestAnimationFrame(render);
      // The first frame timestamp can precede initialization finishing.
      const delta = clamp((now - previous) / 1000, 0, .065);
      previous = now;
      if (!visible || document.hidden) return;
      const current = parameters.current;
      const requestedZoom = clamp(current.zoom, 0, 1);
      renderedZoom = motion.matches ? requestedZoom : THREE.MathUtils.damp(renderedZoom, requestedZoom, 12, delta);
      if (Math.abs(requestedZoom - renderedZoom) < .00008) renderedZoom = requestedZoom;
      if (Math.abs(lastAppliedZoom - renderedZoom) > .000001) positionCamera();
      controls.enabled = (renderedZoom < .003 || renderedZoom > .997) && Math.abs(requestedZoom - renderedZoom) < .001;
      controls.minPolarAngle = renderedZoom < .5 ? .25 : .4;
      controls.maxPolarAngle = renderedZoom < .5 ? 1.38 : 2.1;
      if (current.replayKey !== lastReplay) {
        elapsed = 0;
        flowTime = 0;
        lastReportedStage = -1;
        lastReplay = current.replayKey;
      }
      const targetTime = current.playAll ? STAGE_ENDS[3] : STAGE_ENDS[current.stage];
      if (renderedZoom > .96) {
        if (motion.matches) elapsed = targetTime;
        else if (!current.paused) elapsed = advanceTime(elapsed, targetTime, delta);
        if (current.playAll) {
          const activeStage = stageAtTime(elapsed);
          if (activeStage !== lastReportedStage) {
            lastReportedStage = activeStage;
            current.onStageChange(activeStage);
          }
        }
      }
      if (!current.paused && !motion.matches) {
        beamTime += delta;
        if (renderedZoom > .96) flowTime += delta;
      }
      try {
        overview.update(motion.matches ? 2.5 : beamTime, 1 - smooth(.58, .89, renderedZoom));
        event.update(elapsed, smooth(.35, .75, renderedZoom), flowTime, motion.matches);
        controls.update();
        renderer.render(scene, camera);
        if (renderedZoom > .96) {
          const anchors = event.comparisonAnchors();
          const bounds = container.getBoundingClientRect();
          for (const [anchor, callout, leader] of [
            [anchors.signal, signalLabel.current, signalLeader.current],
            [anchors.background, backgroundLabel.current, backgroundLeader.current],
          ] as const) {
            if (!callout || !leader) continue;
            const point = anchor.project(camera);
            const labelBounds = callout.getBoundingClientRect();
            leader.setAttribute("x1", String(labelBounds.left - bounds.left + labelBounds.width / 2));
            leader.setAttribute("y1", String(labelBounds.top - bounds.top + labelBounds.height / 2));
            leader.setAttribute("x2", String((point.x + 1) * bounds.width / 2));
            leader.setAttribute("y2", String((1 - point.y) * bounds.height / 2));
          }
        }
        if (firstFrame) {
          firstFrame = false;
          renderer.domElement.style.opacity = "1";
          setStatus("ready");
          current.onReady?.();
        }
      } catch (error) {
        failed = true;
        cancelAnimationFrame(frame);
        renderer.domElement.style.visibility = "hidden";
        console.warn("[collision-lab] 3D rendering failed; displaying the labelled schematic", error);
        setStatus("fallback");
      }
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      overview.dispose();
      controls.dispose();
      resizeObserver.disconnect();
      intersection.disconnect();
      container.removeEventListener("keydown", keyboardOrbit);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      disposeObject(scene);
      texture.dispose();
      environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} role="group" tabIndex={0} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label="Interactive schematic of the LHC and a detector cutaway. Pink follows a signal example and blue follows a QCD background example through collision, origin, shower and jet reconstruction. These are two illustrative examples, not one event. Use the zoom control and stage buttons; drag or use arrow keys to rotate. Geometry, particle sizes, and time are illustrative, not to scale." style={{ position: "relative", width: "100%", height: "100%", minHeight: 340, overflow: "hidden", outlineOffset: -4 }}>
    {status !== "ready" && <SceneFallback zoom={zoom} stage={stage} />}
    {zoom > .96 && <div key={status === "fallback" ? "fallback" : "scene"} className="jet-comparison-labels">
      <svg className="jet-leaders" aria-hidden="true">
        <defs>
          <marker id="signal-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#ff929d"/></marker>
          <marker id="background-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#86caff"/></marker>
        </defs>
        <line ref={signalLeader} x1="80%" y1="17%" x2={stage === 0 ? "46%" : "70%"} y2={stage === 0 ? "44%" : "35%"} stroke="#ff929d" strokeWidth="2" markerEnd="url(#signal-arrow)"/>
        <line ref={backgroundLeader} x1="80%" y1="79%" x2={stage === 0 ? "46%" : "70%"} y2={stage === 0 ? "54%" : "63%"} stroke="#86caff" strokeWidth="2" markerEnd="url(#background-arrow)"/>
      </svg>
      <div ref={signalLabel} className="jet-callout jet-callout-signal"><strong>Signal <span>(X → bb)</span></strong><span>{["Collision → X production", "X decays to b + b̄", "Both b branches form a shower", "Both branches grouped into one jet"][stage]}</span></div>
      <div ref={backgroundLabel} className="jet-callout jet-callout-background"><strong>QCD background</strong><span>{["Collision → quark or gluon", "Outgoing quark or gluon", "The quark or gluon forms a shower", "Particles grouped into one jet"][stage]}</span></div>
    </div>}
  </div>;
}

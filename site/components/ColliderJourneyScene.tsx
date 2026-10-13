"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildColliderOverview } from "./scene/collider-overview";
import { buildParticleEvent } from "./scene/particle-event";
import { clamp, disposeObject, EVENT_SCALE, glowTexture, smooth, STATION } from "./scene/scene-primitives";

type Props = {
  zoom: number;
  stage: number;
  paused: boolean;
  replayKey: number;
  onReady?: () => void;
};

function SceneFallback({ zoom, stage }: { zoom: number; stage: number }) {
  if (zoom < .55) return <Image unoptimized src="/collider-v2-poster.png" alt="Schematic cutaway of the Large Hadron Collider" width={1800} height={1100} draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />;
  return <svg viewBox="0 0 900 520" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
    <defs><radialGradient id="journey-fallback-glow"><stop stopColor="#ef5b61" stopOpacity=".21"/><stop offset="1" stopColor="#ef5b61" stopOpacity="0"/></radialGradient></defs>
    <ellipse cx="435" cy="270" rx="340" ry="230" fill="url(#journey-fallback-glow)"/>
    <g fill="none" strokeWidth="8" stroke="#b9c1c9" strokeOpacity=".6">
      {[235, 310, 385, 460, 535].map((x, index) => <ellipse key={x} cx={x} cy="260" rx="85" ry="170" stroke={index % 2 ? "#ef5b61" : undefined} />)}
    </g>
    <path d="M120 260H670" stroke="#e7e8e9" strokeWidth="2" strokeDasharray="4 7"/>
    <circle cx="380" cy="260" r="7" fill="#fff"/>
    {stage > 0 && <g fill="none" strokeWidth="3"><path d="M380 260L425 260L700 160" stroke="#ef5b61"/><path d="M425 260L710 320" stroke="#c6deeb"/></g>}
    {stage > 1 && <g fill="none" strokeWidth="1.5">{Array.from({ length: 24 }, (_, i) => <path key={i} d={`M${485 + i % 3 * 25} ${i < 12 ? 235 : 278}L${585 + i % 4 * 12} ${i < 12 ? 192 + i * 2 : 300 + i}L${720 + i % 3 * 12} ${120 + i * 10}`} stroke={i < 12 ? "#ef5b61" : "#c6deeb"} strokeOpacity=".7"/>)}</g>}
    {stage === 3 && <path d="M380 260L760 95A58 160 0 0 1 760 425Z" fill="#ef5b61" fillOpacity=".06" stroke="#ef5b61" strokeOpacity=".45"/>}
  </svg>;
}

export default function ColliderJourneyScene({ zoom, stage, paused, replayKey, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const parameters = useRef({ zoom, stage, paused, replayKey, onReady });
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  useEffect(() => { parameters.current = { zoom, stage, paused, replayKey, onReady }; }, [zoom, stage, paused, replayKey, onReady]);

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
    let beamTime = 0;
    let lastStage = parameters.current.stage;
    let lastReplay = parameters.current.replayKey;
    let previous = performance.now();
    let firstFrame = true;
    let fit = 1;
    let aspect = 1;

    const positionCamera = () => {
      const position = cameraPath.getPoint(renderedZoom);
      const target = lookPath.getPoint(renderedZoom);
      position.sub(target).multiplyScalar(fit).add(target);
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
      const delta = Math.min((now - previous) / 1000, .065);
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
      if (current.stage !== lastStage || current.replayKey !== lastReplay) {
        elapsed = 0;
        lastStage = current.stage;
        lastReplay = current.replayKey;
      }
      if (!current.paused && !motion.matches) {
        beamTime += delta;
        // Start the process as the close-up becomes readable, so the fly-in
        // never drops participants halfway through a decay sequence.
        if (renderedZoom > .86) elapsed += delta;
        else elapsed = 0;
      }
      overview.update(motion.matches ? 2.5 : beamTime, 1 - smooth(.58, .89, renderedZoom));
      event.update(elapsed, current.stage, smooth(.35, .75, renderedZoom), motion.matches);
      controls.update();
      renderer.render(scene, camera);
      if (firstFrame) {
        firstFrame = false;
        renderer.domElement.style.opacity = "1";
        setStatus("ready");
        current.onReady?.();
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

  return <div ref={host} role="img" tabIndex={0} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label="Interactive schematic of the LHC and a detector cutaway. Use the zoom control to enter the detector, then choose collision, decay, shower, or jet. Drag or use arrow keys to rotate the overview and close-up. Geometry, particle sizes, and time are illustrative, not to scale." style={{ position: "relative", width: "100%", height: "100%", minHeight: 340, overflow: "hidden", outlineOffset: -4 }}>
    {status !== "ready" && <SceneFallback zoom={zoom} stage={stage} />}
    {status === "fallback" && <span style={{ position: "absolute", left: 22, bottom: 20, fontSize: 12, color: "#d0d2d6", letterSpacing: ".025em" }}>Schematic preview · 3D unavailable on this device</span>}
  </div>;
}

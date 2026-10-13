"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type SceneMode = "ring" | "event";
type Props = { mode: SceneMode; stage?: number; paused?: boolean; className?: string };
type SceneAnimation = { update: (time: number, stage: number) => void; target: THREE.Vector3; dispose?: () => void };

const COPPER = 0xe5a45d;
const WHITE = 0xe1e5ea;
const graphite = () => new THREE.MeshStandardMaterial({ color: 0x24282c, metalness: 0.75, roughness: 0.36 });
const metal = () => new THREE.MeshStandardMaterial({ color: 0x959fa8, metalness: 0.82, roughness: 0.31 });
const copper = () => new THREE.MeshStandardMaterial({ color: COPPER, metalness: 0.72, roughness: 0.3 });

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function line(points: THREE.Vector3[], color: number, opacity: number, parent: THREE.Object3D) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const object = new THREE.Line(geometry, material);
  parent.add(object);
  return object;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, parent: THREE.Object3D) {
  const direction = b.clone().sub(a);
  const object = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 6), material, parent);
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return object;
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.14, "rgba(255,255,255,.8)");
    gradient.addColorStop(0.34, "rgba(255,255,255,.16)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

function halo(texture: THREE.Texture, color: number, size: number, parent: THREE.Object3D) {
  const material = new THREE.SpriteMaterial({ map: texture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  parent.add(sprite);
  return sprite;
}

function buildRing(scene: THREE.Scene, texture: THREE.Texture, onReady: () => void): SceneAnimation {
  const assembly = new THREE.Group();
  scene.add(assembly);
  assembly.rotation.y = -0.25;
  const steel = metal();
  const dark = graphite();
  const warm = copper();
  const radius = 5.05;
  const elevation = 0.52;

  // A deliberately schematic architectural model, not a survey of the CERN site.
  const foundation = mesh(new THREE.CylinderGeometry(6.3, 6.42, 0.26, 96), dark, assembly);
  foundation.position.y = -0.54;
  const ground = mesh(new THREE.CylinderGeometry(6.28, 6.3, 0.1, 96), new THREE.MeshStandardMaterial({ color: 0x33373a, roughness: 0.85 }), assembly);
  ground.position.y = -0.34;
  const baseEdge = mesh(new THREE.TorusGeometry(6.28, 0.015, 6, 128), steel, assembly);
  baseEdge.rotation.x = Math.PI / 2;
  baseEdge.position.y = -0.28;

  // Engraved contour lines and a survey grid add scale without claiming geography.
  for (let index = 0; index < 5; index++) {
    const points: THREE.Vector3[] = [];
    for (let step = 0; step <= 160; step++) {
      const angle = step / 160 * Math.PI * 2;
      const r = 2.3 + index * 0.5 + Math.sin(angle * 3 + index * 0.3) * 0.16 + Math.cos(angle * 5) * 0.09;
      points.push(new THREE.Vector3(Math.cos(angle) * r, -0.273, Math.sin(angle) * r));
    }
    line(points, 0x9ba5ad, 0.1, assembly);
  }
  for (let index = -5; index <= 5; index++) {
    const length = Math.sqrt(6.15 ** 2 - index ** 2);
    line([new THREE.Vector3(index, -0.272, -length), new THREE.Vector3(index, -0.272, length)], 0x9ba5ad, 0.055, assembly);
    line([new THREE.Vector3(-length, -0.272, index), new THREE.Vector3(length, -0.272, index)], 0x9ba5ad, 0.055, assembly);
  }

  // The open trough, segmented magnet housings and parallel beam pipes.
  const trough = mesh(new THREE.TorusGeometry(radius, 0.4, 12, 160), dark, assembly);
  trough.rotation.x = Math.PI / 2;
  trough.position.y = elevation - 0.13;
  const segmentCount = 96;
  const segmentGeometry = new THREE.TorusGeometry(radius, 0.225, 10, 3, Math.PI * 2 / segmentCount - 0.016);
  segmentGeometry.rotateX(Math.PI / 2);
  const magnets = new THREE.InstancedMesh(segmentGeometry, steel, segmentCount);
  magnets.castShadow = true;
  magnets.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < segmentCount; index++) {
    dummy.position.set(0, elevation, 0);
    dummy.rotation.set(0, index * Math.PI * 2 / segmentCount, 0);
    dummy.updateMatrix();
    magnets.setMatrixAt(index, dummy.matrix);
  }
  assembly.add(magnets);

  const bandGeometry = new THREE.TorusGeometry(radius, 0.247, 10, 2, 0.007);
  bandGeometry.rotateX(Math.PI / 2);
  const bands = new THREE.InstancedMesh(bandGeometry, warm, segmentCount);
  for (let index = 0; index < segmentCount; index++) {
    dummy.rotation.y = index * Math.PI * 2 / segmentCount;
    dummy.updateMatrix();
    bands.setMatrixAt(index, dummy.matrix);
  }
  assembly.add(bands);
  for (const offset of [-0.1, 0.1]) {
    const pipe = mesh(new THREE.TorusGeometry(radius + offset, 0.034, 6, 160), new THREE.MeshStandardMaterial({ color: offset > 0 ? COPPER : WHITE, emissive: offset > 0 ? COPPER : WHITE, emissiveIntensity: 0.58, roughness: 0.3, metalness: 0.5 }), assembly);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.y = elevation + 0.21;
  }

  const supports = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.7, 0.6), dark, 32);
  supports.castShadow = true;
  for (let index = 0; index < 32; index++) {
    const angle = index / 32 * Math.PI * 2;
    dummy.position.set(Math.cos(angle) * radius, -0.03, Math.sin(angle) * radius);
    dummy.rotation.set(0, -angle, 0);
    dummy.updateMatrix();
    supports.setMatrixAt(index, dummy.matrix);
  }
  assembly.add(supports);

  // Four distinct station assemblies suggest the major experiment sites.
  for (let index = 0; index < 4; index++) {
    const station = new THREE.Group();
    const angle = index / 4 * Math.PI * 2 + 0.35;
    station.position.set(Math.cos(angle) * radius, elevation, Math.sin(angle) * radius);
    station.rotation.y = -angle;
    assembly.add(station);
    const scale = [1.05, 0.72, 0.95, 0.62][index];
    station.scale.setScalar(scale);
    const platform = mesh(new THREE.BoxGeometry(1.7, 0.2, 2.0), dark, station);
    platform.position.y = -0.2;
    for (let slice = 0; slice < 7; slice++) {
      const disk = mesh(new THREE.TorusGeometry(0.57, slice === 0 || slice === 6 ? 0.14 : 0.1, 8, 24), slice % 3 === 0 ? warm : steel, station);
      disk.position.z = (slice - 3) * 0.18;
      disk.rotation.z = Math.PI / 8;
    }
    for (let rail = 0; rail < 8; rail++) {
      const phase = rail / 8 * Math.PI * 2;
      rod(new THREE.Vector3(Math.cos(phase) * 0.68, Math.sin(phase) * 0.68, -0.64), new THREE.Vector3(Math.cos(phase) * 0.68, Math.sin(phase) * 0.68, 0.64), 0.035, dark, station);
    }
    const shield = mesh(new THREE.BoxGeometry(0.56, 0.62, 0.74), dark, station);
    shield.position.set(-0.9, 0.1, 0.24);
    const vent = mesh(new THREE.BoxGeometry(0.57, 0.035, 0.75), steel, station);
    vent.position.set(-0.9, 0.425, 0.24);
    const light = halo(texture, COPPER, 0.46, station);
    light.position.set(0, 0.05, 0.8);
    const pole = rod(new THREE.Vector3(-0.9, 0.4, 0.2), new THREE.Vector3(-0.9, 1.0, 0.2), 0.017, steel, station);
    pole.castShadow = false;
    const tip = mesh(new THREE.SphereGeometry(0.035, 6, 6), new THREE.MeshBasicMaterial({ color: COPPER }), station);
    tip.position.set(-0.9, 1.0, 0.2);
  }

  // An understated above-ground campus, cryogenic equipment and transfer line.
  const campus = new THREE.Group();
  campus.position.set(-1.25, -0.18, -1.0);
  campus.rotation.y = -0.3;
  assembly.add(campus);
  const structures = [[0, 0, 1.4, 0.22, 0.54], [0.12, 0.7, 1.1, 0.18, 0.34], [-0.95, 0.45, 0.38, 0.35, 0.78], [0.9, 0.3, 0.38, 0.42, 0.8]];
  structures.forEach(([x, z, width, height, depth]) => {
    const building = mesh(new THREE.BoxGeometry(width, height, depth), steel, campus);
    building.position.set(x, height / 2, z);
    const roof = mesh(new THREE.BoxGeometry(width + 0.045, 0.025, depth + 0.045), dark, campus);
    roof.position.set(x, height + 0.02, z);
  });
  for (let index = 0; index < 4; index++) {
    const tank = mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.32, 12), steel, campus);
    tank.position.set(-0.55 + index * 0.3, 0.16, -0.63);
  }
  const transfer = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.4, -0.1, -1.5), new THREE.Vector3(-2.8, 0.05, -2.6), new THREE.Vector3(-4.0, 0.4, -3.0)]);
  mesh(new THREE.TubeGeometry(transfer, 24, 0.045, 6, false), warm, assembly);

  const beams: THREE.Sprite[] = [];
  const beamGroup = new THREE.Group();
  beamGroup.rotation.y = assembly.rotation.y;
  scene.add(beamGroup);
  for (let index = 0; index < 12; index++) beams.push(halo(texture, index < 6 ? COPPER : WHITE, index % 6 === 0 ? 0.48 : 0.2, beamGroup));

  // Geometry is authored and exported by scripts/render-collider.py in Blender.
  // The procedural assembly remains available if the local asset cannot load.
  let disposed = false;
  new GLTFLoader().load("/collider.glb", gltf => {
    if (disposed) {
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
        }
      });
      return;
    }
    gltf.scene.rotation.y = assembly.rotation.y;
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    scene.add(gltf.scene);
    assembly.visible = false;
    onReady();
  }, undefined, error => {
    if (disposed) return;
    console.warn("[collision-lab] Blender model could not load; using the built-in interactive schematic.", error);
    onReady();
  });
  return {
    target: new THREE.Vector3(0, 0.15, 0),
    dispose: () => { disposed = true; },
    update(time) {
      for (let index = 0; index < beams.length; index++) {
        const direction = index < 6 ? 1 : -1;
        const phase = direction * (time * 0.26 - (index % 6) * 0.042);
        const r = radius + direction * 0.1;
        beams[index].position.set(Math.cos(phase) * r, elevation + 0.24, Math.sin(phase) * r);
        (beams[index].material as THREE.SpriteMaterial).opacity = 1 - (index % 6) * 0.12;
      }
    },
  };
}

function buildEvent(scene: THREE.Scene, texture: THREE.Texture): SceneAnimation {
  const detector = new THREE.Group();
  scene.add(detector);
  const steel = metal();
  const dark = graphite();
  const warm = copper();
  const length = 4.0;

  // Beam travels along z; the displayed boosted decay is transverse to the beam.
  const barrelLayers = [{ r: 1.12, color: WHITE, alpha: 0.24 }, { r: 2.05, color: COPPER, alpha: 0.18 }, { r: 3.05, color: WHITE, alpha: 0.15 }];
  for (const layer of barrelLayers) {
    for (let slice = -4; slice <= 4; slice++) {
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 80; step++) {
        const angle = step / 80 * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * layer.r, Math.sin(angle) * layer.r, slice * 0.72));
      }
      line(points, layer.color, layer.alpha, detector);
    }
    for (let spoke = 0; spoke < 20; spoke++) {
      const angle = spoke / 20 * Math.PI * 2;
      line([new THREE.Vector3(Math.cos(angle) * layer.r, Math.sin(angle) * layer.r, -2.88), new THREE.Vector3(Math.cos(angle) * layer.r, Math.sin(angle) * layer.r, 2.88)], layer.color, layer.alpha * 0.5, detector);
    }
  }

  for (const sign of [-1, 1]) {
    const endcap = new THREE.Group();
    endcap.position.z = sign * 3.1;
    detector.add(endcap);
    for (let layer = 0; layer < 3; layer++) {
      const ring = mesh(new THREE.TorusGeometry(2.95 + layer * 0.13, layer === 1 ? 0.095 : 0.048, 8, 64), layer === 1 ? dark : steel, endcap);
      ring.position.z = sign * layer * 0.13;
    }
    const inner = mesh(new THREE.TorusGeometry(1.14, 0.027, 6, 64), warm, endcap);
    inner.position.z = -sign * 0.09;
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2;
      const detectorModule = mesh(new THREE.BoxGeometry(0.27, 0.14, 0.35), index % 4 === 0 ? warm : dark, endcap);
      detectorModule.position.set(Math.cos(angle) * 3.08, Math.sin(angle) * 3.08, 0);
      detectorModule.rotation.z = angle - Math.PI / 2;
    }
  }
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2;
    // Leave the front quarter visually open, as in a museum cutaway.
    if (index === 0 || index === 1) continue;
    rod(new THREE.Vector3(Math.cos(angle) * 3.15, Math.sin(angle) * 3.15, -3.15), new THREE.Vector3(Math.cos(angle) * 3.15, Math.sin(angle) * 3.15, 3.15), 0.045, dark, detector);
  }
  const beamline = line([new THREE.Vector3(0, 0, -6), new THREE.Vector3(0, 0, 6)], WHITE, 0.2, detector);
  beamline.renderOrder = 2;
  for (const sign of [-1, 1]) {
    const tube = mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 12), steel, detector);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = sign * 4.35;
  }

  const protons = [-1, 1].map(sign => {
    const group = new THREE.Group();
    detector.add(group);
    const core = mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: sign > 0 ? COPPER : WHITE }), group);
    core.castShadow = false;
    halo(texture, sign > 0 ? COPPER : WHITE, 0.65, group);
    return group;
  });
  const collision = new THREE.Group();
  detector.add(collision);
  const collisionGlow = halo(texture, 0xffe2b2, 1.5, collision);
  const collisionCore = mesh(new THREE.IcosahedronGeometry(0.07, 1), new THREE.MeshBasicMaterial({ color: 0xffefd4 }), collision);
  collisionCore.castShadow = false;

  const decay = new THREE.Group();
  detector.add(decay);
  const branches = new THREE.Group();
  detector.add(branches);
  const hadrons = new THREE.Group();
  detector.add(hadrons);
  const pointPositions: number[] = [];
  const pointColors: number[] = [];
  const branchMaterials: THREE.LineBasicMaterial[] = [];
  const amber = new THREE.Color(COPPER);
  const white = new THREE.Color(WHITE);

  // Two nearby axes and a shared envelope depict substructure of one boosted jet.
  const axes = [new THREE.Vector3(1, 0.38, 0.08).normalize(), new THREE.Vector3(1, -0.24, -0.12).normalize()];
  axes.forEach((axis, axisIndex) => {
    const color = axisIndex === 0 ? COPPER : WHITE;
    const endpoint = axis.clone().multiplyScalar(4.9);
    line([new THREE.Vector3(), endpoint], color, 0.88, decay);
    const node = halo(texture, color, 0.48, decay);
    node.position.copy(axis).multiplyScalar(1.4);
    for (let track = 0; track < 26; track++) {
      const seed = track * 2.39996 + axisIndex * 0.93;
      const spread = Math.sqrt((track + 1) / 26) * 0.45;
      const end = endpoint.clone().add(new THREE.Vector3(Math.sin(seed * 1.31) * 0.45, Math.cos(seed) * spread, Math.sin(seed) * spread));
      const midpoint = axis.clone().multiplyScalar(1.1 + (track % 5) * 0.15);
      midpoint.add(new THREE.Vector3(0, Math.cos(seed) * 0.12, Math.sin(seed) * 0.12));
      const split = midpoint.clone().lerp(end, 0.42);
      split.add(new THREE.Vector3(0, Math.sin(seed * 1.7) * 0.08, Math.cos(seed * 1.9) * 0.08));
      const trackLine = line([new THREE.Vector3(), midpoint, split, end], color, 0.21 + (track % 4) * 0.11, branches);
      branchMaterials.push(trackLine.material);
      for (let hit = 0; hit < 3; hit++) {
        const position = split.clone().lerp(end, 0.44 + hit * 0.25);
        position.x += Math.sin(seed + hit) * 0.06;
        pointPositions.push(position.x, position.y, position.z);
        const pointColor = axisIndex === 0 ? amber : white;
        pointColors.push(pointColor.r, pointColor.g, pointColor.b);
      }
    }
  });

  const envelope = new THREE.Group();
  detector.add(envelope);
  const cone = mesh(new THREE.ConeGeometry(1.82, 5.7, 64, 1, true), new THREE.MeshBasicMaterial({ color: COPPER, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }), envelope);
  cone.rotation.z = Math.PI / 2;
  cone.position.x = 2.85;
  cone.castShadow = false;
  const rimPoints: THREE.Vector3[] = [];
  for (let step = 0; step <= 96; step++) {
    const angle = step / 96 * Math.PI * 2;
    rimPoints.push(new THREE.Vector3(5.7, Math.cos(angle) * 1.82, Math.sin(angle) * 1.82));
  }
  line(rimPoints, COPPER, 0.32, envelope);
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    line([new THREE.Vector3(), new THREE.Vector3(5.7, Math.cos(angle) * 1.82, Math.sin(angle) * 1.82)], COPPER, 0.11, envelope);
  }
  const hits = new THREE.BufferGeometry();
  hits.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
  hits.setAttribute("color", new THREE.Float32BufferAttribute(pointColors, 3));
  hadrons.add(new THREE.Points(hits, new THREE.PointsMaterial({ size: 0.07, map: texture, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  // Faint balancing activity: an event is not only the selected signal jet.
  const recoil = new THREE.Group();
  detector.add(recoil);
  for (let track = 0; track < 17; track++) {
    const angle = track * 2.4;
    const endpoint = new THREE.Vector3(-3.5 - Math.cos(angle) * 0.4, Math.cos(angle) * 0.65, Math.sin(angle) * 1.2);
    line([new THREE.Vector3(), endpoint], 0xa7afb5, 0.1, recoil);
  }

  return {
    target: new THREE.Vector3(0.65, 0, 0),
    update(time, rawStage) {
      const stage = Math.max(0, Math.min(3, rawStage));
      const travel = 1 - (time * 0.2 % 1);
      protons.forEach((proton, index) => {
        proton.visible = stage === 0;
        proton.position.z = (index === 0 ? -1 : 1) * (0.1 + travel * (length + 1.8));
      });
      collision.visible = stage > 0;
      collisionGlow.scale.setScalar(stage === 1 ? 1.4 + Math.sin(time * 2.1) * 0.12 : 0.72);
      decay.visible = stage >= 1;
      branches.visible = stage >= 2;
      hadrons.visible = stage >= 3;
      envelope.visible = stage >= 3;
      recoil.visible = stage >= 2;
      branchMaterials.forEach((material, index) => { material.opacity = 0.2 + (index % 4) * 0.1 + Math.sin(time * 0.8 + index) * 0.035; });
    },
  };
}

function Fallback({ mode }: { mode: SceneMode }) {
  if (mode === "ring") {
    return <Image unoptimized src="/collider-poster.png" alt="" width={1600} height={850} draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />;
  }
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      <svg viewBox="0 0 800 460" aria-hidden="true" style={{ width: "100%", height: "100%", maxHeight: 600 }}>
        <defs><radialGradient id={`scene-glow-${mode}`}><stop stopColor="#e5a45d" stopOpacity=".13"/><stop offset="1" stopColor="#e5a45d" stopOpacity="0"/></radialGradient></defs>
        <ellipse cx="400" cy="260" rx="310" ry="175" fill={`url(#scene-glow-${mode})`}/>
        <g fill="none" stroke="#858d96" strokeOpacity=".4">
          {[200, 265, 330, 395, 460, 525, 590].map((x) => <ellipse key={x} cx={x} cy="230" rx="75" ry="140"/>)}
          <path d="M125 230H680" strokeDasharray="5 6"/>
          {Array.from({ length: 18 }, (_, index) => <path key={index} d={`M390 230L${660 + (index % 4) * 8} ${110 + index * 12}`} stroke={index < 9 ? "#e5a45d" : "#e1e5ea"} strokeOpacity=".6"/>)}
        </g>
      </svg>
    </div>
  );
}

function ColliderSceneRenderer({ mode, stage = 0, paused = false, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parametersRef = useRef({ stage, paused });
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => { parametersRef.current = { stage, paused }; }, [stage, paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let failed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (error) {
      console.warn("[collision-lab] WebGL unavailable; showing the schematic fallback.", error);
      let mounted = true;
      queueMicrotask(() => { if (mounted) setStatus("fallback"); });
      return () => { mounted = false; };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.setClearColor(0x0b0c0e, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = mode === "ring";
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:pan-y;";
    if (mode === "ring") renderer.domElement.style.opacity = "0";
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(mode === "ring" ? 36 : 40, 1, 0.1, 80);
    camera.position.set(mode === "ring" ? 11.8 : 8.0, mode === "ring" ? 10.8 : 5.0, mode === "ring" ? 13.3 : 11.5);
    scene.add(new THREE.HemisphereLight(0xdfebf5, 0x17191a, 2.1));
    const key = new THREE.DirectionalLight(0xfff0df, 3.3);
    key.position.set(-5, 11, 8);
    key.castShadow = mode === "ring";
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -9;
    key.shadow.camera.right = key.shadow.camera.top = 9;
    key.shadow.normalBias = 0.04;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb6c9d9, 2.5);
    rim.position.set(8, 3, -7);
    scene.add(rim);
    const softbox = new THREE.DirectionalLight(0xffffff, 1.0);
    softbox.position.set(-8, 1, -3);
    scene.add(softbox);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    room.dispose();
    pmrem.dispose();
    const texture = glowTexture();
    const animation = mode === "ring" ? buildRing(scene, texture, () => {
      if (failed) return;
      renderer.domElement.style.opacity = "1";
      setStatus("ready");
    }) : buildEvent(scene, texture);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(animation.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = 0.45;
    controls.minPolarAngle = mode === "ring" ? 0.4 : 0.55;
    controls.maxPolarAngle = mode === "ring" ? 1.38 : 2.3;
    controls.autoRotate = false;
    controls.update();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let frame = 0;
    let elapsed = 3.5;
    let previous = performance.now();
    let firstFrameRendered = false;
    const initialDistance = camera.position.distanceTo(controls.target);
    const rotateWithKeyboard = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (event.key === "ArrowLeft") orbit.theta -= 0.09;
      if (event.key === "ArrowRight") orbit.theta += 0.09;
      if (event.key === "ArrowUp") orbit.phi -= 0.09;
      if (event.key === "ArrowDown") orbit.phi += 0.09;
      orbit.phi = Math.max(controls.minPolarAngle, Math.min(controls.maxPolarAngle, orbit.phi));
      camera.position.setFromSpherical(orbit).add(controls.target);
      controls.update();
    };
    container.addEventListener("keydown", rotateWithKeyboard);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const fit = width / height < 1.2
        ? Math.min(1.65, 1.2 / (width / height))
        : mode === "ring" && width / height > 1.8 ? 0.78 : 1;
      camera.position.sub(controls.target).normalize().multiplyScalar(initialDistance * fit).add(controls.target);
      controls.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: "120px" });
    intersection.observe(container);
    const loseContext = (event: Event) => {
      event.preventDefault();
      failed = true;
      cancelAnimationFrame(frame);
      renderer.domElement.style.visibility = "hidden";
      console.warn("[collision-lab] WebGL context lost; showing the schematic fallback.");
      setStatus("fallback");
    };
    renderer.domElement.addEventListener("webglcontextlost", loseContext);
    resize();

    const render = (now: number) => {
      if (failed) return;
      frame = requestAnimationFrame(render);
      const delta = Math.min((now - previous) / 1000, 0.06);
      previous = now;
      if (!visible || document.hidden) return;
      const frozen = parametersRef.current.paused || motion.matches;
      if (!frozen) elapsed += delta;
      animation.update(elapsed, parametersRef.current.stage);
      controls.update();
      renderer.render(scene, camera);
      if (mode === "event" && !firstFrameRendered) {
        firstFrameRendered = true;
        setStatus("ready");
      }
    };
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      controls.dispose();
      animation.dispose?.();
      container.removeEventListener("keydown", rotateWithKeyboard);
      renderer.domElement.removeEventListener("webglcontextlost", loseContext);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) geometries.add(object.geometry);
        if ("material" in object) {
          const value = object.material as THREE.Material | THREE.Material[];
          (Array.isArray(value) ? value : [value]).forEach(material => materials.add(material));
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      texture.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [mode]);

  return (
    <div ref={containerRef} className={className} role="img" tabIndex={0} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label={mode === "ring" ? "Interactive schematic model of a circular particle accelerator with four detector stations. Drag or use arrow keys to rotate." : "Interactive schematic of a particle detector: collision, hypothetical X to bottom-quark pair decay, and two subjets inside one boosted jet. Drag or use arrow keys to rotate."} style={{ position: "relative", width: "100%", height: "100%", minHeight: 340, overflow: "hidden", outlineOffset: -4 }}>
      {status !== "ready" && <Fallback mode={mode} />}
      {status === "fallback" && <span style={{ position: "absolute", bottom: 18, left: 24, fontSize: 11, letterSpacing: "0.1em", color: "#aaaeb3", textTransform: "uppercase" }}>Schematic preview · 3D unavailable on this device</span>}
    </div>
  );
}

export default function ColliderScene(props: Props) {
  return <ColliderSceneRenderer key={props.mode} {...props} />;
}

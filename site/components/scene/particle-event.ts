import * as THREE from "three";
import { buildQcdJet } from "./qcd-jet";
import { addGlow, addLine, addMesh, clamp, EVENT_SCALE, ICE, RED, smooth, STATION, trail, type Trail, WHITE } from "./scene-primitives";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function detectorShell(root: THREE.Group) {
  const titanium = new THREE.MeshStandardMaterial({ color: 0x768795, metalness: 0.73, roughness: 0.38 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xaab4be, metalness: 0.6, roughness: 0.39 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2f3a46, metalness: 0.62, roughness: 0.48 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb1293e, metalness: 0.35, roughness: 0.4 });
  const mutedRed = new THREE.MeshStandardMaterial({ color: 0x74303d, metalness: 0.55, roughness: 0.46 });
  const start = 1.38;
  const arc = Math.PI * 2 - 1.82;

  // A museum cutaway: solid, segmented calorimeter and magnet layers, with the
  // upper-right sector removed to make the interaction and selected jet visible.
  const layerSpecs = [
    { radius: 1.06, thickness: 0.016, material: dark },
    { radius: 1.27, thickness: 0.034, material: titanium },
    { radius: 1.69, thickness: 0.21, material: red },
    { radius: 2.03, thickness: 0.12, material: titanium },
    { radius: 2.37, thickness: 0.2, material: mutedRed },
    { radius: 2.86, thickness: 0.17, material: dark },
    { radius: 3.13, thickness: 0.055, material: pale },
  ];
  for (const [layerIndex, layer] of layerSpecs.entries()) {
    for (const z of [-2.5, -1.68, -0.84, 0, 0.84, 1.68, 2.5]) {
      const ring = addMesh(new THREE.TorusGeometry(layer.radius, layer.thickness, 7, 56, arc), layer.material, root);
      ring.rotation.z = start;
      ring.position.z = z;
    }
    if (layerIndex === 0 || layerIndex === 3 || layerIndex === 6) {
      const count = layerIndex === 0 ? 18 : 24;
      const geometry = new THREE.BoxGeometry(layerIndex === 0 ? 0.018 : 0.047, layerIndex === 0 ? 0.018 : 0.07, 5.0);
      const bars = new THREE.InstancedMesh(geometry, layer.material, count);
      const dummy = new THREE.Object3D();
      for (let index = 0; index < count; index++) {
        const angle = start + arc * index / (count - 1);
        dummy.position.set(Math.cos(angle) * layer.radius, Math.sin(angle) * layer.radius, 0);
        dummy.rotation.z = angle;
        dummy.updateMatrix();
        bars.setMatrixAt(index, dummy.matrix);
      }
      root.add(bars);
    }
  }

  // Long calorimeter blocks alternate red and graphite, separated by visible
  // assembly gaps. Instancing keeps the detailed barrel inexpensive to draw.
  for (const [radius, material, width, depth] of [[1.67, red, 0.2, 0.31], [2.39, mutedRed, 0.32, 0.31], [2.88, dark, 0.38, 0.28]] as const) {
    const count = 27;
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(width, depth, 4.76), material, count);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < count; index++) {
      const angle = start + arc * (index + 0.5) / count;
      dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      dummy.rotation.z = angle - Math.PI / 2;
      dummy.updateMatrix();
      blocks.setMatrixAt(index, dummy.matrix);
    }
    root.add(blocks);
  }

  for (const z of [-2.76, 2.76]) {
    for (let index = 0; index < 3; index++) {
      const ring = addMesh(new THREE.TorusGeometry(2.92, 0.14, 4, 16, arc), index === 1 ? red : titanium, root);
      ring.position.z = z + (index - 1) * 0.17;
      ring.rotation.z = start;
    }
    // Radial endcap segments expose the detector's nested structure.
    const disk = addMesh(new THREE.RingGeometry(1.3, 2.69, 40, 1, start, arc), new THREE.MeshStandardMaterial({ color: 0x8c9ca9, metalness: 0.68, roughness: 0.48, side: THREE.DoubleSide }), root);
    disk.position.z = z - Math.sign(z) * 0.2;
    for (let index = 0; index < 20; index++) {
      const angle = start + index / 19 * arc;
      addLine([V(Math.cos(angle) * 1.31, Math.sin(angle) * 1.31, disk.position.z + .004), V(Math.cos(angle) * 2.69, Math.sin(angle) * 2.69, disk.position.z + .004)], 0x303b45, 0.64, root);
    }
  }
  // Open tracker volumes and a narrow central beam pipe are deliberately light.
  for (const radius of [.39, .64, .87]) {
    for (const z of [-2.25, -1.5, -.75, 0, .75, 1.5, 2.25]) {
      const points = Array.from({ length: 73 }, (_, i) => V(Math.cos(start + i / 72 * arc) * radius, Math.sin(start + i / 72 * arc) * radius, z));
      addLine(points, ICE, .1, root);
    }
  }
  addLine([V(0, 0, -6), V(0, 0, 6)], WHITE, .23, root);
  for (const side of [-1, 1]) {
    const tube = addMesh(new THREE.CylinderGeometry(.065, .065, 2.2, 12), titanium, root);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = side * 4.15;
    for (const z of [3.1, 3.6, 4.6]) {
      const flange = addMesh(new THREE.TorusGeometry(.12, .023, 6, 20), red, root);
      flange.position.z = side * z;
    }
  }
  // Small mechanical feet anchor the cutaway, avoiding a floating wireframe.
  for (const x of [-1.48, 1.48]) for (const z of [-1.9, 1.9]) {
    const foot = addMesh(new THREE.BoxGeometry(.24, .59, .59), dark, root);
    foot.position.set(x, -3.17, z);
  }
}

/** Two pedagogical examples share one detector view and one absolute clock. */
export function buildParticleEvent(scene: THREE.Scene, texture: THREE.Texture) {
  const root = new THREE.Group();
  root.name = "particle-event";
  root.position.copy(STATION);
  root.scale.setScalar(EVENT_SCALE);
  scene.add(root);
  const shell = new THREE.Group();
  shell.name = "detector-shell";
  root.add(shell);
  detectorShell(shell);
  const process = new THREE.Group();
  process.name = "collision-examples";
  root.add(process);

  const bunches = [-1, 1].map((sign, index) => {
    const group = new THREE.Group();
    group.name = `incoming-bunch-${index}`;
    process.add(group);
    for (let particle = 0; particle < 9; particle++) {
      const angle = particle * 2.4;
      const sprite = addGlow(texture, index ? ICE : RED, particle ? .18 : .5, group);
      sprite.position.set(particle ? Math.cos(angle) * .07 : 0, particle ? Math.sin(angle) * .07 : 0, particle * .085 * sign);
    }
    return group;
  });
  const flash = addGlow(texture, WHITE, 1.4, process);
  const redFlash = addGlow(texture, RED, 2.3, process);
  const impact = addMesh(new THREE.SphereGeometry(.033, 12, 12), new THREE.MeshBasicMaterial({ color: WHITE }), process);
  const impactWave = addMesh(new THREE.TorusGeometry(.5, .012, 5, 56), new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, depthWrite: false }), process);

  // The final comparison orientation is established once. Every subsequent
  // step reveals the same curves without rotating or rescaling either example.
  const signal = new THREE.Group();
  signal.name = "signal-example";
  signal.rotation.z = .52;
  signal.scale.setScalar(.86);
  process.add(signal);
  const X = addGlow(texture, RED, .68, signal);
  X.name = "signal-x";
  const stem = trail([V(), V(.37, .025, 0), V(.88, .03, 0)], RED, .036, texture, signal);
  stem.mesh.name = "signal-stem";
  const origin = V(.88, .03, 0);
  const axes = [V(1, .30, .03).normalize(), V(1, -.28, -.09).normalize()];
  const roots = axes.map((axis, index) => {
    const path = trail([origin, origin.clone().addScaledVector(axis, 1.1), origin.clone().addScaledVector(axis, 4.25)], index ? 0xff7f9a : RED, .036, texture, signal);
    path.mesh.name = `signal-root-${index}`;
    return path;
  });

  const showerGroup = new THREE.Group();
  showerGroup.name = "signal-shower";
  signal.add(showerGroup);
  const branches: { path: Trail; start: number; end: number }[] = [];
  const leaves: { curve: THREE.CatmullRomCurve3; color: THREE.Color; phase: number }[] = [];
  for (let family = 0; family < 2; family++) {
    const axis = axes[family];
    const color = family ? 0xff7f9a : RED;
    const first = origin.clone().addScaledVector(axis, 1.05);
    for (let branch = 0; branch < 3; branch++) {
      const angle = branch * 2.3 + family * .7;
      const middle = origin.clone().addScaledVector(axis, 2.35).add(V(0, Math.cos(angle) * .28, Math.sin(angle) * .3));
      branches.push({ path: trail([first, first.clone().lerp(middle, .46).add(V(0, .06, -.05)), middle], color, .014, texture, showerGroup), start: 4 + branch * .065, end: 4.85 + branch * .065 });
      for (let twig = 0; twig < 4; twig++) {
        const seed = family * 11 + branch * 4 + twig;
        const phase = seed * 2.399963;
        const end = origin.clone().addScaledVector(axis, 4.45 + Math.sin(seed * 1.7) * .32).add(V(0, Math.cos(phase) * (.26 + twig * .08), Math.sin(phase) * (.25 + twig * .08)));
        const fork = middle.clone().lerp(end, .46).add(V(0, Math.sin(seed) * .08, Math.cos(seed) * .08));
        branches.push({ path: trail([middle, fork, end], color, .010 + twig % 2 * .002, texture, showerGroup), start: 4.85 + branch * .09 + twig * .07, end: 6.7 + branch * .15 + twig * .2 });
        leaves.push({ curve: new THREE.CatmullRomCurve3([first, middle, fork, end]), color: new THREE.Color(color), phase: seed * .173 });
      }
    }
  }

  // The two pink branches belong to ONE boosted X → b b̄ jet. Constituents
  // follow fixed curves; their optional decorative flow has its own clock.
  const count = leaves.length * 8;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  leaves.forEach((leaf, index) => {
    for (let dot = 0; dot < 8; dot++) leaf.color.toArray(colors, (index * 8 + dot) * 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const particles = new THREE.Points(geometry, new THREE.PointsMaterial({ size: .115, map: texture, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  particles.name = "signal-constituents";
  signal.add(particles);

  // Reconstruction adds a boundary around the existing shower. This envelope
  // never grows, changes the trajectories, or moves the particles into place.
  const envelope = new THREE.Group();
  envelope.name = "signal-envelope";
  signal.add(envelope);
  const cone = addMesh(new THREE.ConeGeometry(2.02, 5.92, 64, 1, true), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }), envelope);
  cone.rotation.z = Math.PI / 2;
  cone.position.x = 2.96;
  const rim = addLine(Array.from({ length: 97 }, (_, i) => V(5.92, Math.cos(i / 96 * Math.PI * 2) * 2.02, Math.sin(i / 96 * Math.PI * 2) * 2.02)), RED, 0, envelope);
  const edges = [.2, 1.9, 3.4, 5.1].map(angle => addLine([V(), V(5.92, Math.cos(angle) * 2.02, Math.sin(angle) * 2.02)], RED, 0, envelope));
  const background = buildQcdJet(process, texture);
  let currentTime = 0;

  return {
    root,
    comparisonAnchors() {
      root.updateWorldMatrix(true, true);
      const stemExtent = .2 + smooth(1.4, 2.4, currentTime) * .68;
      const signalExtent = stemExtent + smooth(2.4, 4, currentTime) * (4.65 - .88);
      const backgroundExtent = .2 + smooth(1.4, 4, currentTime) * 4.45;
      return {
        signal: signal.localToWorld(V(signalExtent, .03, 0)),
        background: background.root.localToWorld(V(backgroundExtent, 0, 0)),
      };
    },
    update(time: number, reveal: number, flowTime: number, reducedMotion: boolean) {
      const t = clamp(time, 0, 9.6);
      currentTime = t;
      root.visible = reveal > .01;
      background.update(t, flowTime, reducedMotion);
      const arrival = 1.4;
      bunches.forEach((bunch, index) => {
        bunch.visible = t < arrival;
        bunch.position.z = (index ? -1 : 1) * (6.1 * (1 - smooth(0, arrival, t)) + .04);
      });
      const flashPower = Math.exp(-Math.max(0, t - arrival) * 4.5) * Number(t >= arrival);
      flash.material.opacity = flashPower;
      flash.scale.setScalar(.8 + (1 - flashPower) * 2.3);
      redFlash.material.opacity = flashPower * .62;
      impact.visible = t >= arrival;
      impactWave.visible = t >= arrival && t < arrival + 1.4;
      impactWave.scale.setScalar(.05 + Math.max(0, t - arrival) * 2.25);
      (impactWave.material as THREE.MeshBasicMaterial).opacity = flashPower * .55;

      const stemProgress = smooth(arrival, 2.4, t);
      stem.reveal(stemProgress, .9);
      X.visible = t >= arrival && t < 2.4;
      X.position.copy(stem.curve.getPoint(stemProgress));
      X.material.opacity = 1 - smooth(2.25, 2.4, t);
      const rootProgress = smooth(2.4, 4, t);
      roots.forEach(path => path.reveal(rootProgress, .72));
      showerGroup.visible = t > 4;
      branches.forEach(({ path, start, end }) => path.reveal(smooth(start, end, t), .82));

      particles.visible = t > 4.85;
      particles.material.opacity = smooth(4.85, 6.8, t);
      const maxProgress = smooth(4.85, 7.6, t);
      leaves.forEach((leaf, index) => {
        for (let dot = 0; dot < 8; dot++) {
          const phase = flowTime * .16 + leaf.phase + dot / 8;
          const flow = reducedMotion ? (dot + 1) / 8 : phase - Math.floor(phase);
          const point = leaf.curve.getPoint(flow * maxProgress);
          point.y += Math.sin(dot * 3 + index) * .04;
          point.z += Math.cos(dot * 3 + index) * .04;
          point.toArray(positions, (index * 8 + dot) * 3);
        }
      });
      geometry.attributes.position.needsUpdate = true;
      const boundaryOpacity = smooth(8, 9.2, t);
      envelope.visible = boundaryOpacity > 0;
      cone.material.opacity = boundaryOpacity * .052;
      rim.material.opacity = boundaryOpacity * .5;
      edges.forEach(edge => { edge.material.opacity = boundaryOpacity * .2; });
    },
  };
}

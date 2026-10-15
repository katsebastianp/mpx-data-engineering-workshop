import * as THREE from "three";
import { addLine, addMesh, smooth, trail } from "./scene-primitives";

const BLUE = 0x69baff;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** An ordinary quark/gluon jet develops alongside the separate signal example. */
export function buildQcdJet(parent: THREE.Group, texture: THREE.Texture) {
  const root = new THREE.Group();
  root.name = "qcd-example";
  // Keep the entire cone inside the detector cutaway's open sector.
  root.rotation.z = .10;
  parent.add(root);
  const axis = trail([V(), V(1.7, 0, 0), V(5.6, .05, 0)], BLUE, .027, texture, root);
  axis.mesh.name = "qcd-axis";
  const shower = new THREE.Group();
  shower.name = "qcd-shower";
  root.add(shower);
  const branches = Array.from({ length: 16 }, (_, branch) => {
    const angle = branch * 2.399963;
    const radius = .24 + (branch % 5) * .14;
    const fork = V(1.2 + (branch % 4) * .45, 0, 0);
    const end = V(5.2 + Math.sin(branch) * .35, Math.cos(angle) * radius, Math.sin(angle) * radius);
    return {
      path: trail([fork, fork.clone().lerp(end, .48).add(V(0, Math.cos(angle) * .15, 0)), end], BLUE, .012, texture, shower),
      start: 4 + (branch % 4) * .12,
      end: 6.7 + (branch % 4) * .3,
    };
  });
  const envelope = new THREE.Group();
  envelope.name = "qcd-envelope";
  root.add(envelope);
  const cone = addMesh(new THREE.ConeGeometry(1.13, 5.8, 48, 1, true), new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }), envelope);
  cone.rotation.z = Math.PI / 2;
  cone.position.x = 2.9;
  const rim = addLine(Array.from({ length: 65 }, (_, i) => V(5.8, Math.cos(i / 64 * Math.PI * 2) * 1.13, Math.sin(i / 64 * Math.PI * 2) * 1.13)), BLUE, 0, envelope);
  const edges = [0, Math.PI].map(angle => addLine([V(), V(5.8, Math.cos(angle) * 1.13, Math.sin(angle) * 1.13)], BLUE, 0, envelope));

  const paths = [axis, ...branches.map(branch => branch.path)];
  const positions = new Float32Array(paths.length * 7 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: BLUE, size: .13, map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  particles.name = "qcd-constituents";
  root.add(particles);
  return {
    root,
    update(time: number, flowTime: number, reducedMotion: boolean) {
      root.visible = time >= 1.4;
      axis.reveal(smooth(1.4, 4, time), .95);
      shower.visible = time > 4;
      branches.forEach(({ path, start, end }) => path.reveal(smooth(start, end, time), .95));
      particles.visible = time > 4.85;
      particles.material.opacity = smooth(4.85, 6.8, time);
      const maxProgress = smooth(4.85, 7.6, time);
      paths.forEach((path, index) => {
        for (let dot = 0; dot < 7; dot++) {
          const phase = flowTime * .16 + index * .137 + dot / 7;
          const flow = reducedMotion ? (dot + 1) / 7 : phase - Math.floor(phase);
          path.curve.getPoint(flow * maxProgress).toArray(positions, (index * 7 + dot) * 3);
        }
      });
      geometry.attributes.position.needsUpdate = true;
      const boundaryOpacity = smooth(8, 9.2, time);
      envelope.visible = boundaryOpacity > 0;
      cone.material.opacity = boundaryOpacity * .075;
      rim.material.opacity = boundaryOpacity * .8;
      edges.forEach(edge => { edge.material.opacity = boundaryOpacity * .45; });
    },
  };
}

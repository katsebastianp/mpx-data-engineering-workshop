import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { addGlow, addMesh, disposeObject, ICE, RED, STATION, WHITE } from "./scene-primitives";

export function buildColliderOverview(scene: THREE.Scene, texture: THREE.Texture) {
  const root = new THREE.Group();
  scene.add(root);
  const placeholder = new THREE.Group();
  root.add(placeholder);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aaebd, metalness: .8, roughness: .34 });
  const red = new THREE.MeshStandardMaterial({ color: 0xcc4d55, metalness: .55, roughness: .36 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x46505a, metalness: .25, roughness: .8 });
  const land = addMesh(new THREE.CylinderGeometry(6.22, 6.35, .3, 96), dark, placeholder);
  land.position.y = -.19;
  const tunnel = addMesh(new THREE.TorusGeometry(5.05, .135, 12, 192), steel, placeholder);
  tunnel.rotation.x = Math.PI / 2;
  tunnel.position.y = .52;
  for (const radius of [4.98, 5.12]) {
    const beamline = addMesh(new THREE.TorusGeometry(radius, .015, 5, 160), new THREE.MeshBasicMaterial({ color: radius < 5 ? RED : ICE }), placeholder);
    beamline.rotation.x = Math.PI / 2;
    beamline.position.y = .66;
  }
  const bands = new THREE.InstancedMesh(new THREE.BoxGeometry(.29, .29, .035), red, 112);
  const matrix = new THREE.Object3D();
  for (let i = 0; i < 112; i++) {
    const phase = i / 112 * Math.PI * 2;
    matrix.position.set(Math.cos(phase) * 5.05, .52, Math.sin(phase) * 5.05);
    matrix.rotation.y = -phase;
    matrix.updateMatrix();
    bands.setMatrixAt(i, matrix.matrix);
  }
  placeholder.add(bands);
  for (let i = 0; i < 4; i++) {
    const station = new THREE.Group();
    const angle = i / 4 * Math.PI * 2;
    station.position.set(Math.cos(angle) * 5.05, .52, Math.sin(angle) * 5.05);
    station.rotation.y = -angle;
    for (let ring = 0; ring < 5; ring++) {
      const disk = addMesh(new THREE.TorusGeometry(.37, .06, 6, 16), ring % 2 ? steel : red, station);
      disk.position.z = (ring - 2) * .12;
    }
    placeholder.add(station);
  }

  const materials = new Map<THREE.Material, number>();
  function collect(object: THREE.Object3D) {
    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          materials.set(material, material.opacity);
          material.transparent = true;
        }
      }
    });
  }
  collect(placeholder);
  let disposed = false;
  new GLTFLoader().load("/collider-v2.glb", gltf => {
    if (disposed) {
      disposeObject(gltf.scene);
      return;
    }
    // Blender exports in this coordinate system: XZ ring, Y-up, selected
    // detector at (5.05, .52, 0), tangent / beam direction along Z.
    collect(gltf.scene);
    root.add(gltf.scene);
    placeholder.visible = false;
  }, undefined, error => {
    if (!disposed) console.warn("[collision-lab] Collider asset unavailable; using the interactive built-in model", error);
  });

  const beamGroup = new THREE.Group();
  scene.add(beamGroup);
  const beams = Array.from({ length: 16 }, (_, index) => addGlow(texture, index < 8 ? RED : ICE, index % 8 ? .13 : .39, beamGroup));
  const targetGlow = addGlow(texture, RED, .7, beamGroup);
  targetGlow.position.copy(STATION).add(new THREE.Vector3(0, .17, 0));
  const marker = addMesh(new THREE.TorusGeometry(.48, .009, 5, 64), new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: .6, depthWrite: false }), beamGroup);
  marker.position.copy(STATION);

  return {
    update(time: number, opacity: number) {
      root.visible = opacity > .002;
      beamGroup.visible = opacity > .002;
      materials.forEach((base, material) => {
        material.opacity = base * opacity;
        material.depthWrite = opacity > .97;
      });
      beams.forEach((beam, index) => {
        const direction = index < 8 ? 1 : -1;
        const angle = direction * (time * .43 - index % 8 * .016);
        const radius = 5.05 + direction * .065;
        beam.position.set(Math.cos(angle) * radius, .67, Math.sin(angle) * radius);
        beam.material.opacity = (1 - index % 8 * .10) * opacity;
      });
      targetGlow.material.opacity = (.46 + Math.sin(time * 1.5) * .09) * opacity;
      marker.material.opacity = .52 * opacity;
    },
    dispose() { disposed = true; },
  };
}

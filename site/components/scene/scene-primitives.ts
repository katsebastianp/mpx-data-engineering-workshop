import * as THREE from "three";

export const RED = 0xf15f67;
export const WHITE = 0xf4eee6;
export const ICE = 0xb3cbdc;
export const STATION = new THREE.Vector3(5.05, 0.52, 0);
export const EVENT_SCALE = 0.13;
export const clamp = THREE.MathUtils.clamp;
export const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);

export function addMesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
  const object = new THREE.Mesh(geometry, material);
  parent.add(object);
  return object;
}

export function addLine(points: THREE.Vector3[], color: number, opacity: number, parent: THREE.Object3D) {
  const material = new THREE.LineBasicMaterial({ color, opacity, transparent: true, depthWrite: false });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
  parent.add(line);
  return line;
}

export function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(48, 48, 0, 48, 48, 48);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.08, "rgba(255,255,255,.95)");
    gradient.addColorStop(0.22, "rgba(255,255,255,.4)");
    gradient.addColorStop(0.52, "rgba(255,255,255,.065)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 96, 96);
  }
  return new THREE.CanvasTexture(canvas);
}

export function addGlow(texture: THREE.Texture, color: number, size: number, parent: THREE.Object3D) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.scale.setScalar(size);
  parent.add(sprite);
  return sprite;
}

export function label(text: string, color: string, parent: THREE.Object3D, width = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 112;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = "500 50px ui-monospace, SFMono-Regular, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    context.fillText(text, 192, 56);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(width, width * 112 / 384, 1);
  sprite.renderOrder = 8;
  parent.add(sprite);
  return sprite;
}

export type Trail = {
  curve: THREE.CatmullRomCurve3;
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  head: THREE.Sprite;
  reveal: (progress: number, alpha?: number) => void;
};

export function trail(points: THREE.Vector3[], color: number, radius: number, texture: THREE.Texture, parent: THREE.Object3D): Trail {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 36, radius, 5, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  const head = addGlow(texture, color, radius * 24, parent);
  const indexCount = geometry.index?.count ?? 0;
  return {
    curve, mesh, head,
    reveal(progress, alpha = 1) {
      const amount = clamp(progress, 0, 1);
      mesh.visible = amount > 0;
      // Keep complete tube cross sections while progressively drawing the path.
      geometry.setDrawRange(0, Math.floor(indexCount * amount / 30) * 30);
      material.opacity = alpha * 0.74;
      head.visible = progress > 0 && progress < 1.12;
      head.position.copy(curve.getPoint(amount));
      head.material.opacity = alpha;
    },
  };
}

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) geometries.add(object.geometry);
    if ("material" in object) {
      const value = object.material as THREE.Material | THREE.Material[];
      (Array.isArray(value) ? value : [value]).forEach(material => {
        materials.add(material);
        for (const entry of Object.values(material)) if (entry instanceof THREE.Texture) textures.add(entry);
      });
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

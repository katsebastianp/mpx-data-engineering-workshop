import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as THREE from "three";
import ts from "typescript";

// Exercise the real Three scene without a browser/WebGL renderer. Canvas is
// used only for the text labels; particle and trajectory geometry remains real.
const site = fileURLToPath(new URL("../", import.meta.url));
const originalDocument = globalThis.document;
let output;
let event;
let scene;
let disposeObject;
let timeline;

before(async () => {
  output = await mkdtemp(path.join(tmpdir(), "collision-scene-test-"));
  await symlink(path.join(site, "node_modules"), path.join(output, "node_modules"));
  for (const name of ["scene-primitives", "event-timeline", "qcd-jet", "particle-event"]) {
    const input = await readFile(path.join(site, "components/scene", `${name}.ts`), "utf8");
    const result = ts.transpileModule(input, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    await writeFile(path.join(output, `${name}.mjs`), result.outputText.replace(/from ["']\.\/([^"'.]+)["']/g, 'from "./$1.mjs"'));
  }
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      return { width: 0, height: 0, getContext: () => ({ fillText() {} }) };
    },
  };
  const { buildParticleEvent } = await import(pathToFileURL(path.join(output, "particle-event.mjs")).href);
  ({ disposeObject } = await import(pathToFileURL(path.join(output, "scene-primitives.mjs")).href));
  timeline = await import(pathToFileURL(path.join(output, "event-timeline.mjs")).href);
  scene = new THREE.Scene();
  event = buildParticleEvent(scene, new THREE.Texture());
});

after(async () => {
  if (scene) disposeObject(scene);
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (output) await rm(output, { recursive: true, force: true });
});

function named(name) {
  const object = event.root.getObjectByName(name);
  assert.ok(object, `Missing scene object: ${name}`);
  return object;
}

function effectivelyVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function frame(time, flowTime = 2.5, reducedMotion = false) {
  event.update(time, 1, flowTime, reducedMotion);
  event.root.updateMatrixWorld(true);
}

function snapshot(object, omitEnvelopes = false) {
  if (omitEnvelopes && object.name.endsWith("-envelope")) return null;
  const materials = object.material ? [].concat(object.material) : [];
  return {
    name: object.name,
    type: object.type,
    visible: object.visible,
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
    opacity: materials.map(material => material.opacity),
    drawRange: object.geometry ? { ...object.geometry.drawRange } : null,
    particles: object.isPoints ? Array.from(object.geometry.attributes.position.array) : null,
    children: object.children.map(child => snapshot(child, omitEnvelopes)).filter(Boolean),
  };
}

function fixedTrajectories() {
  const result = [];
  for (const name of ["signal-example", "qcd-example"]) {
    const group = named(name);
    result.push({ name, matrix: group.matrixWorld.toArray() });
    group.traverse(object => {
      if (object.geometry?.type === "TubeGeometry") {
        result.push({
          name: object.name,
          matrix: object.matrixWorld.toArray(),
          positions: Array.from(object.geometry.attributes.position.array),
        });
      }
    });
  }
  return result;
}

test("playback and seeking move continuously through the same four stages", () => {
  const { STAGE_ENDS, stageAtTime, advanceTime } = timeline;
  assert.equal(STAGE_ENDS.length, 4);
  assert.deepEqual(STAGE_ENDS.map(end => stageAtTime(end - .0001)), [0, 1, 2, 3]);
  assert.deepEqual(STAGE_ENDS.map(end => stageAtTime(end)), [1, 2, 3, 3]);
  assert.equal(advanceTime(2, 8, -1), 2, "A negative frame delta must not move playback");
  for (const [start, target] of [[0, STAGE_ENDS[3]], [STAGE_ENDS[3], 0]]) {
    let time = start;
    for (let index = 0; index < 200; index++) {
      const next = advanceTime(time, target, 20);
      assert.ok(Math.abs(next - time) <= .065 + Number.EPSILON * 8, "A delayed frame must not skip a stage");
      assert.ok(Math.abs(target - next) <= Math.abs(target - time), "Seeking must move toward its target");
      assert.ok(next >= Math.min(start, target) && next <= Math.max(start, target), "Seeking must not overshoot");
      time = next;
    }
    assert.equal(time, target);
    assert.equal(advanceTime(time, target, .016), target, "Completed playback must hold its last frame");
  }
});

test("both examples develop before the jet reconstruction stage", () => {
  frame(1.8);
  for (const name of ["signal-stem", "qcd-axis"]) {
    const path = named(name);
    assert.ok(effectivelyVisible(path), `${name} should be present after the collision`);
    assert.ok(path.geometry.drawRange.count > 0, `${name} should have a visible outgoing trajectory`);
  }
  frame(7.6);
  for (const name of ["signal-constituents", "qcd-constituents"]) {
    const particles = named(name);
    assert.ok(effectivelyVisible(particles), `${name} must appear during the shower, before the jet stage`);
    assert.ok(particles.material.opacity > .4, `${name} must be legible during the shower`);
    const coordinates = particles.geometry.attributes.position.array;
    assert.ok(Math.max(...coordinates) - Math.min(...coordinates) > 1, `${name} must form a developed shower`);
  }
  for (const name of ["signal-envelope", "qcd-envelope"]) {
    assert.equal(effectivelyVisible(named(name)), false, `${name} must wait for reconstruction`);
  }
});

test("signal and QCD retain their positions and trajectories through every stage and reverse seek", () => {
  frame(0);
  const original = fixedTrajectories();
  frame(4);
  const originalAnchors = event.comparisonAnchors();
  for (const time of [1.8, 4, 7.6, 8, 9.6, 4, 0, 9.6]) {
    frame(time);
    assert.deepEqual(fixedTrajectories(), original, `A trajectory or example moved at time ${time}`);
    if (time >= 4) {
      const anchors = event.comparisonAnchors();
      assert.deepEqual(anchors.signal.toArray(), originalAnchors.signal.toArray());
      assert.deepEqual(anchors.background.toArray(), originalAnchors.background.toArray());
    }
  }
});

test("the final stage adds jet boundaries to the existing showers without replacing particles", () => {
  frame(8);
  const completedShowers = ["signal-example", "qcd-example"].map(name => snapshot(named(name), true));
  for (const name of ["signal-envelope", "qcd-envelope"]) {
    assert.equal(effectivelyVisible(named(name)), false, `${name} must start hidden`);
  }
  frame(9.6);
  assert.deepEqual(["signal-example", "qcd-example"].map(name => snapshot(named(name), true)), completedShowers);
  for (const name of ["signal-envelope", "qcd-envelope"]) {
    const envelope = named(name);
    assert.ok(effectivelyVisible(envelope), `${name} must be visible after reconstruction`);
    assert.ok(envelope.children.some(child => child.material?.opacity > 0), `${name} must render a boundary`);
  }
});

test("replay and out-of-order seeking produce the same frame with finite geometry", () => {
  for (const reducedMotion of [false, true]) {
    const times = [0, 1.8, 4, 7.6, 8, 9.6];
    const expected = new Map();
    for (const time of times) {
      frame(time, 2.5, reducedMotion);
      expected.set(time, snapshot(event.root));
    }
    for (const time of [...times].reverse().concat(times)) {
      frame(time, 2.5, reducedMotion);
      assert.deepEqual(snapshot(event.root), expected.get(time), `History-dependent frame at ${time}, reducedMotion=${reducedMotion}`);
      event.root.traverse(object => {
        assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${object.name || object.type} has an invalid transform`);
        if (object.isPoints) {
          assert.ok(object.geometry.attributes.position.array.every(Number.isFinite), `${object.name} has invalid particle positions`);
        }
      });
    }
  }
});

test("reduced motion shows both complete jets without constituent animation", () => {
  frame(9.6, 0, true);
  const still = snapshot(event.root);
  frame(9.6, 100, true);
  assert.deepEqual(snapshot(event.root), still, "Reduced-motion particles must not move with flow time");
  for (const name of ["signal-constituents", "qcd-constituents", "signal-envelope", "qcd-envelope"]) {
    assert.ok(effectivelyVisible(named(name)), `${name} must remain visible in reduced-motion mode`);
  }
});

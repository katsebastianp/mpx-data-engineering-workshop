"""Create Collision Lab's original Blender model, interactive GLB and poster.

Run from the site root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/render-collider.py

This is an authored scientific illustration, not a surveyed model of CERN.
Ring geometry, the four detector stations and the campus are deliberately schematic.
No downloaded models, textures, or generative images are used.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence
from pathlib import Path
import logging
import math
import bpy
from mathutils import Vector

logging.basicConfig(level=logging.INFO, format="[collider] %(message)s")
ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ASSETS = ROOT / "assets"
PUBLIC.mkdir(exist_ok=True)
ASSETS.mkdir(exist_ok=True)


def material(
    name: str,
    color: tuple[float, float, float],
    metallic: float = 0.0,
    roughness: float = 0.4,
    emission: float = 0.0,
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    return result


def finish(obj: bpy.types.Object, name: str, mat: bpy.types.Material, bevel: float = 0.0) -> bpy.types.Object:
    obj.name = name
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if bevel:
        mod = obj.modifiers.new("Machined edge", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
    return obj


def cube(
    name: str,
    position: tuple[float, float, float],
    size: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.025,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, name, mat, bevel)
    if parent:
        obj.parent = parent
    return obj


def cylinder(
    name: str,
    position: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    vertices: int = 64,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=position)
    obj = finish(bpy.context.object, name, mat, 0.012)
    if parent:
        obj.parent = parent
    return obj


def torus(
    name: str,
    radius: float,
    tube: float,
    position: tuple[float, float, float],
    mat: bpy.types.Material,
    segments: int = 128,
    sides: int = 10,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=sides, location=position, major_radius=radius, minor_radius=tube)
    obj = finish(bpy.context.object, name, mat)
    if parent:
        obj.parent = parent
    return obj


def path(
    name: str,
    points: Sequence[tuple[float, float, float]],
    thickness: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = thickness
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for item, point in zip(spline.points, points):
        item.co = (*point, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def arcs(
    name: str,
    count: int,
    radius: float,
    tube: float,
    z: float,
    arc_fraction: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]]
    faces: list[tuple[int, ...]]
    vertices, faces = [], []
    nlong, ncross = 5, 12
    for segment in range(count):
        start = len(vertices)
        for along in range(nlong + 1):
            theta = math.tau * (segment + along / nlong * arc_fraction) / count
            for around in range(ncross):
                phi = math.tau * around / ncross
                r = radius + tube * math.cos(phi)
                vertices.append((r * math.cos(theta), r * math.sin(theta), z + tube * math.sin(phi)))
        for along in range(nlong):
            for around in range(ncross):
                a = start + along * ncross + around
                b = start + along * ncross + (around + 1) % ncross
                faces.append((a, b, b + ncross, a + ncross))
        faces.append(tuple(start + around for around in reversed(range(ncross))))
        faces.append(tuple(start + nlong * ncross + around for around in range(ncross)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def area(
    name: str,
    position: tuple[float, float, float],
    power: float,
    color: tuple[float, float, float],
    size: float,
    target: tuple[float, float, float] = (0, 0, 0),
) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    graphite = material("Graphite · satin anodised", (0.065, 0.073, 0.082), 0.7, 0.36)
    stone = material("Basalt · honed", (0.028, 0.034, 0.040), 0.15, 0.62)
    steel = material("Steel · brushed", (0.34, 0.41, 0.47), 0.88, 0.3)
    pale = material("Aluminium · bead blasted", (0.57, 0.62, 0.64), 0.78, 0.26)
    copper = material("Copper · warm", (0.72, 0.34, 0.12), 0.84, 0.26)
    beam_a = material("Counter-rotating beam A", (0.96, 0.56, 0.23), 0.25, 0.3, 1.8)
    beam_b = material("Counter-rotating beam B", (0.68, 0.81, 0.91), 0.25, 0.3, 1.4)
    engraving = material("Survey engraving", (0.14, 0.17, 0.20), 0.2, 0.7)

    # Raised architectural model: its elevation explicitly reveals the ring.
    cylinder("Basalt foundation", (0, 0, -0.54), 6.3, 0.26, stone, 128)
    cylinder("Graphite terrain plane", (0, 0, -0.36), 6.27, 0.08, graphite, 128)
    torus("Foundation reveal", 6.285, 0.014, (0, 0, -0.46), copper)
    torus("Top perimeter", 6.265, 0.012, (0, 0, -0.305), steel)
    for i in range(6):
        points = []
        for step in range(161):
            angle = step / 160 * math.tau
            r = 1.4 + i * 0.52 + math.sin(angle * 3 + i * 0.3) * 0.14 + math.cos(angle * 5) * 0.09
            points.append((math.cos(angle) * r, math.sin(angle) * r, -0.305))
        path(f"Schematic contour {i:02}", points, 0.008, engraving)
    for i in range(-5, 6):
        length = math.sqrt(6.1 ** 2 - i ** 2)
        path(f"Survey x {i}", [(i, -length, -0.307), (i, length, -0.307)], 0.004, engraving)
        path(f"Survey y {i}", [(-length, i, -0.307), (length, i, -0.307)], 0.004, engraving)

    radius, z = 5.05, 0.52
    torus("Open tunnel foundation", radius, 0.33, (0, 0, 0.25), graphite, 192, 16)
    arcs("96 superconducting magnet housings", 96, radius, 0.235, z, 0.81, steel)
    arcs("96 copper expansion couplings", 96, radius, 0.244, z, 0.08, copper)
    for index in range(32):
        angle = index / 32 * math.tau
        support = cube(f"Support {index:02}", (math.cos(angle) * radius, math.sin(angle) * radius, -0.03), (0.58, 0.1, 0.57), graphite, 0.025)
        support.rotation_euler.z = angle
    torus("Beam A · clockwise", radius - 0.10, 0.029, (0, 0, 0.738), beam_a, 192, 8)
    torus("Beam B · anticlockwise", radius + 0.10, 0.026, (0, 0, 0.738), beam_b, 192, 8)

    for index in range(4):
        angle = index / 4 * math.tau + 0.35
        station = bpy.data.objects.new(f"Experiment station {index + 1} · schematic", None)
        bpy.context.collection.objects.link(station)
        station.location = (math.cos(angle) * radius, math.sin(angle) * radius, z)
        station.rotation_euler.z = angle
        scale = [1.05, 0.74, 0.98, 0.68][index]
        station.scale = (scale, scale, scale)
        cube("Experiment platform", (0, 0, -0.28), (1.72, 2.05, 0.20), graphite, 0.07, station)
        for layer in range(9):
            ring = torus(f"Detector yoke {index}/{layer}", 0.57, 0.11 if layer in [0, 4, 8] else 0.085, (0, (layer - 4) * 0.145, 0), copper if layer in [0, 4, 8] else pale, 32, 10, station)
            ring.rotation_euler.x = math.pi / 2
        for rail in range(8):
            phase = rail / 8 * math.tau
            path("Detector longitudinal rail", [(math.cos(phase) * 0.68, -0.69, math.sin(phase) * 0.68), (math.cos(phase) * 0.68, 0.69, math.sin(phase) * 0.68)], 0.04, graphite, station)
        for side in [-1, 1]:
            box = cube("Service equipment", (side * 0.94, 0.15, -0.04), (0.4, 0.82, 0.51), graphite, 0.03, station)
            for vent in range(5):
                cube("Cooling fin", (side * 0.94, -0.12 + vent * 0.13, 0.227), (0.39, 0.026, 0.02), steel, 0.006, station)
        path("Instrument mast", [(-0.96, 0.2, 0.23), (-0.96, 0.2, 1.05)], 0.018, pale, station)
        cylinder("Instrument marker", (-0.96, 0.2, 1.08), 0.035, 0.055, beam_a, 12, station)

    campus = bpy.data.objects.new("Schematic surface campus", None)
    bpy.context.collection.objects.link(campus)
    campus.location = (-0.7, 0.5, -0.275)
    campus.rotation_euler.z = -0.3
    for index, (x, y, width, depth, height) in enumerate([(0, 0, 1.55, 0.5, 0.23), (0.15, 0.72, 1.24, 0.4, 0.18), (-1.03, 0.42, 0.39, 0.83, 0.40), (0.96, 0.33, 0.42, 0.82, 0.32)]):
        cube(f"Campus building {index}", (x, y, height / 2), (width, depth, height), pale, 0.025, campus)
        cube("Flat roof", (x, y, height + 0.02), (width + 0.035, depth + 0.035, 0.035), graphite, 0.012, campus)
        for window in range(max(2, round(width / 0.16))):
            cube("Window panel", (x - width / 2 + 0.09 + window * 0.16, y - depth / 2 - 0.006, height / 2), (0.074, 0.012, height * 0.4), graphite, 0.003, campus)
    for index in range(4):
        cylinder(f"Cryogenic plant vessel {index}", (-0.5 + index * 0.29, -0.64, 0.15), 0.095, 0.31, steel, 24, campus)
    path("Schematic transfer line", [(-1.3, 1.1, -0.06), (-2.1, 1.8, 0.02), (-3, 2.9, 0.15), (-3.9, 3.1, 0.45)], 0.044, copper)
    for distance in [0.7, 1.15]:
        torus("Injector loop", distance, 0.026, (1.5, -1.2, -0.20), steel, 64, 6)

    # Export only authored geometry; studio lighting and camera remain in .blend.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.convert(target="MESH")
    bpy.ops.export_scene.gltf(filepath=str(PUBLIC / "collider.glb"), export_format="GLB", use_selection=True, export_apply=True, export_cameras=False, export_lights=False, export_yup=True)
    logging.info("Exported interactive Blender geometry to public/collider.glb")

    area("Key · large softbox", (-4, -6, 11), 1900, (1.0, 0.87, 0.71), 8)
    area("Rim · cool strip", (4, 6, 7), 2400, (0.66, 0.8, 1.0), 6)
    area("Fill · broad", (9, -2, 4), 1300, (1.0, 0.97, 0.92), 7)
    area("Copper rim", (-8, 1, 3), 700, (1.0, 0.54, 0.23), 4)
    world = bpy.data.worlds.new("Dark studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.14, 0.16, 0.19, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.30
    bpy.context.scene.world = world

    bpy.ops.object.camera_add(location=(11.8, -15.0, 12.8))
    camera = bpy.context.object
    camera.name = "Editorial isometric camera"
    camera.rotation_euler = (Vector((0, 0, 0.05)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 16.6
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 850
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(PUBLIC / "collider-poster.png")
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.5
    scene["provenance"] = "Original Collision Lab illustration. Authored procedurally in Blender with scripts/render-collider.py. No external models or textures."
    scene["scientific_scope"] = "LHC-inspired schematic. Station locations, structures, dimensions, contour lines and distances are illustrative."
    bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS / "collider.blend"))
    logging.info("Saved assets/collider.blend; rendering 1600×850 with Cycles CPU, 40 samples")
    bpy.ops.render.render(write_still=True)
    logging.info("Render complete: %s", scene.render.filepath)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.exception("Blender collider generation failed")
        raise

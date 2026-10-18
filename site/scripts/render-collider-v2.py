"""Author the LHC-inspired cutaway used by Collision Lab.

Run from the site root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/render-collider-v2.py

An original, schematic architectural illustration; geography, dimensions, campus
and experimental stations are deliberately illustrative rather than surveyed.
GLB contract: Y up; ring radius 5.05, elevation .52; chosen detector (5.05,.52,0),
axis Z. No external geometry, images or textures are used.
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

logging.basicConfig(level=logging.INFO, format="[collider-v2] %(message)s")
ROOT = Path(__file__).resolve().parents[1]
PUBLIC, ASSETS = ROOT / 'public', ROOT / 'assets'
RADIUS, BEAM_Z = 5.05, .52
MATS = {}


def material(
    name: str,
    color: tuple[float, float, float],
    metallic: float = 0,
    roughness: float = .55,
    emission: float = 0,
) -> bpy.types.Material:
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    s=mat.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value=(*color,1)
    s.inputs['Metallic'].default_value=metallic
    s.inputs['Roughness'].default_value=roughness
    if emission:
        s.inputs['Emission Color'].default_value=(*color,1)
        s.inputs['Emission Strength'].default_value=emission
    MATS[name]=mat
    return mat


def finish(obj: bpy.types.Object, name: str, mat: bpy.types.Material, smooth: bool = False) -> bpy.types.Object:
    obj.name=name; obj.data.materials.append(mat)
    if smooth:
        for poly in obj.data.polygons: poly.use_smooth=True
    return obj


def mesh(
    name: str,
    verts: Sequence[tuple[float, float, float]],
    faces: Sequence[tuple[int, ...]],
    mat: bpy.types.Material,
    smooth: bool = False,
) -> bpy.types.Object:
    data=bpy.data.meshes.new(name); data.from_pydata(verts,[],faces); data.update()
    ob=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(ob)
    return finish(ob,name,mat,smooth)


def cube(
    name: str,
    pos: tuple[float, float, float],
    size: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = .015,
    angle: float = 0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    obj=bpy.context.object; obj.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.rotation_euler.z=angle
    finish(obj,name,mat)
    if bevel:
        mod=obj.modifiers.new('Architectural edges','BEVEL'); mod.width=bevel; mod.segments=2
        mod=obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
    return obj


def path(
    name: str,
    points: Sequence[tuple[float, float, float]],
    radius: float,
    mat: bpy.types.Material,
    sides: int = 0,
) -> bpy.types.Object:
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=1
    c.bevel_depth=radius; c.bevel_resolution=sides
    s=c.splines.new('POLY'); s.points.add(len(points)-1)
    for p,v in zip(s.points,points): p.co=(*v,1)
    ob=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat)
    return ob


def cylinder(
    name: str,
    pos: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    vertices: int = 16,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=pos)
    return finish(bpy.context.object,name,mat,True)


def terrain_height(x: float, y: float) -> float:
    # A gently rolling terrain, with a deliberately opened accelerator trench.
    hills=(.50*math.exp(-((x+4.8)**2/5+(y-4.8)**2/2.5))
        +.42*math.exp(-((x+1.3)**2/7+(y-5.2)**2/1.8))
        +.32*math.exp(-((x-4.8)**2/4+(y-4.8)**2/3)))
    waves=.025*math.sin(x*.6+y*.4)+.018*math.cos(y*.9-x*.3)
    trench=1-math.exp(-((math.hypot(x,y)-RADIUS)/.23)**4)
    return .13+(hills+waves+.08)*trench


def terrain(mat: bpy.types.Material, edge_mat: bpy.types.Material) -> None:
    nx,ny=100,92; xmin,xmax,ymin,ymax=-6.9,6.9,-6.1,6.1
    verts=[(xmin+(xmax-xmin)*i/nx,ymin+(ymax-ymin)*j/ny,terrain_height(xmin+(xmax-xmin)*i/nx,ymin+(ymax-ymin)*j/ny)) for j in range(ny+1) for i in range(nx+1)]
    faces=[]
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i; faces.extend([(a,a+1,a+nx+2),(a,a+nx+2,a+nx+1)])
    mesh('Survey terrain with opened ring trench',verts,faces,mat,True)
    edge=[]
    edge += [verts[i] for i in range(nx+1)]
    edge += [verts[j*(nx+1)+nx] for j in range(1,ny+1)]
    edge += [verts[ny*(nx+1)+i] for i in reversed(range(nx))]
    edge += [verts[j*(nx+1)] for j in reversed(range(1,ny))]
    evert=edge+[(x,y,-.20) for x,y,z in edge]; n=len(edge)
    mesh('Exposed upper geological cut',evert,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],edge_mat)


def contours(mat: bpy.types.Material) -> None:
    # Contours follow the actual authored elevation; they are not claims of surveyed geography.
    n,m=68,60; dx,dy=13.4/n,11.8/m
    grid=[[-6.7+i*dx for i in range(n+1)],[-5.9+j*dy for j in range(m+1)]]
    for level in [.23,.27,.31,.35,.40,.45,.51,.57,.63,.70]:
        segments=[]
        for j in range(m):
            for i in range(n):
                corners=[(grid[0][i],grid[1][j]),(grid[0][i+1],grid[1][j]),(grid[0][i+1],grid[1][j+1]),(grid[0][i],grid[1][j+1])]
                vals=[terrain_height(*p)-level for p in corners]; hits=[]
                for a,b in [(0,1),(1,2),(2,3),(3,0)]:
                    if vals[a]*vals[b]<0:
                        t=vals[a]/(vals[a]-vals[b]); x=corners[a][0]+(corners[b][0]-corners[a][0])*t; y=corners[a][1]+(corners[b][1]-corners[a][1])*t
                        if abs(math.hypot(x,y)-RADIUS)>.32: hits.append((x,y,level+.009))
                if len(hits)==2: segments.append(hits)
        # one curve object for each contour level, many small splines
        c=bpy.data.curves.new('Elevation contour','CURVE'); c.dimensions='3D'; c.bevel_depth=.0055; c.bevel_resolution=0
        for segment in segments:
            s=c.splines.new('POLY'); s.points.add(1)
            for p,v in zip(s.points,segment): p.co=(*v,1)
        ob=bpy.data.objects.new(f'Contour {level:.2f}',c); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat)


def magnet_segments(mat: bpy.types.Material, coupling: bpy.types.Material) -> None:
    vertices: list[tuple[float, float, float]]
    faces: list[tuple[int, ...]]
    cv: list[tuple[float, float, float]]
    cf: list[tuple[int, ...]]
    n=144; vertices=[]; faces=[]; cv=[]; cf=[]
    for idx in range(n):
        angle=(idx+.5)/n*math.tau
        # Four physical gaps reveal the experimental stations.
        if min(abs((angle-k*math.pi/2+math.pi)%math.tau-math.pi) for k in range(4)) < .112: continue
        for target_v,target_f,frac,offset,r in [(vertices,faces,.83,.085,.075),(cv,cf,.06,.03,.081)]:
            start=len(target_v); sides=10; along=3
            for a in range(along+1):
                theta=(idx+offset+frac*a/along)/n*math.tau
                for s in range(sides):
                    phi=s/sides*math.tau
                    target_v.append(((RADIUS+r*math.cos(phi))*math.cos(theta),(RADIUS+r*math.cos(phi))*math.sin(theta),BEAM_Z+r*math.sin(phi)))
            for a in range(along):
                for s in range(sides):
                    v=start+a*sides+s; vn=start+a*sides+(s+1)%sides
                    target_f.append((v,vn,vn+sides,v+sides))
            target_f.extend([tuple(start+s for s in reversed(range(sides))),tuple(start+along*sides+s for s in range(sides))])
    mesh('Segmented superconducting cryostats',vertices,faces,mat,True)
    mesh('Cryogenic expansion collars',cv,cf,coupling,True)


def station_point(angle: float, p: tuple[float, float, float]) -> tuple[float, float, float]:
    x,y,z=p
    return (RADIUS*math.cos(angle)+x*math.cos(angle)-y*math.sin(angle),RADIUS*math.sin(angle)+x*math.sin(angle)+y*math.cos(angle),BEAM_Z+z)


def station_arc(
    name: str,
    angle: float,
    radius: float,
    tube: float,
    y: float,
    start: float,
    end: float,
    mat: bpy.types.Material,
    segments: int = 36,
) -> None:
    pts=[station_point(angle,(radius*math.cos(start+(end-start)*i/segments),y,radius*math.sin(start+(end-start)*i/segments))) for i in range(segments+1)]
    path(name,pts,tube,mat,1)


def station_shell(
    name: str,
    angle: float,
    radius: float,
    thickness: float,
    halfdepth: float,
    start: float,
    end: float,
    mat: bpy.types.Material,
) -> None:
    n=36; verts=[]; faces=[]
    for y in [-halfdepth,halfdepth]:
        for r in [radius-thickness,radius]:
            for i in range(n+1):
                a=start+(end-start)*i/n; verts.append(station_point(angle,(r*math.cos(a),y,r*math.sin(a))))
    stride=n+1
    for i in range(n):
        faces.extend([(i,i+1,i+1+2*stride,i+2*stride),(i+stride,i+3*stride,i+3*stride+1,i+stride+1),(i,i+stride,i+stride+1,i+1),(i+2*stride,i+2*stride+1,i+3*stride+1,i+3*stride)])
    for i in [0,n]: faces.append((i,i+2*stride,i+3*stride,i+stride))
    mesh(name,verts,faces,mat,True)


def detector(
    index: int,
    red: bpy.types.Material,
    white: bpy.types.Material,
    metal: bpy.types.Material,
    dark: bpy.types.Material,
) -> None:
    a=index*math.pi/2; chosen=index==0
    r=[.43,.34,.37,.30][index]; half=[.50,.35,.43,.37][index]
    # A visible quadrant is removed from every instrument to expose nested tracking volumes.
    start,end=math.radians(45),math.radians(320)
    # Give the selected detector a fuller near circular back rim but an open front quarter.
    station_shell(f'Detector {index+1} cutaway steel return yoke',a,r,.05,half,start,end,red if chosen else metal)
    station_shell(f'Detector {index+1} calorimeter',a,r*.77,.035,half*.84,start,end,white)
    station_shell(f'Detector {index+1} silicon tracker',a,r*.44,.012,half*.92,start,end,metal)
    for zpos in [-half,-half*.5,0,half*.5,half]:
        station_arc('Detector ring stiffener',a,r+.01,.018,zpos,start,end,white if chosen else dark,28)
    for zpos in [-half*.91,half*.91]:
        station_arc('Inner endcap',a,r*.62,.026,zpos,start,end,red)
    for theta in [math.radians(d) for d in [45,90,135,180,225,270,320]]:
        path('Longitudinal detector services',[station_point(a,((r+.023)*math.cos(theta),-half,(r+.023)*math.sin(theta))),station_point(a,((r+.023)*math.cos(theta),half,(r+.023)*math.sin(theta)))],.012,dark,1)
    cube('Experiment cavern raft',station_point(a,(0,0,-.36)),(r*2.65,half*2+.17,.095),dark,.018,a)
    for side in [-1,1]:
        cube('Detector service rack',station_point(a,(side*(r+.12),0,-.19)),(.13,half*1.3,.24),white,.012,a)
        for j in range(4):
            cube('Rack ventilation',station_point(a,(side*(r+.122),-.19+j*.12,-.06)),(.132,.028,.012),dark,.001,a)
    if index == 1:
        # Long toroid-style external barrel ribs distinguish this experiment.
        for theta in [i*math.tau/8 for i in range(8)]:
            rr=r+.075
            path('Large toroid coil', [station_point(a,(rr*math.cos(theta),-half-.15,rr*math.sin(theta))),station_point(a,((rr+.07)*math.cos(theta),-half*.60,(rr+.07)*math.sin(theta))),station_point(a,((rr+.07)*math.cos(theta),half*.60,(rr+.07)*math.sin(theta))),station_point(a,(rr*math.cos(theta),half+.15,rr*math.sin(theta)))],.022,white,1)
    elif index == 2:
        # A compact wide set of endcap discs gives this detector another profile.
        for ypos in [-half-.10,-half-.025,half+.025,half+.10]:
            station_arc('Layered endcap disc',a,r*1.15,.035,ypos,start,end,white,32)
        cube('Experiment overhead service bridge',station_point(a,(0,0,r+.10)),(.73,.14,.08),dark,.012,a)
    elif index == 3:
        # An asymmetric forward spectrometer: open square magnet frames.
        for ypos in [-half-.15,half+.19]:
            frame=[(-r*.95,ypos,-r*.8),(r*.95,ypos,-r*.8),(r*.95,ypos,r*.96),(-r*.95,ypos,r*.96),(-r*.95,ypos,-r*.8)]
            path('Forward spectrometer magnet frame',[station_point(a,p) for p in frame],.033,white,1)
        for ypos in [half+.08,half+.22,half+.36]:
            cube('Forward tracking station',station_point(a,(0,ypos,0)),(.43,.025,.43),dark,.006,a)
    if chosen:
        # Red frame communicates the station the guided camera will enter.
        outline=[(-.65,-.68,-.30),(.65,-.68,-.30),(.65,.68,-.30),(-.65,.68,-.30),(-.65,-.68,-.30)]
        path('Selected experiment footprint',[station_point(a,p) for p in outline],.011,red,1)


def campus(
    white: bpy.types.Material,
    dark: bpy.types.Material,
    red: bpy.types.Material,
    roads: bpy.types.Material,
) -> None:
    buildings=[(-1.30,-.65,1.45,.31,.16),(-1.40,-.15,1.05,.24,.20),(-2.15,-.26,.26,.87,.15),(-.37,-.20,.32,.66,.23),(-1.02,.38,.85,.24,.13)]
    for idx,(x,y,w,d,h) in enumerate(buildings):
        z=terrain_height(x,y)
        cube('Schematic research campus', (x,y,z+h/2),(w,d,h),white,.012)
        cube('Flat research roof',(x,y,z+h+.008),(w+.018,d+.018,.022),dark,.004)
        if idx==0: cube('Red facade band',(x,y-d/2-.006,z+h*.55),(w,.009,.028),red,.001)
        for j in range(max(2,int(w/.13))):
            cube('Facade windows',(x-w/2+.07+j*.13,y-d/2-.005,z+h*.35),(.065,.009,.03),dark,.001)
    for idx in range(5):
        x=-2.1+idx*.16;y=-.91;z=terrain_height(x,y)
        cylinder('Cryogenic service vessel',(x,y,z+.11),.052,.22,white,12)
    routes=[[(-2.6,-1.25),(-2.6,.85),(-.0,.85),(.8,1.8),(2.25,2.8),(3.45,3.75)], [(-6.4,-3.8),(-3.8,-2),(-2.6,-1.25),(.7,-1.3),(2.5,-2.0),(4.6,-3.8)], [(-.3,.85),(.1,1.9),(-1.3,3.8),(-2.3,5.7)]]
    for route in routes:
        points=[]
        for begin,end in zip(route,route[1:]):
            for k in range(16):
                t=k/16; x=begin[0]+(end[0]-begin[0])*t; y=begin[1]+(end[1]-begin[1])*t
                # Ring trench remains visually unobstructed.
                points.append((x,y,terrain_height(x,y)+.013))
        path('Surface access road',points,.028,roads,0)
    # A small injector illustrates the accelerator chain without competing with the main ring.
    for radius,origin in [(.60,(1.5,-.6)),(.24,(1.1,-.2))]:
        path('Schematic injector loop',[(origin[0]+radius*math.cos(i/80*math.tau),origin[1]+radius*math.sin(i/80*math.tau),.27) for i in range(81)],.015,white,1)
    path('Transfer from injector',[(1.55,-.1,.27),(2.0,.75,.28),(3.0,1.45,.31),(4.2,2.55,.52)],.012,red,1)


def area(
    name: str,
    pos: tuple[float, float, float],
    power: float,
    size: float,
    color: tuple[float, float, float],
    target: tuple[float, float, float] = (0,0,.2),
) -> None:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.size=size;data.shape='DISK';data.color=color
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=pos
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def merge_by_material() -> None:
    bpy.ops.object.select_all(action='DESELECT')
    for obj in list(bpy.context.scene.objects):
        if obj.type in ['MESH','CURVE']:
            obj.select_set(True)
    bpy.context.view_layer.objects.active=next(o for o in bpy.context.selected_objects if o.type=='MESH')
    bpy.ops.object.convert(target='MESH')
    for mat in MATS.values():
        items=[o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.materials)==1 and o.data.materials[0]==mat]
        if not items: continue
        if len(items) == 1:
            items[0].name = mat.name
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for ob in items: ob.select_set(True)
        bpy.context.view_layer.objects.active=items[0]; bpy.ops.object.join(); items[0].name=mat.name
    bpy.ops.object.select_all(action='SELECT')


def main() -> None:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    slate=material('Terrain / blue-grey limestone',(.22,.27,.31),.04,.82)
    cut=material('Upper geological cut',(.30,.34,.37),.02,.86)
    strata1=material('Limestone stratum',(.44,.47,.48),.03,.75)
    strata2=material('Lower slate stratum',(.19,.23,.27),.08,.70)
    foundation=material('Architectural foundation',(.13,.17,.21),.20,.50)
    white=material('Warm white engineering enamel',(.84,.84,.79),.24,.34)
    steel=material('Satin cryostat stainless steel',(.44,.52,.57),.66,.30)
    dark=material('Graphite instrument frames',(.09,.12,.15),.52,.40)
    red=material('Swiss red / experiment',(.65,.007,.015),.26,.34)
    beam=material('Proton beam / Swiss red',(.88,.008,.025),.12,.30,.45)
    contour=material('Fine survey contours',(.43,.50,.53),.02,.80)
    road=material('Surface access roads',(.13,.18,.22),.02,.80)
    cube('Lower architectural foundation',(0,0,-.54),(13.8,12.2,.16),foundation,.04)
    cube('Lower geological layer',(0,0,-.415),(13.79,12.19,.09),strata1,.015)
    cube('Middle geological layer',(0,0,-.285),(13.79,12.19,.17),strata2,.012)
    terrain(slate,cut);contours(contour)
    # Fine cut lines distinguish stratigraphy, especially at the front face.
    for z in [-.43,-.345,-.225]:
        path('Exposed geological seam',[(-6.88,-6.106,z),(6.88,-6.106,z)],.0045,white,0)
        path('Exposed geological seam',[(6.906,-6.08,z),(6.906,6.08,z)],.0045,white,0)
    magnet_segments(steel,white)
    # Shallow tray below cryostats, with twin beam trajectories clearly legible from above.
    path('Accelerator tunnel lower cable tray',[(RADIUS*math.cos(i/240*math.tau),RADIUS*math.sin(i/240*math.tau),.33) for i in range(241)],.096,dark,1)
    for rad,mat,z in [(RADIUS-.035,beam,.605),(RADIUS+.035,white,.606)]:
        path('Counter-rotating proton beam',[(rad*math.cos(i/288*math.tau),rad*math.sin(i/288*math.tau),z) for i in range(289)],.010,mat,1)
    for idx in range(56):
        a=idx/56*math.tau
        if min(abs((a-k*math.pi/2+math.pi)%math.tau-math.pi) for k in range(4)) < .12:continue
        cube('Magnet cradle',(RADIUS*math.cos(a),RADIUS*math.sin(a),.33),(.15,.055,.18),dark,.006,a)
    for idx in range(4): detector(idx,red,white,steel,dark)
    campus(white,dark,red,road)
    # Subtle survey ticks around the tile lend scale without labelling invented geography.
    for x in [-6,-4,-2,0,2,4,6]:
        path('Survey edge index',[(x,-6.11,.045),(x,-5.99,.045)],.006,white,0)
    merge_by_material()
    bpy.ops.export_scene.gltf(filepath=str(PUBLIC/'collider-v2.glb'),export_format='GLB',use_selection=True,export_apply=True,export_cameras=False,export_lights=False,export_yup=True)
    logging.info('Exported GLB: %.2f MB',(PUBLIC/'collider-v2.glb').stat().st_size/1e6)
    area('Soft white key',(-5,-7,13),2100,9,(1,.96,.91))
    area('Broad cool fill',(8,-1,8),1550,7,(.85,.92,1))
    area('Upper white rim',(-2,7,11),2400,8,(.97,.99,1))
    world=bpy.data.worlds.new('Warm slate studio');world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.28,.32,.36,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.45;bpy.context.scene.world=world
    bpy.ops.object.camera_add(location=(12.8,-17,13.5));cam=bpy.context.object
    cam.rotation_euler=(Vector((0,0,.0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=20.8
    scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.cycles.device='CPU'
    scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.filepath=str(PUBLIC/'collider-v2-poster.png')
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.10
    scene['provenance']='Original procedural Blender architecture, no downloaded models or textures. Source scripts/render-collider-v2.py'
    scene['scientific_scope']='LHC-inspired schematic architectural cutaway. Geography, scales, structures and experimental station locations are illustrative, not surveyed.'
    scene['gltf_coordinates']='Y up. Ring radius5.05, elevation.52. Main detector(5.05,.52,0), beam axis Z.'
    bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'collider-v2.blend'))
    logging.info('Rendering transparent 1600x900 poster, Cycles CPU, 32 samples')
    bpy.ops.render.render(write_still=True)
    logging.info('Complete')


if __name__=='__main__':
    try: main()
    except Exception:
        logging.exception('Collider asset generation failed')
        raise

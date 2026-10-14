# taste_render.py - makes a Training round's .blend viewable in The Wise Hive's Taste library, headless.
#   blender -b --factory-startup --python taste_render.py -- --blend <file.blend> --out <item folder> [--round N]
# 1. Opens the .blend in this throwaway headless Blender (never saves it).
# 2. Picks the round's objects: names starting "R<N>_" when there are any (rounds often share one practice file),
#    else every visible renderable object in the file's scene.
# 3. A colour turntable + stills + capture.json via taste_capture.capture() (the Taste viewer spins it).
# 4. If the scene moves (actions, shape-key or object animation, particles, simulation or time-driven node trees),
#    also renders the animation to <out>\animation.mp4 (Eevee, 960x540, up to 150 frames) through the scene camera,
#    or through a 3/4 camera framing the objects when the scene has none.
# Prints one JSON line starting with "TASTE_RENDER " with what it made. Written 2026-10-13 for the Taste library.
import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default

BLEND, OUT = arg("--blend"), arg("--out")
ROUND = int(arg("--round")) if arg("--round") not in (None, "") else None
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import taste_capture  # noqa: E402

RENDERABLE = {"MESH", "CURVE", "SURFACE", "META", "FONT", "CURVES", "POINTCLOUD", "VOLUME", "GREASEPENCIL"}
report = {"blend": BLEND, "out": OUT, "round": ROUND, "made": [], "warnings": []}


def done():
    print("TASTE_RENDER " + json.dumps(report))
    sys.stdout.flush()


def _extent(obs):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in obs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-6)


def pick_objects(scene):
    obs = [o for o in scene.objects if o.type in RENDERABLE and not o.hide_render]
    if ROUND is not None:
        mine = [o for o in obs if o.name.lower().startswith("r%d_" % ROUND)]
        if mine:
            obs = mine
    # A presentation ground far bigger than the model (a big disc or plane) would shrink the model in every frame;
    # a diorama's own base is about the model's size and stays.
    grounds = [o for o in obs if any(k in o.name.lower() for k in ("ground", "floor", "backdrop", "plane", "terrain"))]
    rest = [o for o in obs if o not in grounds]
    if grounds and rest:
        size = _extent(rest)
        big = [g for g in grounds if _extent([g]) > 2.5 * size]
        if big:
            report["warnings"].append("left out of the framing (much bigger than the model): " + ", ".join(g.name for g in big))
            obs = [o for o in obs if o not in big]
    return obs


def animated(scene, obs):
    if any(a.fcurves for a in bpy.data.actions if hasattr(a, "fcurves")) or any(getattr(a, "layers", None) for a in bpy.data.actions):
        return True
    for o in obs:
        if o.particle_systems or (o.animation_data and (o.animation_data.action or o.animation_data.drivers)):
            return True
        for m in o.modifiers:
            if m.type in ("FLUID", "CLOTH", "DYNAMIC_PAINT", "OCEAN", "SOFT_BODY", "WAVE", "EXPLODE"):
                return True
    for ng in bpy.data.node_groups:
        for n in ng.nodes:
            if n.bl_idname in ("GeometryNodeInputSceneTime", "GeometryNodeSimulationInput", "GeometryNodeSimulationOutput"):
                return True
    for mat in bpy.data.materials:
        if mat.node_tree and mat.node_tree.animation_data:
            return True
    return scene.frame_end - scene.frame_start >= 2 and bool(scene.camera and scene.camera.animation_data)


def framing_camera(scene, obs):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in obs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    center, radius = (lo + hi) / 2, max((hi - lo).length, 0.5) / 2
    cam = bpy.data.objects.new("TasteAnimCam", bpy.data.cameras.new("TasteAnimCam"))
    scene.collection.objects.link(cam)
    cam.data.lens = 40
    # The whole bounding sphere fits the frame's height (16:9, so the width has room), with a 25 % margin.
    half = math.atan((cam.data.sensor_width * 9 / 16) / 2 / cam.data.lens)
    dist = radius / math.sin(half) * 1.25
    az, el = math.radians(35), math.radians(22)
    cam.location = center + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = max(1000, dist * 10)
    return cam


def light_if_dark(scene):
    """A scene with no lamps (common in a practice file) renders near black: add a sun and a soft grey world."""
    if any(o.type == "LIGHT" and not o.hide_render for o in scene.objects):
        return
    sun = bpy.data.objects.new("TasteSun", bpy.data.lights.new("TasteSun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    scene.collection.objects.link(sun)
    w = scene.world
    if w and w.use_nodes:
        bg = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None)
        if bg:
            bg.inputs[1].default_value = max(bg.inputs[1].default_value, 0.6)
    report["warnings"].append("the scene had no lights: a sun was added for the video")


def render_animation(scene, obs):
    eng = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = next((e for e in eng if "EEVEE" in e), eng[0])
    if not scene.camera:
        scene.camera = framing_camera(scene, obs)
        report["warnings"].append("the scene had no camera: a 3/4 camera framing the objects was added")
    if not scene.world:
        scene.world = bpy.data.worlds.new("TasteAnimWorld")
        scene.world.use_nodes = True
    light_if_dark(scene)
    scene.frame_end = min(scene.frame_end, scene.frame_start + 149)
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = 960, 540, 100
    if hasattr(r.image_settings, "media_type"):  # Blender 5: video output is a media type, FFMPEG only exists under it
        r.image_settings.media_type = "VIDEO"
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format = "MPEG4"
    try:
        r.ffmpeg.codec = "H264"
        r.ffmpeg.constant_rate_factor = "MEDIUM"
    except Exception:
        pass
    r.filepath = os.path.join(OUT, "animation.mp4")
    bpy.ops.render.render(animation=True, scene=scene.name)
    # Blender may add the frame range to the name: find what it wrote.
    for f in os.listdir(OUT):
        if f.startswith("animation") and f.endswith(".mp4") and f != "animation.mp4":
            os.replace(os.path.join(OUT, f), os.path.join(OUT, "animation.mp4"))
    if os.path.exists(os.path.join(OUT, "animation.mp4")):
        report["made"].append("animation.mp4")
        report["frames"] = scene.frame_end - scene.frame_start + 1


try:
    if not BLEND or not OUT or not os.path.isfile(BLEND):
        raise ValueError("usage: -- --blend <file> --out <folder> [--round N]")
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=BLEND, load_ui=False)
    scene = bpy.context.scene
    obs = pick_objects(scene)
    if not obs:
        raise ValueError("no visible renderable objects in the scene")
    report["objects"] = [o.name for o in obs][:60]
    try:
        cap = taste_capture.capture(OUT, [o.name for o in obs], round=ROUND, blend=BLEND, frames=24)
        report["made"].append("capture")
        report["tris"] = cap.get("tris") if isinstance(cap, dict) else None
    except Exception as e:
        report["warnings"].append("turntable: %s" % e)
    bpy.context.window_manager  # keep the session alive for the animation pass
    if animated(scene, obs):
        try:
            render_animation(scene, obs)
        except Exception as e:
            report["warnings"].append("animation: %s" % e)
except Exception as e:
    report["error"] = str(e)
done()

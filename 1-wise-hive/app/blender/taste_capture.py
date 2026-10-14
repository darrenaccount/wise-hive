# taste_capture.py - renders a finished model for The Wise Hive Taste library (Training tab):
#   5 stills + a thumbnail + an N-frame turntable + capture.json, in a temporary scene that is removed afterwards.
# capture(out_dir, objects, round=None, blend=None, source=None, frames=24, size=768, turn_size=512, elev=20,
#         resume=False, part="all", auto_exposure=True) -> dict (also printed as one JSON line)
# source=<.blend>: append `objects` from that file instead of using the open file's objects (removed again afterwards).
# Never saves any .blend, never opens one, and never changes the open scene or its settings.
# This file is copied from app\blender\taste_capture.py on every The Wise Hive start; edit that one.
# Verified 2026-10-12 in Blender 5.2.2 LTS, headless (-b), on a copy of a practice chest (5 objects, 1956 tris):
#   5 stills + thumb + 24 frames in 38 s (first run, shaders compiling; about 680 KB), tris equal to the source scene,
#   source= from a factory-startup file left 0 datablocks behind, resume=True re-rendered nothing, and a verdict.json
#   (without resume) or another round number made it refuse.
# 2026-10-13: source= in the live Blender left an empty Library entry for the source file; libraries are now in the
#   snapshot and removed last (verified with the MCP on an open file: library count unchanged).
import bpy
import json
import math
import os
import time
import warnings as _pywarn
from mathutils import Vector

_SNAP_KINDS = ("objects", "meshes", "curves", "materials", "images", "node_groups", "textures", "collections",
               "armatures", "actions", "lights", "cameras", "lattices", "worlds", "metaballs", "fonts", "volumes",
               "pointclouds", "hair_curves", "grease_pencils", "libraries")
# libraries last: an append leaves an (empty) Library entry for the source file in the open file.
_REMOVE_ORDER = ("objects", "meshes", "curves", "metaballs", "fonts", "volumes", "pointclouds", "hair_curves",
                 "grease_pencils", "lattices", "armatures", "lights", "cameras", "materials", "node_groups", "textures",
                 "images", "actions", "collections", "worlds", "libraries")
_RENDERABLE = {"MESH", "CURVE", "SURFACE", "META", "FONT", "CURVES", "POINTCLOUD", "VOLUME", "GREASEPENCIL"}


def _enum_ids(rna_type, prop):
    try:
        return [i.identifier for i in rna_type.bl_rna.properties[prop].enum_items]
    except Exception:
        return []


def _set_engine(scene, want_sub, fallback="BLENDER_WORKBENCH"):
    """Sets the first engine whose id contains want_sub (read from the enum, never hard-coded). True if it worked."""
    ids = _enum_ids(bpy.types.RenderSettings, "engine")
    for cand in [i for i in ids if want_sub in i] + [want_sub]:
        try:
            scene.render.engine = cand
            return True
        except TypeError as e:  # the message lists the valid engines
            for word in str(e).replace("'", " ").replace(",", " ").replace("(", " ").replace(")", " ").split():
                if want_sub in word:
                    try:
                        scene.render.engine = word
                        return True
                    except TypeError:
                        pass
    if fallback:
        try:
            scene.render.engine = fallback
        except TypeError:
            pass
    return False


def _set_format(scene, quality):
    st = scene.render.image_settings
    fmts = _enum_ids(bpy.types.ImageFormatSettings, "file_format")
    ext = ".png"
    if "JPEG" in fmts:
        try:
            st.file_format = "JPEG"
            st.quality = quality
            ext = ".jpg"
        except Exception:
            st.file_format = "PNG"
    else:
        st.file_format = "PNG"
    try:
        st.color_mode = "RGB"
    except Exception:
        pass
    return ext


def _set_view(scene, transform, exposure):
    vs = scene.view_settings
    for t in (transform, "AgX", "Filmic", "Standard"):
        try:
            vs.view_transform = t
            break
        except TypeError:
            continue
    try:
        vs.look = "None"
    except TypeError:
        pass
    vs.exposure = exposure
    vs.gamma = 1.0


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def _pointers():
    out = {}
    for k in _SNAP_KINDS:
        coll = getattr(bpy.data, k, None)
        if coll is not None:
            out[k] = {d.as_pointer() for d in coll}
    return out


def _object_refs(ob):
    """Objects a modifier or constraint points at (boolean cutters, mirror objects, curve guides...)."""
    refs = []
    for holder in list(getattr(ob, "modifiers", [])) + list(getattr(ob, "constraints", [])):
        for p in holder.bl_rna.properties:
            if p.type == "POINTER" and getattr(p.fixed_type, "identifier", "") == "Object":
                try:
                    v = getattr(holder, p.identifier)
                except Exception:
                    v = None
                if v is not None:
                    refs.append(v)
    return refs


def _renders(ob):
    return ob.type in _RENDERABLE and not ob.hide_render


def _closure(targets):
    """The model: the targets and their descendants, plus the helper objects their modifiers and constraints point at
    when those don't render themselves (boolean cutters hidden from render, empties, armatures...).
    Never a parent or a parent's other children: the depsgraph evaluates parents and rendering helpers (a shrinkwrap
    target, a rig's meshes) as indirect dependencies without showing them, so a lantern hung under a market stall
    captures as the lantern alone."""
    seen, todo = [], list(targets)
    while todo:
        ob = todo.pop()
        if ob is None or ob in seen:
            continue
        seen.append(ob)
        todo.extend(ob.children)
        for ref in _object_refs(ob):
            if ref not in seen and not _renders(ref):
                seen.append(ref)
    return seen


def _measure(dg, obs):
    lo, hi = Vector((1e18, 1e18, 1e18)), Vector((-1e18, -1e18, -1e18))
    tris, mats, any_box = 0, [], False
    for ob in obs:
        if ob.type not in _RENDERABLE or ob.hide_render:
            continue
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            w = ev.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
            any_box = True
        try:
            me = ev.to_mesh()
            if me is not None:
                me.calc_loop_triangles()
                tris += len(me.loop_triangles)
            ev.to_mesh_clear()
        except Exception:
            pass
        for s in ob.material_slots:
            if s.material and s.material.name not in mats:
                mats.append(s.material.name)
    if not any_box:
        lo, hi = Vector((-1, -1, -1)), Vector((1, 1, 1))
    return lo, hi, tris, mats


def _aim(ob, target_local):
    d = Vector(target_local) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def _look_from(cam, d, az, el):
    """Places the camera (a child of the pivot) d away from the pivot. The pivot turns by az; el is the elevation."""
    pivot = cam.parent
    pivot.rotation_euler = (0.0, 0.0, math.radians(az))
    if el >= 89.9:
        cam.location = (0.0, 0.0, d)
        cam.rotation_euler = (0.0, 0.0, 0.0)
    else:
        e = math.radians(el)
        cam.location = (0.0, -d * math.cos(e), d * math.sin(e))
        _aim(cam, (0.0, 0.0, 0.0))


def _render(scene, path_noext):
    scene.render.filepath = path_noext
    bpy.ops.render.render(write_still=True, scene=scene.name)


def _luminance_ev(path):
    """Exposure change (EV) that brings the model's mean luminance in the 3/4 still to mid grey, or 0."""
    import numpy as np
    img = bpy.data.images.load(path, check_existing=False)
    try:
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)[:, :3]
        # Display-encoded 0-1 values: back to linear light first.
        lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
        grid = px.reshape(h, w, 3)
        corners = np.array([grid[2, 2], grid[2, w - 3], grid[h - 3, 2], grid[h - 3, w - 3]]).mean(axis=0)
        mask = np.abs(px - corners).max(axis=1) > 0.02
        if mask.sum() < 0.01 * w * h:
            return 0.0
        lum = (lin[mask] * np.array([0.2126, 0.7152, 0.0722])).sum(axis=1).mean()
        if lum <= 1e-5:
            return 2.0
        ev = math.log2(0.18 / lum)
        return ev if abs(ev) > 0.4 else 0.0
    finally:
        bpy.data.images.remove(img)


def _thumb(src, dst, quality=85):
    img = bpy.data.images.load(src, check_existing=False)
    try:
        img.scale(256, 256)
        img.filepath_raw = dst
        try:
            img.file_format = "JPEG" if dst.endswith(".jpg") else "PNG"
        except Exception:
            pass
        img.save()
        return True
    except Exception:
        return False
    finally:
        try:
            bpy.data.images.remove(img)
        except Exception:
            pass


def capture(out_dir, objects, round=None, blend=None, source=None, frames=24, size=768, turn_size=512, elev=20,
            resume=False, part="all", auto_exposure=True):
    t0 = time.time()
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    cap_file = os.path.join(out_dir, "capture.json")
    old = _read_json(cap_file) or {}
    # 1. Guard: never overwrite a model the user already reviewed or another round's capture.
    if not resume:
        if os.path.exists(os.path.join(out_dir, "verdict.json")):
            raise RuntimeError("This folder holds a model the user already reviewed; use the next number.")
        if old and old.get("round") != round:
            raise RuntimeError("This folder holds another round's model; use the next number.")
    elif old and old.get("round") != round:
        raise RuntimeError("resume=True only continues a capture of the same round (capture.json has round %r)." % old.get("round"))
    if isinstance(objects, str):
        objects = [objects]
    names = [str(n) for n in objects]
    if not names:
        raise ValueError("Pass objects=[...] with every object of the model.")
    part = part if part in ("all", "stills", "turntable") else "all"

    snap = _pointers() if source else None
    scene = world = pivot = cam = None
    rig = []
    loaded = []
    warnings = []
    result = {}
    try:
        # 2. Targets.
        if source:
            src_path = os.path.abspath(source)
            with bpy.data.libraries.load(src_path, link=False) as (src, dst):
                missing = [n for n in names if n not in src.objects]
                if missing:
                    raise ValueError("Not in %s: %s. Objects there: %s" % (src_path, missing, list(src.objects)[:40]))
                dst.objects = list(names)
            targets = [o for o in dst.objects if o is not None]
            blend = blend or src_path
        else:
            missing = [n for n in names if n not in bpy.data.objects]
            if missing:
                raise ValueError("Unknown objects %s. Objects in this file: %s" % (missing, [o.name for o in bpy.data.objects][:40]))
            targets = [bpy.data.objects[n] for n in names]
        home = None if source else next((s for o in targets for s in o.users_scene), None)
        allobs = _closure(targets)

        # 3. Temporary scene with its own world, camera and lights.
        scene = bpy.data.scenes.new("TasteCapture")
        for o in allobs:
            if o.name not in scene.collection.objects:
                scene.collection.objects.link(o)
        world = bpy.data.worlds.new("TasteCaptureWorld")
        bg = (0.024, 0.028, 0.037)  # about #2b2f36 on screen
        try:
            with _pywarn.catch_warnings():
                _pywarn.simplefilter("ignore")  # use_nodes is deprecated in 5.x but still needed on 4.x
                world.use_nodes = True
        except Exception:
            pass
        node = None
        if getattr(world, "node_tree", None):
            node = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
        if node:
            node.inputs[0].default_value = (*bg, 1.0)
            node.inputs[1].default_value = 1.0
        world.color = bg
        scene.world = world
        r = scene.render
        r.resolution_percentage = 100
        r.film_transparent = False
        try:
            r.use_file_extension = True
        except Exception:
            pass
        eevee = _set_engine(scene, "EEVEE")
        if not eevee:
            warnings.append("EEVEE unavailable: rendered with Workbench material colours")
        if eevee:
            for attr in ("taa_render_samples",):
                if hasattr(scene.eevee, attr):
                    setattr(scene.eevee, attr, 32)
        else:
            sh = scene.display.shading
            sh.light, sh.color_type = "STUDIO", "MATERIAL"
        engine = scene.render.engine

        # 4. Measure in this scene's own depsgraph.
        dg = scene.view_layers[0].depsgraph
        dg.update()
        lo, hi, tris, mats = _measure(dg, allobs)
        center = (lo + hi) / 2
        dims = hi - lo
        rad = max(dims.length / 2, 1e-3)
        if home is not None:
            try:
                hdg = home.view_layers[0].depsgraph
                hdg.update()
                h_tris = _measure(hdg, _closure(targets))[2]
                if h_tris != tris:
                    warnings.append("tri mismatch %d vs %d in the source scene (a modifier's helper object may be missing); renders may differ from the .blend" % (tris, h_tris))
            except Exception:
                pass

        # 5. Rig: a pivot at the centre; camera and lights turn with it (the model looks like it turns under fixed light).
        pivot = bpy.data.objects.new("TastePivot", None)
        pivot.location = center
        scene.collection.objects.link(pivot)
        rig.append(pivot)
        cdata = bpy.data.cameras.new("TasteCam")
        cdata.lens, cdata.sensor_width = 50, 36
        cdata.clip_start = max(rad / 200, 0.001)
        cdata.clip_end = max(100.0, 20 * rad)
        cam = bpy.data.objects.new("TasteCam", cdata)
        scene.collection.objects.link(cam)
        cam.parent = pivot
        rig.append(cam)
        scene.camera = cam
        fov = 2 * math.atan(18 / 50)
        dist = 1.12 * rad / math.sin(fov / 2)
        for name, off, power, colr, sz in (("TasteKey", (-1.2, -1.6, 1.4), 70, (1.0, 0.95, 0.88), 1.2),
                                           ("TasteFill", (1.6, -1.2, 0.5), 25, (0.85, 0.9, 1.0), 2.0),
                                           ("TasteRim", (0.4, 1.8, 1.2), 85, (1.0, 1.0, 1.0), 0.8)):
            ld = bpy.data.lights.new(name, "AREA")
            ld.energy = power * rad * rad
            ld.color = colr
            ld.size = sz * rad
            lo_ = bpy.data.objects.new(name, ld)
            scene.collection.objects.link(lo_)
            lo_.parent = pivot
            lo_.location = Vector(off) * rad
            _aim(lo_, (0.0, 0.0, 0.0))
            rig.append(lo_)

        files = {}
        exposure = float(old.get("exposure", 0.0)) if resume else 0.0
        ext = _set_format(scene, 90)
        stills = {"34": "still-34", "front": "still-front", "side": "still-side", "top": "still-top", "clay": "still-clay"}
        have = lambda base: next((base + e for e in (".jpg", ".png") if os.path.exists(os.path.join(out_dir, base + e))), None)

        def info(phase, done_frames):
            return {"v": 1, "id": os.path.basename(out_dir), "round": round,
                    "at": old.get("at") if resume and old.get("at") else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "blender": bpy.app.version_string, "blend": blend or bpy.data.filepath or None,
                    "blendSaved": bool(blend or (bpy.data.filepath and not bpy.data.is_dirty)), "source": os.path.abspath(source) if source else None,
                    "objects": [o.name for o in targets], "tris": tris, "dims": [round_(v) for v in dims],
                    "materials": mats, "engine": engine, "exposure": round_(exposure),
                    "stills": {k: have(v) for k, v in stills.items() if have(v)}, "thumb": have("thumb"),
                    "turntable": {"frames": frames, "done": done_frames, "elev": elev, "size": turn_size},
                    "warnings": warnings, "seconds": round_(time.time() - t0), "phase": phase}

        def round_(v):
            return float("%.4g" % v)

        # 6-8. Stills, auto exposure, thumbnail.
        if part in ("all", "stills"):
            r.resolution_x = r.resolution_y = size

            def shot(key, az, el, ortho):
                cdata.type = "ORTHO" if ortho else "PERSP"
                cdata.ortho_scale = 2.2 * rad
                _look_from(cam, dist, az, el)
                _render(scene, os.path.join(out_dir, stills[key]))

            _set_view(scene, "AgX", exposure)
            todo = [("34", 45, 25, False), ("front", 0, 0, True), ("side", 90, 0, True), ("top", 0, 90, True)]
            for key, az, el, ortho in todo:
                if not (resume and have(stills[key])):
                    shot(key, az, el, ortho)
            if auto_exposure and eevee and not (resume and "exposure" in old):
                ev = _luminance_ev(os.path.join(out_dir, have(stills["34"])))
                if ev:
                    exposure = max(-2.0, min(2.0, ev))
                    _set_view(scene, "AgX", exposure)
                    for key, az, el, ortho in todo:
                        shot(key, az, el, ortho)
            if not (resume and have(stills["clay"])):
                _set_engine(scene, "WORKBENCH", None)
                sh = scene.display.shading
                sh.light, sh.color_type, sh.single_color = "STUDIO", "SINGLE", (0.72, 0.70, 0.66)
                sh.show_cavity = True
                try:
                    sh.cavity_type = "BOTH"
                except Exception:
                    pass
                sh.show_object_outline = True
                _set_view(scene, "Standard", 0.0)
                shot("clay", 45, 25, False)
                _set_engine(scene, engine, None)
            if not (resume and have("thumb")):
                _thumb(os.path.join(out_dir, have(stills["34"])), os.path.join(out_dir, "thumb" + ext), 85)
            _write_json(cap_file, info("stills", 0))

        # 9. Turntable: one ring at `elev`, frame 0 = the 3/4 hero angle. One still per frame, so resume skips done ones.
        done_frames = len([f for f in os.listdir(out_dir) if f.startswith("turn-")])
        if part in ("all", "turntable") and frames > 0:
            r.resolution_x = r.resolution_y = turn_size
            _set_format(scene, 85)
            _set_view(scene, "AgX", exposure)
            if eevee and hasattr(scene.eevee, "taa_render_samples"):
                scene.eevee.taa_render_samples = 16
            cdata.type = "PERSP"
            for i in range(frames):
                base = "turn-%02d" % i
                if resume and have(base):
                    continue
                _look_from(cam, dist, 45 + i * 360.0 / frames, elev)
                _render(scene, os.path.join(out_dir, base))
            done_frames = len([f for f in os.listdir(out_dir) if f.startswith("turn-")])
        phase = "done" if part == "all" or (part == "turntable" and have(stills["34"])) else "stills"
        result = info(phase, done_frames)
        _write_json(cap_file, result)
    finally:
        # 10. Clean up: the temp scene, the rig and its data, the world; with source=, exactly what was appended.
        gone = set()

        def drop(coll, d):
            try:
                p = d.as_pointer()
                if p in gone:
                    return
                coll.remove(d)
                gone.add(p)
            except Exception:
                pass

        for ob in rig:
            data = ob.data
            drop(bpy.data.objects, ob)
            if data is not None:
                drop(bpy.data.cameras if isinstance(data, bpy.types.Camera) else bpy.data.lights, data)
        if scene is not None:
            drop(bpy.data.scenes, scene)
        if world is not None:
            drop(bpy.data.worlds, world)
        if snap is not None:
            for k in _REMOVE_ORDER:
                coll = getattr(bpy.data, k, None)
                if coll is None or k not in snap:
                    continue
                for d in [d for d in coll if d.as_pointer() not in snap[k]]:
                    drop(coll, d)
    out = {"ok": True, "dir": out_dir, "stills": len(result.get("stills", {})), "frames": result.get("turntable", {}).get("done", 0),
           "tris": result.get("tris"), "seconds": result.get("seconds"), "warnings": result.get("warnings", [])}
    print(json.dumps(out))
    return out

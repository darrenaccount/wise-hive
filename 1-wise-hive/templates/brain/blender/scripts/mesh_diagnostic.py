# mesh_diagnostic.py - normals / topology / UV diagnostic for game meshes, returns numbers as JSON.
#
# Runs inside Blender (execute_blender_code). Measures the EVALUATED mesh (modifiers applied) in WORLD
# space, so object scale counts for texel density and a negative scale is handled (winding reversed).
#
#   diagnose(objs, thresholds=None, verbose=True) -> {name: {"metrics": {...}, "checks": {...}}}
#       objs: an object, an object name, or a list of either. Non-mesh objects are skipped.
#   as_json(objs) -> JSON string of the same dict.
#
# Metrics per object:
#   inward_faces      faces pointing inward on CLOSED shells. Exact signed-volume test: each shell is
#                     flood-filled across manifold edges to a consistent winding, the corrected signed
#                     volume says which side is outward, and the faces wound the other way are counted.
#                     Runs on a welded copy (merge 1e-5) so doubled verts don't cut a shell open.
#   inward_raycast    cross-check for the same thing: faces whose centroid ray along the normal hits its
#                     own (closed) shell an odd number of times (hits on the face itself are skipped:
#                     warped quads self-hit). Can disagree on self-intersecting shells; trust inward_faces.
#   winding_flips_open  faces in the minority winding on OPEN shells (inward/outward is undefined there).
#   doubled_verts     coincident verts (within 1e-5) that are a defect: same shell, or on an open edge
#                     (a rip). Counted as verts "merge by distance" would remove.
#   touching_shell_verts  coincident verts where separate CLOSED parts just touch (kit stones). Info only:
#                     merging those would create non-manifold edges.
#   loose_verts / loose_edges   verts with no edge / edges with no face.
#   boundary_edges    edges with exactly 1 face.  nonmanifold_edges  edges with > 2 faces.
#   uv_overlap_frac   px covered 2+ times / px covered at least once, rasterised at UV_RES (512).
#                     Pixel centres must lie > 1e-3 px inside a triangle, so shared edges never count.
#   td_min / td_max / td_ratio  texel density per UV island in px/m at TD_RES (2048):
#                     sqrt(island UV area * 2048^2 / island world area). Islands < 1e-8 m^2 skipped;
#                     zero-UV-area islands are counted in uv_zero_islands and left out of the ratio.
#   uv_islands, uv_outside_islands (any UV outside 0..1 by > 1e-6)
#   ngons, triangles (faces with 3 verts), tris_total (after triangulation)
#
# Default thresholds (PASS when value <= limit): every count 0, uv_overlap_frac 0.001, td_ratio 2.0,
# tris_total 20000 (Roblox mesh budget). Override per call: diagnose(obs, thresholds={"td_ratio": 3}).
# TRIM SHEETS / tiling textures share UV space on purpose: pass {"uv_overlap_frac": 1.0} for them, or
# the overlap check FAILs at 55-90% (crate_trim_r6). A mesh with no UV map FAILs every uv_/td_ check.
#
# Load: g = {}; exec(open(r"<brain>\blender\scripts\mesh_diagnostic.py").read(), g); g["diagnose"]("Cube")
# Verified: 2026-10-12 (training round 10) in Blender 5.2.2 on 4 seeded broken props + clean cube/cylinder
#   controls (training\sandbox\broken_props.py), an unseen reviewer mesh, and copies of barrel_r3,
#   crate_trim_r6, wall_kit_r5 and blaster_r9.
import bpy, bmesh, json, math
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

UV_RES = 512
TD_RES = 2048
MERGE_DIST = 1e-5
THRESHOLDS = {
    "inward_faces": 0, "winding_flips_open": 0, "doubled_verts": 0, "loose_verts": 0, "loose_edges": 0,
    "boundary_edges": 0, "nonmanifold_edges": 0, "uv_overlap_frac": 0.001, "td_ratio": 2.0,
    "uv_outside_islands": 0, "ngons": 0, "tris_total": 20000,
}


def _objs(objs):
    if objs is None:
        objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if isinstance(objs, (str, bpy.types.Object)):
        objs = [objs]
    out = []
    for o in objs:
        o = bpy.data.objects[o] if isinstance(o, str) else o
        if o.type == "MESH":
            out.append(o)
    return out


def _bm(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    bm.from_object(ob, dg)
    bm.transform(ob.matrix_world)
    if ob.matrix_world.determinant() < 0:      # mirrored object: Blender draws it with flipped winding
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    for seq in (bm.verts, bm.edges, bm.faces):
        seq.ensure_lookup_table(); seq.index_update()
    return bm


def _vert_shells(bm):
    comp = [-1] * len(bm.verts); c = 0
    for v0 in bm.verts:
        if comp[v0.index] >= 0:
            continue
        comp[v0.index] = c; st = [v0]
        while st:
            a = st.pop()
            for e in a.link_edges:
                b = e.other_vert(a)
                if comp[b.index] < 0:
                    comp[b.index] = c; st.append(b)
        c += 1
    return comp


def _doubles(bm):
    """Returns (doubled, touching). A cluster of coincident verts is TOUCHING (separate closed parts that
    meet, e.g. kit stones - merging would make non-manifold edges, LESSONS round 5) when every member is
    in a different shell and none sits on a boundary edge or is loose. Otherwise its extra verts are
    DOUBLED (a rip, a seam split by duplicating verts, stacked copies)."""
    n = len(bm.verts)
    if n == 0:
        return 0, 0
    kd = KDTree(n)
    for v in bm.verts:
        kd.insert(v.co, v.index)
    kd.balance()
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for v in bm.verts:
        for _, j, _ in kd.find_range(v.co, MERGE_DIST):
            ra, rb = find(v.index), find(j)
            if ra != rb:
                parent[ra] = rb
    comp = _vert_shells(bm)
    open_v = [not v.link_edges or any(len(e.link_faces) != 2 for e in v.link_edges) for v in bm.verts]
    clusters = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)
    doubled = touching = 0
    for members in clusters.values():
        if len(members) < 2:
            continue
        if len(set(comp[i] for i in members)) == len(members) and not any(open_v[i] for i in members):
            touching += len(members) - 1
        else:
            doubled += len(members) - 1
    return doubled, touching


def _face_vol(f):
    vs = [l.vert.co for l in f.loops]
    return sum(vs[0].dot(vs[i].cross(vs[i + 1])) for i in range(1, len(vs) - 1)) / 6.0


def _orientation(bm):
    """Flood-fill winding per shell. Returns (inward on closed shells, minority on open shells,
    ray-cast inward on closed shells)."""
    flag = {}; inward = open_flips = ray_inward = 0
    diag = 1.0
    if bm.verts:
        mn = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
        mx = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
        diag = max((mx - mn).length, 1e-6)
    for seed in bm.faces:
        if seed in flag:
            continue
        flag[seed] = False; stack = [seed]; shell = [seed]; closed = True
        while stack:
            f = stack.pop()
            for l in f.loops:
                lf = l.edge.link_faces
                if len(lf) != 2:
                    closed = False
                    continue
                g = lf[0] if lf[1] == f else lf[1]
                lg = next(x for x in g.loops if x.edge == l.edge)
                same_dir = (lg.vert == l.vert)          # both faces walk the edge the same way -> flipped pair
                want = flag[f] ^ same_dir
                if g not in flag:
                    flag[g] = want; stack.append(g); shell.append(g)
        n_flag = sum(1 for f in shell if flag[f])
        if not closed:
            open_flips += min(n_flag, len(shell) - n_flag)
            continue
        vol = sum(_face_vol(f) * (-1.0 if flag[f] else 1.0) for f in shell)
        inward += n_flag if vol > 0 else len(shell) - n_flag
        # ray-cast cross-check on this shell alone
        vidx = {}; verts = []; polys = []
        for f in shell:
            p = []
            for v in f.verts:
                if v.index not in vidx:
                    vidx[v.index] = len(verts); verts.append(v.co.copy())
                p.append(vidx[v.index])
            polys.append(p)
        bvh = BVHTree.FromPolygons(verts, polys)
        eps = diag * 1e-5
        for own, f in enumerate(shell):             # polys[own] is f
            d = f.normal
            if d.length < 0.5:
                continue
            o = f.calc_center_median() + d * eps; hits = 0
            for _ in range(64):
                loc, _n, hi, _dist = bvh.ray_cast(o, d)
                if loc is None:
                    break
                if hi != own:                       # FromPolygons triangulates a warped quad: a ray from its
                    hits += 1                       # centroid can hit its OWN other half (wall kit, 0.1 mm warp)
                o = loc + d * eps
            ray_inward += hits % 2
    return inward, open_flips, ray_inward


def _uv_islands(bm, uvl):
    """Union-find faces across edges whose two endpoints carry the same UVs on both sides."""
    faces = bm.faces; parent = list(range(len(faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) < 2:
            continue
        for i in range(len(lf) - 1):
            f1, f2 = lf[i], lf[i + 1]
            uv1 = {l.vert: l[uvl].uv for l in f1.loops}; uv2 = {l.vert: l[uvl].uv for l in f2.loops}
            if all((uv1[v] - uv2[v]).length < 1e-6 for v in e.verts):
                ra, rb = find(f1.index), find(f2.index)
                if ra != rb:
                    parent[ra] = rb
    isl = {}
    for f in faces:
        isl.setdefault(find(f.index), []).append(f)
    return list(isl.values())


def _uv_tris(bm, uvl):
    tris = []
    for f in bm.faces:
        uvs = [l[uvl].uv for l in f.loops]
        for i in range(1, len(uvs) - 1):
            tris.append(((uvs[0].x, uvs[0].y), (uvs[i].x, uvs[i].y), (uvs[i + 1].x, uvs[i + 1].y)))
    return np.array(tris, np.float64).reshape(-1, 3, 2)


def _raster_overlap(T, res=UV_RES, inset=1e-3):
    """Coverage count raster of UV triangles. Canvas spans the whole UDIM tiles the UVs touch (max 4x4)."""
    if len(T) == 0:
        return 0.0, 0, 0
    u0 = max(math.floor(T[..., 0].min()), -2); v0 = max(math.floor(T[..., 1].min()), -2)
    u1 = min(math.ceil(T[..., 0].max()), u0 + 4); v1 = min(math.ceil(T[..., 1].max()), v0 + 4)
    u1 = max(u1, u0 + 1); v1 = max(v1, v0 + 1)
    W = (u1 - u0) * res; H = (v1 - v0) * res
    P = (T - np.array([u0, v0])) * res
    cnt = np.zeros((H, W), np.uint16)
    for a, b, c in P:
        area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(area) < 1e-12:
            continue
        s = 1.0 if area > 0 else -1.0
        x0 = max(int(math.floor(min(a[0], b[0], c[0]))), 0); x1 = min(int(math.ceil(max(a[0], b[0], c[0]))), W - 1)
        y0 = max(int(math.floor(min(a[1], b[1], c[1]))), 0); y1 = min(int(math.ceil(max(a[1], b[1], c[1]))), H - 1)
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        inside = np.ones(X.shape, bool)
        for p, q in ((a, b), (b, c), (c, a)):
            ex, ey = q[0] - p[0], q[1] - p[1]; L = math.hypot(ex, ey)
            w = s * (ex * (Y - p[1]) - ey * (X - p[0])) / L      # signed distance (px) from the edge
            inside &= w > inset
        cnt[y0:y1 + 1, x0:x1 + 1] += inside
    covered = int((cnt >= 1).sum()); over = int((cnt >= 2).sum())
    return (over / covered if covered else 0.0), over, covered


def _uv_metrics(bm):
    uvl = bm.loops.layers.uv.active
    if uvl is None:
        return {"uv_layer": None}
    T = _uv_tris(bm, uvl)
    frac, over_px, cov_px = _raster_overlap(T)
    isl = _uv_islands(bm, uvl)
    dens = []; zero = outside = 0
    for faces in isl:
        a3 = sum(f.calc_area() for f in faces); auv = 0.0; out = False
        for f in faces:
            uvs = [l[uvl].uv for l in f.loops]
            for i in range(1, len(uvs) - 1):
                auv += abs((uvs[i] - uvs[0]).cross(uvs[i + 1] - uvs[0])) / 2.0
            if not out and any(uv.x < -1e-6 or uv.y < -1e-6 or uv.x > 1 + 1e-6 or uv.y > 1 + 1e-6 for uv in uvs):
                out = True
        outside += out
        if a3 < 1e-8:
            continue
        if auv < 1e-12:
            zero += 1; continue
        dens.append(math.sqrt(auv / a3) * TD_RES)
    d = {"uv_layer": uvl.name, "uv_overlap_frac": round(frac, 6), "uv_overlap_px": over_px, "uv_covered_px": cov_px,
         "uv_islands": len(isl), "uv_outside_islands": outside, "uv_zero_islands": zero}
    if dens:
        d.update(td_min=round(min(dens), 2), td_max=round(max(dens), 2), td_ratio=round(max(dens) / min(dens), 3))
    return d


def measure(ob):
    bm = _bm(ob)
    m = {
        "verts": len(bm.verts), "faces": len(bm.faces),
        "loose_verts": sum(1 for v in bm.verts if not v.link_edges),
        "loose_edges": sum(1 for e in bm.edges if not e.link_faces),
        "boundary_edges": sum(1 for e in bm.edges if len(e.link_faces) == 1),
        "nonmanifold_edges": sum(1 for e in bm.edges if len(e.link_faces) > 2),
        "ngons": sum(1 for f in bm.faces if len(f.verts) > 4),
        "triangles": sum(1 for f in bm.faces if len(f.verts) == 3),
        "tris_total": sum(len(f.verts) - 2 for f in bm.faces),
    }
    m["doubled_verts"], m["touching_shell_verts"] = _doubles(bm)
    m.update(_uv_metrics(bm))
    w = bm.copy()                                  # welded copy for the orientation test only
    # weld only verts on open edges (rips). Welding closed parts that merely touch (kit stones) would
    # make their shared edges non-manifold, the shells "open", and a whole inside-out stone invisible.
    open_v = [v for v in w.verts if any(len(e.link_faces) != 2 for e in v.link_edges)]
    bmesh.ops.remove_doubles(w, verts=open_v, dist=MERGE_DIST)
    for seq in (w.verts, w.edges, w.faces):
        seq.ensure_lookup_table(); seq.index_update()
    w.normal_update()
    m["inward_faces"], m["winding_flips_open"], m["inward_raycast"] = _orientation(w)
    w.free(); bm.free()
    return m


def check(m, thresholds=None):
    th = dict(THRESHOLDS); th.update(thresholds or {})
    out = {}
    for k, lim in th.items():
        if k.startswith("uv_") or k.startswith("td_"):
            if m.get("uv_layer") is None:
                out[k] = "FAIL"; continue                     # no UV map at all
            if k not in m:
                out[k] = "PASS"; continue                     # e.g. td_ratio with no measurable island
        out[k] = "PASS" if m.get(k, 0) <= lim else "FAIL"
    return out


def diagnose(objs=None, thresholds=None, verbose=True):
    th = dict(THRESHOLDS); th.update(thresholds or {})
    res = {}
    for ob in _objs(objs):
        m = measure(ob); c = check(m, th)
        res[ob.name] = {"metrics": m, "checks": c, "pass": all(v == "PASS" for v in c.values())}
        if verbose:
            print("== %s: %s" % (ob.name, "PASS" if res[ob.name]["pass"] else "FAIL"))
            for k, v in c.items():
                print("   %-20s %-12s (limit %s)  %s" % (k, m.get(k, "-"), th[k], v))
    return res


def set_td(res):
    """Texel density across several objects that share one texture (a kit): (min, max, ratio)."""
    lo = [d["metrics"]["td_min"] for d in res.values() if "td_min" in d["metrics"]]
    hi = [d["metrics"]["td_max"] for d in res.values() if "td_max" in d["metrics"]]
    return (min(lo), max(hi), round(max(hi) / min(lo), 3)) if lo else None


def as_json(objs=None, thresholds=None):
    return json.dumps(diagnose(objs, thresholds, verbose=False), indent=1)

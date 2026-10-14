# Manual check (needs Blender, no tokens): taste_capture._closure captures a target under a shared parent alone.
# Verified 2026-10-12 on Blender 5.2 headless (RESULT OK, also with a cutter that renders: not linked, still cuts).
#   blender -b --factory-startup --python test/taste-closure-blender.py -- blender/taste_capture.py <scratch out dir>
import bpy, sys, json, os
args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
sc = bpy.context.scene

def cube(name, loc, size=1.0):
    bpy.ops.mesh.primitive_cube_add(size=size, location=loc)
    o = bpy.context.active_object; o.name = name; return o

stall = bpy.data.objects.new("Stall", None); sc.collection.objects.link(stall); stall.location = (10, 0, 0)
lantern = cube("Lantern", (0, 0, 0), 1.0); lantern.parent = stall; lantern.location = (0, 0, 2)
table = cube("Table", (0, 0, 0), 3.0); table.parent = stall; table.location = (0, 3, 0)
awning = cube("Awning", (0, 0, 0), 4.0); awning.parent = stall; awning.location = (0, -3, 4)
flame = cube("Flame", (0, 0, 0), 0.2); flame.parent = lantern; flame.location = (0, 0, 0.6)
cutter = cube("Cutter", (10, 0, 2.5), 0.6); cutter.hide_render = True; cutter.display_type = "WIRE"
m = lantern.modifiers.new("Bool", "BOOLEAN"); m.object = cutter; m.operation = "DIFFERENCE"
bpy.context.view_layer.update()

exec(open(src).read())
names = [o.name for o in _closure([lantern])]
print("CLOSURE", sorted(names))
dg = bpy.context.evaluated_depsgraph_get()
home = _measure(dg, [lantern, flame])
capture(out, objects=["Lantern"], round=1, part="stills")
cap = json.load(open(os.path.join(out, "capture.json")))
print("CAP", json.dumps({k: cap.get(k) for k in ("tris", "dims", "warnings", "objects")}))
print("HOME_TRIS", home[2], "HOME_DIMS", [round(v, 3) for v in (home[1] - home[0])])
ok = sorted(names) == ["Cutter", "Flame", "Lantern"] and cap["tris"] == home[2] and not cap.get("warnings")
ok = ok and abs(cap["dims"][2] - (home[1] - home[0]).z) < 1e-3
print("RESULT", "OK" if ok else "BAD")
print("SCENES", [s.name for s in bpy.data.scenes], "OBJECTS", sorted(o.name for o in bpy.data.objects))

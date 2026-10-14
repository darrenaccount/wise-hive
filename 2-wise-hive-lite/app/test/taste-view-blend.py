# Makes a tiny animated .blend for the taste-view test: a red cube that turns over 12 frames (and a big ground plane the
# renderer must leave out of the framing).  blender -b --factory-startup --python taste-view-blend.py -- <out.blend>
import bpy
import sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=1)
cube = bpy.context.object
cube.name = "R98_Cube"
mat = bpy.data.materials.new("R98_Red")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.8, 0.1, 0.05, 1)
cube.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=40)
bpy.context.object.name = "Ground"
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 1, 12
cube.rotation_euler = (0, 0, 0)
cube.keyframe_insert("rotation_euler", frame=1)
cube.rotation_euler = (0, 0, 3.14)
cube.keyframe_insert("rotation_euler", frame=12)
bpy.ops.wm.save_as_mainfile(filepath=out)

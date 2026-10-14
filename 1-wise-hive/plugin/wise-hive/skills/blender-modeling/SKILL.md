---
name: blender-modeling
description: Use before any 3D modeling, rigging, texturing or export work in Blender (Blender MCP), especially game assets for Roblox. Reuses tested scripts and past lessons from the brain's blender folder, runs a reviewer check on every build, and records what was learned afterwards.
---

# Blender modeling with memory

The user wants every Blender build to be better than the last. Don't start from scratch: reuse what already worked, check the result like a reviewer would, then save what you learned.

## 1. Recall (before touching Blender)
- Read `{{BRAIN}}\blender\LESSONS.md` (general techniques and mistakes).
- Read the newest files in `{{BRAIN}}\blender\builds\` for anything similar to this task.
- Check the script library in `{{BRAIN}}\blender\scripts\` (each script has a header comment). If a tested script already does part of the job, run or adapt it rather than writing new code.
- Check `{{BRAIN}}\memory\MEMORY.md` for memories about this project's art pipeline.
- `Grep` `{{BRAIN}}\transcripts\readable\` for the object or technique name to see exactly how it was done before.

## 2. Build
Work in small `execute_blender_code` steps that print what they did. Hard rules:
- Find shader nodes by type, never by name. Read enum values from `bl_rna`; never hardcode them.
- Material colors go on node inputs (`diffuse_color` is viewport only).
- Real-world metres; lowest point at z=0; name every object and material; apply scale.
- Never change, close or save over a file of the user's that is already open; build in a new scene or file unless asked to edit theirs.
- Roblox targets: one mesh ≤ 20k tris / 60k verts; keep EditableMeshes per client low (about 7-8).

## 3. Review (a separate pass, every build)
Act as a strict reviewer, not the author:
- `get_scene_info` (size, ground, materials, modifiers, topology): fail on non-manifold edges, loose verts, floating or sunk objects, unnamed objects, missing materials, wrong scale.
- Run `{{BRAIN}}\blender\scripts\mesh_diagnostic.py` on game meshes (normals, doubles, loose, manifold, UV overlap, texel density, ngons).
- `look` from several angles, plus wireframe for topology. Compare against the goal and any reference.
- Rigged meshes: check every deform bone has weights; test an extreme pose.
- For game assets, the in-game result is the real test, not the Blender render.
- Score it 0-10 and list the issues. Fix and re-review until there are no must-fix issues.

## 4. Record (after the build)
- Save any new reusable script in `{{BRAIN}}\blender\scripts\` with a header comment: what it does, inputs, date verified.
- Write `{{BRAIN}}\blender\builds\YYYY-MM-DD_<thing>.md`: goal, scripts used, reviewer score, issues found, fixes, what to do differently next time.
- Add general lessons (not project trivia) to `LESSONS.md` under Techniques or Mistakes.

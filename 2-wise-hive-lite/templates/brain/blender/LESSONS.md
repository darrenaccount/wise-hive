# Blender lessons

General techniques and mistakes, learned in chats and The Wise Hive training rounds. Each ends with where it was learned.

## Techniques
- Find shader nodes by type, never by name (names are localized). Read enum values from `bl_rna`; never hardcode them.
- Material colors go on shader node inputs; `material.diffuse_color` only affects the viewport.
- Work in real-world metres, lowest point at z=0, name every object and material, apply scale before export.

## Mistakes and fixes

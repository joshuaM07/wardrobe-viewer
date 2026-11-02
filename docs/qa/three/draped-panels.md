# Garment construction and loose fabric motion

The previous reconstruction inflated the entire front silhouette using the photographed side envelope. That joined sleeve and torso detail into one thick wall and capped the garment openings. A global bend/twist did not repair that construction.

All eleven GLBs now use thin front/back fabric panels, with a collapsed torso, curved hanging folds, rolled hollow sleeves, and open hems, necks and cuffs. The hood keeps its own volume. Panel UVs retain their own photographic detail through folds; the side photo is no longer stitched across the whole torso. The Made This tee's measured torso depth span drops from 144.8 to 44.2 world units; the hoodie's drops from 221.6 to 51.5. These measurements include the folds and air gap, rather than the thickness of the material itself. The eleven optimized models have 60,118 triangles.

Five driven spring modes produce body bend, twist, independent left/right cuff follow-through, and a delayed lower-hem ripple. The sleeves have different recovery rates. Excitation comes from actual turn and rail velocities, and dies away at rest. Three non-collinear shoulder support points remain pinned while cuffs and hem move relative to them, so this cannot be a rigid-body rotation. It remains a controlled deformation model, without a full cloth solver.

The vertex shader transforms normals with the deformation's full Jacobian. Prints use rest-space coordinates and follow that same surface. Double-sided fabric exposes the inside of openings without adding a second body draw pass. Collision padding projects the deformation into the rail axis, so movement in depth does not unnecessarily spread a front-facing garment's neighbors. Asset revision `draped-panels-v11` prevents the previous GLBs and textures being reused from browser cache.

Verification tools:

- `check-draped-panels.py`: checks open hem/cuff edges and positive, thin corresponding panel gaps in all optimized GLBs.
- `check-controlled-cloth.mjs`: 9,648 simulation steps and 16,623,200 model pairs across 10/11/20/100 pieces at 30/60/120 Hz. Conservative bounds include all intermediate twists and loose sleeve/hem offsets. Zero intersections; hanger support, sleep, reduced motion, and interrupted transitions pass.
- `check-cloth-shader.py`: complete production GLSL transform feedback on actual optimized vertices, including independent sleeve/hem extremes. CPU position and numeric normal-derivative comparisons pass; pinned supports, rest print coordinates and UVs remain unchanged.
- `check-motion.mjs`: refresh-rate consistency, gesture momentum, re-grab, background cache and stable hover. All 341 measured reference turn frames are retained; raw silhouette width error remains below 40 source pixels and normalized opening-progress error below 0.1.
- `check-mobile-rack.mjs`: 632 catalogue, dynamic and studio framing cases.
- Browser upload/editor and 100-piece rail checks cover both-side artwork, all four clothing types, PNG export, touch, responsive layouts, persistence and bounded texture residency.

The continuous browser capture pairs all 1,136 source frames with the actual production WebGL canvas at a controlled 60 Hz. It is a motion recording, not a measurement of hardware frame delivery. Hardware FPS remains unmeasured.

Final evidence is in `draped/`: geometry, shader transform feedback, collision/motion/framing results, browser runs, and before/after views. `public/previews/cloth-motion.mp4` contains the final construction revision captured against every reference frame; `draped/continuous.json` records its source commit, frame index, zero skipped frames and zero page errors. The final 100-piece browser run also completes with zero page errors.

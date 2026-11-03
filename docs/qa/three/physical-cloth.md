# Offline cloth poses and native rendering

The previous mesh inflated both sleeves, and a procedural shader lifted cuffs during turns. That created floating wings and a carved-looking silhouette. This revision removes that deformation system and reconstructs open fabric panels with gravity drape. Four offline physical templates cover tees, long sleeves, sweatshirts and hoodies; catalogue variants retain their registered pattern and artwork.

Blender runs only during authoring. Moderate turn onset/reversal and rail onset/reversal become four native glTF position/normal targets. The browser drives positive pose weights with measured hanger velocity and acceleration; it never extrapolates a pose negatively. Shoulder contacts and wooden supports stay fixed. Strong simulation tails are bounded to 45mm turn/20mm rail displacement and 8mm upward motion. Each pose is scaled uniformly to preserve its differential shape. There is no runtime cloth solver, image-sequence animation, or camera-dependent texture swap.

All eleven GLBs are reproducible from the caches and commands in `tools/cloth-poses/README.md`. Topology optimization copies retained positions, normals, UVs and all morph fields together. The production loader explicitly restores `morphTargetsRelative` after geometry merging; losing that flag caused shrinking in an early local capture and was rejected before publication.

Original prints and uploaded artwork use rest-pattern UV coordinates, including through deformation. Interiors and seam returns use unprinted fabric. Back maps remove front graphics; the inferred hoodie back also removes the front kangaroo pocket.

## Verification

- All eleven production GLBs load through the production loader/merge. 52,044 sampled native evaluations match the expected physical displacement. Hangers have zero pose offsets.
- 4,704 interrupted motion steps at 30/60/120Hz cover 10/11/20/100-piece collections. Conservative occupied bounds include current pose displacement. All 6,162,240 model-pair comparisons are disjoint. Separate depth lanes protect detail entrances and returns.
- 632 phone, tablet, landscape and studio framing cases fit actual garment bounds. Upload/type-switching race, shared geometry ownership, disposal and export-state checks pass.
- The corrected native browser capture retains all 870 interaction frames at a controlled 60Hz: hover, opening, mobile full turns, release, reverse, recovery and return. It shows no floating cuff bulbs, shrinking or wringing. This recording was the tee integration gate before final seam/back texture polish. The QA recorder preserves the drawing buffer so idle frames remain readable; production retains demand rendering with buffer preservation disabled. This is controlled motion evidence, not measured device FPS.
- Exact native pose interpolation with production GLSL is also reviewed across 240 consecutive forward/reverse frames for each of the four garment types. Sleeve motion stays below its support. The final catalogue sheet and four type videos record the neutral seam and hoodie-back corrections. `public/previews/cloth-motion.mp4` concatenates all 960 final pose frames with no skipped motion frames; it is an offline geometry/shader preview.
- Production fragment pixels under EGL confirm artwork is visible outside and absent on exposed fabric interiors.
- The supplied reference contains 1,136 consecutive 60Hz source frames. Current projected widths are reported in `physical-cloth-motion.json`, including differences from the source. Width is a diagnostic because drape changes silhouette independently of turn timing; it is not proof of perceptual smoothness.

Browser results for design creation, native touch, responsive controls, exports, saved designs and 100-piece racks are retained under `physical-studio/` and `physical-long-rack/`. Build, typecheck and lint are part of the release checks.

These are lightweight two-panel hanging assets, not full garment CAD or scanned cloth. Exact side silhouettes and unseen backs remain approximations. Hardware mobile FPS has not been measured; SwiftShader timings do not establish device performance. Older QA documents describe superseded iterations.

# Verification of the Three.js rewrite

The current renderer uses immutable GLB geometry and continuous rigid transforms. The prior photographic animation atlases and CPU Canvas2D blur were removed from the shipped app. They remain recoverable in Git history.

## Reference comparison

All 1,136 reference frames were decoded and visually reviewed in order. The frame audit records whole-frame deltas; it is not a pixel-perfect similarity score. The current turn calibration additionally processes every one of the 341 frames across the seven revealed turns, records silhouette widths and hanger centres, and fits the production GLB projection response. Threshold segmentation has uncertainty and visible occlusion, particularly in the Cheers sequence. Nothing is represented as a perfect match to unseen artwork. Reviewing the consecutive Cheers frames also revealed a moving metallic cursor captured in the earlier front photo. Clean reference frame 898 is registered onto the occluded region of the original frontal capture. Registration correlation is 0.9411; the original frontal alpha, scale, and artwork outside that region are preserved. The source crops and registration script are retained for reproduction.

The latest comparison corrected resting meshes that were too thin. The reproducible triangle projection check measures resting cloth silhouette overlap of 97.4–98.5%, with projected widths within three source pixels. It excludes hanger and hook pixels above row 110; the earlier full-silhouette comparison is retained separately. Captured front silhouette overlap is 99.2–99.5%. These compare garment outlines rather than the entire UI, fabric pixels, or motion frames.

The turn response now uses per-garment stiffness and damping inferred from those measurements. Replay trigger times were corrected to the measured onset; interactive hover has no artificial input delay. Fits reduce average width error to approximately 5–14 source pixels per turn. Neighbor spacing, individual product framing, the ticker, and the product/rack transitions retain the reference measurements.

## Artwork continuity correction

The earlier material switched between captured front and side photographs according to yaw. That produced a visible change in the print as garments returned to the rack. The rotation-controlled switch and its side texture loading are now removed. Front and back use their fixed mesh UVs at every angle; seams use fabric color. The production shader has no angle, side-blend, or projected side-photo input. Resting silhouettes still use the same offline geometry constraints.

`tools/check-uv-continuity.py` renders all 11 actual GLBs through outward and return rotations with an orbiting inspection camera. Keeping the same front surface in view separates texture changes from foreshortening. `uv-continuity.json` records all 891 poses. This is a production-GLSL asset regression check, not a browser FPS measurement.

## Actual geometry and shader checks

The production material factory and Three.js shader chunks are expanded by `tools/check-garment-shader.mjs`, then compiled under Mesa/EGL by `tools/render-mesh-qa.py`. Both the actual garment shader and the production Gaussian blur shader compile. All 11 GLBs load as closed garment shells and wooden hanger surfaces. Their six surfaces merge without groups into one body draw call; a separately modelled metal hook uses one additional draw call.

`docs/qa/three/` retains every product render, the resting rack, intermediate Flowers angles, projection metrics, and software-driver timings. Its `turns/` directory contains a 341-frame side-by-side video, frame index, and consecutive contact sheets covering every reference turn frame. The offscreen renderer preserves production geometry, UVs, custom material branches, static fold relief, and color conversion. Its alignment poster uses the rail photograph; production Three.js renders the physical chrome rail. These are asset checks, not a browser FPS measurement or a complete WebGL scene benchmark.

## Selection and rendering cost

Static BVHs are built once while loading. A CPU test casts 384 rays through the actual rack meshes in each of two poses and compares all selections with Three.js's standard raycast. Every selection agrees. The latest measured BVH 95th percentile is about 0.02–0.03 ms per pick, versus 2.4–2.9 ms for the unaccelerated scan. Results are in `picking.json` and are explicitly Node CPU timings, not browser FPS.

The renderer compiles programs and uploads textures before enabling interaction. It caps the drawing buffer at 1.4 million pixels and DPR 1.5, reduces resolution after sustained slow frame intervals, renders the product background blur at half resolution, and stops rendering after the springs settle. It does not decode images or rebuild geometry per frame. A WebGL-capable browser exposes live frame intervals, draw calls, triangle counts, texture counts, and buffer dimensions through the canvas `data-performance` attribute.

## Browser scope and checks

The managed Chrome preview cannot create WebGL contexts: its observed error reports a disabled GL vendor/renderer and failed context initialization. Native GPU rendering, drag rotation, replay, and browser FPS cannot be honestly certified in this environment. Browser QA therefore checks the explicitly labelled static fallback and the UI, while production GLSL and meshes are checked separately offscreen. Replay is disabled in the fallback; it does not silently emulate 3D with image sequences.

The settled product layout has the expected header/ticker fade, wall opacity 0.05, per-garment framing, controls, and zero internal scrolling. Previous/next, keyboard navigation, closing, availability, adding/removing the hoodie, and local information panels are checked in the preview. `overflow: clip` prevents the earlier focus-induced internal card scroll. Browser captures clearly display the fallback status.

Next.js production static export, TypeScript checking, and ESLint pass. The final Site publishing workflow builds the committed source and keeps the existing private audience. GitHub source-tree hashes are checked against each corresponding local commit before updating main.

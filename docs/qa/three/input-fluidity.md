# Input fluidity and rendering follow-up

The interaction fixes address sources of visible interruption in addition to the reference-fitted spring response:

- Hover raycasts use intended rack poses, independent of the moving render meshes. The acquired surface is retained while its garment turns and returns from a displaced neighbor position. In 270 acquisitions on the production meshes, ownership remains stable throughout 45 consecutive animation frames. The previous animated-mesh policy loses ownership in 20 of those cases. `input-motion.json` includes examples.
- Clicking a hovered garment uses the same ownership. Blurring a keyboard rack button while the pointer is on the canvas no longer clears that ownership before the click. A real browser regression reproduces the displaced crewneck case with small pointer movements, then clicks it. All nine desktop/touch browser checks pass with no page errors; results are in `interaction-browser.json`.
- Dragged rotation follows the hand directly. The previous critically damped pointer filter introduced visible lag. Free release still uses exponentially damped momentum; front/back controls retain spring motion. Re-grabbing, holds, cancellation and reduced motion retain their existing behavior.
- The frame entry point passes the full elapsed interval to the analytic springs and glide. It no longer discards elapsed time beyond 100 ms, which stretched physical timing on a slow GPU. A regression exercises an actual 300 ms frame.
- Adaptive resolution can now reduce a DPR=1 canvas smaller than the old absolute 450,000-pixel floor. When reducing resolution, the budget floor is 49% of the current CSS area (70% of each dimension), capped at 450,000 pixels. Fast devices retain the original resolution limits.

The eleven static GLBs were optimized offline with meshoptimizer from Three.js. Material borders are locked. Surviving positions, normals and UVs are copied exactly; textures and object-space artwork placement are unchanged. Garment triangles fell from 202,176 to 60,844 (69.9% reduction). The complete ten-garment rack, rail and hooks now submit 60,832 triangles, versus 188,812. A settled Flowers product frame submits 5,402 triangles and three draw calls.

`mesh-quality.json` compares the original and optimized geometry with the production shader at 24 angles per garment: 264 poses including the hoodie, fronts, backs and edge-on views. At one pixel per world unit, the minimum silhouette intersection-over-union is 0.999055 and the maximum mean RGB difference within the garment union is 0.5347/255. This is a rendered comparison, separate from the simplifier's error metric. `mesh-quality.jpg` shows paired poses. The optimizer rejects already optimized input to prevent cumulative simplification.

`native-frame-delivery.json` records sequential native-clock reference replays on the same cloud machine using Chromium/SwiftShader. The baseline uses commit `cd88216`. The current run produces more rendered frames and reduces the 95th-percentile consecutive-frame interval from 516.7 ms to 283.4 ms. The median increases from 33.4 ms to 66.7 ms; these bursty software-renderer timings do not establish smooth hardware playback or a 60 fps result. Both raw traces, buffer sizes, build configurations and all metrics are retained. Intentional frames with no drawing are excluded from the consecutive-frame distribution. The quality adaptation was enabled in both versions.

The continuous reference comparison uses a separate controlled 60 Hz animation clock. It was refreshed from renderer commit `f49fd0b` in one uninterrupted run, retains every one of the 1,136 source frames and does not measure native frame delivery. Every new output frame was compared with the preceding complete capture; the maximum full-canvas mean RGB difference is 0.282807/255. The motion trajectories, product reveals and spring parameters are unchanged by the topology optimization. Neither the continuous capture nor still-image quality metrics establish perceptual parity with the reference.

Reproduce after rebuilding original assets and starting the production export:

```sh
node tools/optimize-garment-meshes.mjs
node tools/check-garment-shader.mjs /tmp/wardrobe-shaders.json
WARDROBE_SHADER_PATH=/tmp/wardrobe-shaders.json python tools/check-mesh-optimization.py /path/to/original-models /tmp/mesh-quality
node tools/check-motion.mjs /tmp/input-motion.json
python tools/check-browser-motion.py http://localhost:3001 /tmp/browser-motion
python tools/profile-browser-motion.py http://localhost:3001 /tmp/native-delivery.json
```

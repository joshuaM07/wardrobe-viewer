# Fluid garment motion verification

Reference: https://x.com/cambreedesigns/status/2104999693113766152

The initial implementation review used a sampled contact sheet. That was insufficient to establish motion parity. The subsequent review decoded the original 3448 × 2160 clip without frame selection and inspected all 1,136 frames in 32 consecutive sheets, with larger consecutive crops for turns and product changes. `reference-frame-audit.json` retains every timestamp, JPEG hash, and adjacent-frame image-space diagnostic. Existing silhouette measurements also cover 341 frames of seven turns.

The renderer integrates a damped oscillator analytically instead of using frame-dependent Euler substeps. Garment turns retain individual stiffness and damping. The first black tee was refitted from consecutive silhouette measurements: its turn crosses the front and continues settling, rather than stopping when it first appears front-facing. Other candidate fits were rejected because pale fabric and occlusions made them uncertain. Neighbor displacement, product positioning, and the camera respond directly to input targets. Hanger roll follows turn and rail velocity with a longer decay, including neighboring garments. Geometry, UVs, and surface artwork stay fixed.

Reference frames 606–620, 643–657, 677–691, and 732–746 show a centered product reveal. Product navigation now places the next mesh at its detail position, facing forward, and reveals its body and hook over 220 ms. It no longer slides visibly across the rack. The initial rack-to-product transition remains continuous.

Closing the desktop viewer also releases rack focus, allowing garments to settle back. Mobile keeps its current browsing position. The replay's return at 13.55 seconds follows the same release instead of leaving the Flowers tee facing forward indefinitely.

Pointer velocity is measured in event time. Released product rotation decays exponentially with friction 5.5/s and a 12 rad/s velocity cap. A hold longer than 80 ms releases without a fling. Re-grabbing begins at the visible orientation and stops the coast. Front/back controls, selection changes, cancellation, and reduced-motion preferences cancel momentum. Touch swipes project to a nearby bounded rack position and suppress the synthetic click.

The blurred product background is reused while the rack and camera are stationary. Its cache includes selection, rack transforms, projection, dimensions, and texture revisions, including late artwork loads. A rotating Flowers tee uses 3 draw calls and 16,494 triangles, compared with the previous 35 calls and 188,816 triangles. Background changes still rerender immediately; cache signatures ignore changes smaller than 0.0001 world units or radians.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
node tools/check-motion.mjs /tmp/fluid-motion.json
node tools/check-mobile-rack.mjs /tmp/mobile-framing.json
node tools/check-design-studio.mjs
node tools/check-garment-shader.mjs
PORT=3001 pnpm start
# Separate terminal; requires Python Playwright and installed Chromium:
python tools/check-browser-motion.py http://localhost:3001 /tmp/wardrobe-browser-qa
```

`fluid-motion.json` records 54 spring comparisons across 30, 60, 90, 120, and 144 Hz plus irregular frame intervals. It also covers rapid retargeting, neighbor response, fling direction, re-grabs, held releases, reduced motion, centered product reveals, hanger follow-through after the main turn, and cache invalidation. The first tee's modeled yaw settles after approximately 1.7 seconds; its near-front arrival occurs earlier. The previous universal 0.50–0.60-second endpoint statement did not describe the reference's full motion. The nearest neighbor travels 157.35 of its 182 world units within 250 ms. All 632 actual-GLB camera-framing cases pass, including 20-piece racks, studio layouts, and hoodies.

`fluid-browser.json` records production-export interaction checks in Chromium with SwiftShader software WebGL: mouse and touch rotation, release momentum, front control, rapid navigation, return to rack, mobile swiping without accidental clicks, and reduced motion. No page errors occurred. This verifies browser behavior and draw counts. Software rendering does not establish hardware FPS or guarantee subjective parity with the reference on a particular device. Hardware frame pacing remains to be checked using the canvas `data-performance` measurements on the target phone and desktop.

## Continuous comparison

[The full comparison](continuous-comparison.mp4) pairs every original source frame with the actual browser WebGL canvas at the same simulation timestamp: 1,136 consecutive pairs, encoded at 60 fps. `continuous-capture.json` records capture coverage. The current video was refreshed from renderer commit `f49fd0b` in one uninterrupted capture after the input and topology fixes. All 1,136 output frames were also compared with the prior complete capture; the maximum full-canvas mean RGB change is 0.282807/255. The topology change retains the existing motion trajectories. The application's JavaScript animation clock is controlled during capture; the resulting video tests motion trajectories, not real-time frame delivery. DOM labels, controls, and wall styling are excluded on the application side. Static frames reuse the previous rendered image, as the application itself uses demand-driven rendering.

The full comparison exposes remaining differences in mesh silhouettes and motion; it is review evidence, not a claim that native playback feels identical. Inspecting all frames improves temporal coverage, but neither contact sheets nor this controlled capture establish perceptual or hardware playback parity.

To reproduce after starting the production export:

```sh
mkdir -p /tmp/wardrobe-continuous/reference
ffmpeg -i /path/to/reference.mp4 -map 0:v:0 -fps_mode passthrough -start_number 0 -q:v 2 /tmp/wardrobe-continuous/reference/%04d.jpg
python tools/audit-reference-video.py /path/to/reference.mp4 /tmp/wardrobe-continuous
python tools/fit-consecutive-turns.py /tmp/wardrobe-continuous/reference /tmp/wardrobe-turn-fits.json
python tools/capture-continuous-motion.py http://localhost:3001 /tmp/wardrobe-continuous/capture /tmp/wardrobe-continuous/reference
```

Subsequent input stability, direct manipulation, mesh quality and native frame delivery checks are documented in [input-fluidity.md](input-fluidity.md).

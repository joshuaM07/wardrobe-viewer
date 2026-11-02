# Fluid garment motion verification

Reference: https://x.com/cambreedesigns/status/2104999693113766152

The 18.933-second reference was retrieved and inspected as a consecutive contact sheet. Its motion uses essentially rigid garments, hanger turns, restrained roll, and adjacent pieces making space. Existing full-resolution measurements cover 341 frames of seven turns.

The renderer now integrates a damped oscillator analytically instead of using frame-dependent Euler substeps. Garment turns retain their individual stiffness, with a damping ratio at most 0.85 so rotation can settle continuously through its endpoint. Neighbor displacement, product positioning, and the camera each respond directly to their input target, removing cascaded easing. Hanger roll responds to turn and rail velocity, including neighboring garments. Geometry, UVs, and surface artwork stay fixed.

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

`fluid-motion.json` records 54 spring comparisons across 30, 60, 90, 120, and 144 Hz plus irregular frame intervals. It also covers rapid retargeting, neighbor response, fling direction, re-grabs, held releases, reduced motion, and cache invalidation. Turns settle in 0.50–0.60 seconds using yaw error <0.02 rad and normalized turn velocity <0.15/s; overshoot is 0.63–0.72%. The nearest neighbor travels 157.35 of its 182 world units within 250 ms. All 632 actual-GLB camera-framing cases pass, including 20-piece racks, studio layouts, and hoodies.

`fluid-browser.json` records production-export interaction checks in Chromium with SwiftShader software WebGL: mouse and touch rotation, release momentum, front control, rapid navigation, return to rack, mobile swiping without accidental clicks, and reduced motion. No page errors occurred. This verifies browser behavior and draw counts. Software rendering does not establish hardware FPS or guarantee subjective parity with the reference on a particular device. Hardware frame pacing remains to be checked using the canvas `data-performance` measurements on the target phone and desktop.

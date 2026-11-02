# Controlled fabric follow-through and clearance

The motion stays deterministic. Two small spring controls bend and twist the lower cloth in response to turn and rail velocity. The warp fades in below the shoulders; neck, hanger and hook stay pinned. Hoodies receive half the tee response, and long sleeves receive three quarters. There is no particle cloth solver, fabric collision simulation, idle waving or random noise. Loaded vertex buffers and BVHs remain static.

The previous large roll of the entire hanger and garment is reduced. The hem carries more of the follow-through, and its normal changes with the deformation. Artwork uses unchanged UVs and rest-space placement coordinates before the warp, so original and uploaded prints move with the fabric. All cloth surfaces, including seams, use the same continuous warp. The GPU test exercises the full production vertex shader, not a separate preview implementation.

Rack positions make room for the final facing poses, with current outgoing and incoming geometry handled by the clearance projection. Conservative horizontal envelopes include current rotation, scale, roll and deformation. An ordered clearance projection prevents transient intersections while preserving piece order. Closing turns are damped; incoming turns share a bounded opening allowance with outgoing pieces so rapid browsing does not leave many fronts open simultaneously. Root spring velocity is retained except when it points into a contact constraint. The selected detail uses a separate depth lane throughout opening and return. Replacing a detail restores the outgoing piece behind the dimmed background rather than flying it through the next model. Interrupted close/reopen paths release earlier detail occupants too.

The rail has short tube overhangs beyond the original wall brackets to support the wider transient spacing. Added collections extend the physical rail; the viewport shows a section of the expanded collection. Reduced motion removes both fabric modes and hanger roll. All motion returns to a sleeping renderer after settling.

Verification:

- `controlled-cloth.json`: 6,407 consecutive simulation frames and 580,250 pair checks on actual 10-, 11- and 20-piece collections at 30, 60 and 120 Hz. Conservative 3D bounds, including fabric displacement, show zero intersections in the tested rapid reversals and interrupted detail paths. The checks include all 1,136 reference-replay frames. Every tested hanger remains within the actual rail bounds, and the ten-piece catalogue remains inside the frame. Observed maxima are 1.26° hanger roll, 2.56° hem twist and 9.75 world units of hem bend. These are observed test maxima, not universal input limits.
- `controlled-cloth-shader.json`: 2,178 GLB vertices at three deformation settings through the full production GLSL under EGL transform feedback. GPU positions agree with the CPU warp within 0.000042 world units; normals agree with numerical derivatives within 0.000001. Pinned support positions, UVs and rest-space print coordinates are retained.
- `controlled-cloth-browser.json`: all nine desktop/touch checks pass, including stable hover, click selection, rapid navigation, drag/release, mobile swipes and reduced motion. No page errors.
- `controlled-cloth-motion.json`: refresh-rate spring checks, 267 stable hover acquisitions, reference-width guards and raster-cache invalidation pass. Camera framing passes all 632 existing cases, including the hoodie and 20-piece studio. Design texture lifecycle and six image-processing checks pass. Production build and lint pass.

[The continuous reference comparison](continuous-comparison.mp4) is refreshed from renderer commit `01ad17a` in one uninterrupted capture and retains all 1,136 source frames. `continuous-capture.json` records every output image hash and the video hash. Its controlled clock checks trajectories, not native frame delivery or perceptual parity. The earlier topology and native software-driver measurements remain historical evidence for commit `f49fd0b`; they do not measure the added cloth warp.

Reproduce with the production export running:

```sh
node tools/check-controlled-cloth.mjs /tmp/controlled-cloth.json /tmp/cloth-fixture.json
node tools/check-garment-shader.mjs /tmp/cloth-shaders.json
python tools/check-cloth-shader.py /tmp/cloth-shaders.json /tmp/cloth-fixture.json /tmp/cloth-gpu.json
node tools/check-motion.mjs /tmp/motion.json
node tools/check-mobile-rack.mjs /tmp/framing.json
python tools/check-browser-motion.py http://localhost:3001 /tmp/browser
```

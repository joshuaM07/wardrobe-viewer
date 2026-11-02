# Long rail and garment contacts

The collection supports 100 total pieces (ten catalogue pieces and up to ninety saved custom pieces). Beyond the catalogue layout, each added piece receives a fixed 320-unit slot on a longer rail. The camera browses a section of that rail. Desktop and mobile both provide a scrollbar, arrows, keyboard navigation, dragging, and wheel/trackpad scrolling. Touch release uses elapsed-time exponential momentum decay and settles on a garment.

Rail movement uses mass-dependent damped springs. A conservative occupied envelope accounts for the current mesh, rotation, scale, hanger roll, and bounded fabric displacement. Inelastic contacts distribute positional corrections and exchange velocity by inverse mass. Tees, long sleeves, crewnecks, and hoodies have different relative masses. Detail viewing uses a separate depth lane during entry and return. Fabric retains the two controlled bend/twist modes with pinned shoulders; this is not a full cloth or soft-body simulation.

Mesh geometry, picking BVHs, original maps, and neutral fabric atlases are shared across instances. Artwork textures are retained near the current viewport and released outside it. Residency epochs prevent an old asynchronous image decode from bringing back an evicted print. Removing or replacing a piece preserves shared assets used by other pieces. The rail extends without stretching its support brackets, which repeat along its length.

Verified on the production static export:

- `node tools/check-controlled-cloth.mjs docs/qa/three/long-rack-physics.json`: 9,648 simulation steps, 16,623,200 model-pair checks, zero conservative 3D bounds intersections. Collections of 10, 11, 20, and 100 at 30/60/120 Hz, rapid retargeting, full rotations, interrupted detail transitions, reduced motion, momentum conservation for a colliding pair, and dissipated collision energy. Includes all 1,136 reference timeline steps.
- `node tools/check-motion.mjs`: spring consistency, direct manipulation, coasting/re-grab, sleeping, background caching, and 267 stable hover acquisitions on real geometry. Reference turn measurements retain all 341 measured turn frames.
- `node tools/check-mobile-rack.mjs /tmp/mobile-framing.json`: 132 catalogue, 260 studio, and 240 dynamic framing checks on phones, landscape screens, tablets, and desktop.
- `node tools/check-design-studio.mjs`: upload races, eviction during image decode, shared atlas ownership, removal/replacement, 100-piece saved-state validation, print fitting, image processing, and export failure recovery.
- `python tools/check-browser-long-rack.py http://localhost:3001 /tmp/long-rack`: real Chromium scrollbar, mouse wheel, native touch release momentum, keyboard selection, product wraparound, mobile layouts, and 100-piece reload persistence. No page errors. At the last piece, desktop rendered 26 draw calls with 11 resident custom designs and 50 textures; portrait phones rendered 6 draw calls with 4 resident designs and 43 textures. All 100 model instances remain in the collection, using 11 shared meshes. Results and screenshots are in `long-rack/`.
- `pnpm build`, `pnpm typecheck`, and `pnpm lint` pass.

Browser QA uses Chromium with SwiftShader. These checks verify behavior and resource residency; hardware browser frame rate remains unmeasured. Designs are saved in this browser's IndexedDB and do not sync between devices.

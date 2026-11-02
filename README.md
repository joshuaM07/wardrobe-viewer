# Wardrobe Viewer

A Next.js App Router recreation of the supplied Batch Merch clothing rack, rendered with **Three.js**, with a garment design studio. Thin front and back fabric panels with open hems and cuffs carry photographic fabric detail and artwork. Offline cloth bakes supply gravity drape and bounded native vertex poses; continuous rotation, damped hanger sway, and deformation-aware lighting keep garments responsive without runtime cloth simulation.

## Run

Node 22.13 or later and pnpm 11 are required.

```sh
git clone https://github.com/joshuaM07/wardrobe-viewer.git
cd wardrobe-viewer
pnpm install --frozen-lockfile
pnpm dev
```

Normal checkouts run Next.js. Managed Sites preview uses its Vite/Vinext adapter for the same source. Production builds with Next.js and exports to `out/`.

```sh
pnpm typecheck
pnpm build
pnpm start
```

`pnpm start` serves the export on localhost:3000. No database, secrets, upload service, or remote media API is required.

## Explore and customize

- Hover a garment to turn it forward; click or press Enter to inspect it. Rack arrows browse without opening the viewer.
- On desktop and mobile, swipe or drag, use arrows, scroll with a mouse/trackpad, or move the slider. The nearest piece faces forward automatically; camera movement stops at the rail ends.
- Drag a selected piece through a full rotation, then release to let it coast. Grab it again to stop it, or use Front and Back. Rack swipes coast with damped momentum before settling on a piece. Arrow keys navigate pieces; Escape closes the editor before closing the viewer.
- Choose **Create your piece** on the rack, pick a T-shirt, long sleeve, crewneck or hoodie, and optionally upload a design before opening the 3D editor. You can also **Customize** an existing catalogue piece.
- Use **Front**, **Back**, and **Fabric colour** in the editor. Upload separate artwork on either side, change print size and placement, and choose swatches, a custom colour, or a hex value. Uploads fit the selected garment’s print area automatically; hoodie fronts stay above the pocket. Transparent images retain their alpha.
- PNG, JPG, and WebP files up to 15 MB are supported. Images decode once, reduce to a 1536px maximum edge, and lose unnecessary transparent padding. Artwork never switches to a screen overlay during rotation.
- Change **Clothing type** on a custom piece to preview the same artwork on any of the four garment types without re-uploading or adding duplicates. Changing the type of a catalogue garment creates a blank copy with your uploaded artwork. Up to 100 total pieces fit on a rail that extends with fixed spacing; custom pieces can be removed.
- **Download PNG** exports the current garment view as a 1200 × 1500 transparent image, independent of preview resolution.
- The editor uses a bottom sheet on phones and portrait tablets, and a side panel in landscape and on desktop. Its preview stays separate from the scrolling controls.
- Designs, added pieces, and processed images save in IndexedDB on the current device. There is no account sync; removing browser storage also removes these designs. Save failures appear in the editor.
- The bottom handle also offers **Replay motion**. Reduced-motion preferences are honored.

Availability, About, and Contact remain local presentation panels. Live inventory and checkout are not connected. Without WebGL, an explicitly labelled static catalogue preview appears and customization is disabled.

## Rendering and assets

`lib/wardrobe-three.ts` owns the renderer, orthographic camera, demand-driven animation, chrome rail, GPU background blur, selection, and design texture lifecycle. Instances share template geometry, picking BVHs, and fabric atlases. Only designs near the viewport retain artwork textures; offscreen artwork is released and restored on demand. Geometry and picking BVHs stay fixed during interaction. Each garment/hanger uses one body draw call plus one metal hook. Rotation follows the pointer directly during dragging, then coasts with damped momentum. Hover picking uses stable target poses and retains the acquired surface through a turn, preventing animation from changing its own selection. Garment turns retain a small overshoot. Mass-dependent rail springs and inelastic, mass-weighted contact impulses keep neighboring pieces apart using their current geometry, scale, rotation, and bounded fabric motion. Four native glTF displacement poses come from offline cloth simulation of turn onset/reversal and rail onset/reversal. Gesture velocity and acceleration drive bounded, damped pose weights. Each clothing type has its own gravity drape, mass, stiffness and contact pins; the shoulders and wooden hanger stay supported. Negative extrapolation and procedural cuff-lift waves have been removed. Hanger roll stays small, and all secondary motion dies away at rest. Detail transitions use a separate depth lane. A stationary blurred rack background is cached during product rotation. Rendering stops when the scene settles and pauses while the document is hidden. Resolution adapts to the pixel budget and measured frame intervals. Mobile retains a 750,000-pixel limit and DPR up to 2; desktop retains 1.4 million pixels and DPR 1.5.

`lib/garment-material.ts` retains the original fixed UV albedo atlas, separate front/back surfaces, and wooden hanger. Neutral fabric maps are loaded only when a piece is customized. The material combines a colour-neutral fold texture, optional original-graphic mask, and independent alpha artwork for each side. Artwork placement uses fixed pattern coordinates derived from rest UVs, including a reversed X coordinate on the back so lettering reads correctly. Lighting follows native morphed normals, and exposed fabric interiors remain unprinted. Slider movement changes uniforms, with no image decoding, mesh rebuild, or shader compilation. Superseded uploads and removed pieces release their textures; late uploads cannot overwrite newer choices.

`lib/garment-design.ts` supplies template types, upload processing, saved-state validation, and rack placement. `components/GarmentStudio.tsx` is a desktop side panel and mobile bottom sheet; the canvas fits the full piece alongside it.

`public/models/` contains GLBs and fixed textures. `lib/garments.json` describes catalogue meshes, hanger pivots, resting angles, framing, and calibrated turn response. The eleven optimized meshes use 104,266 triangles with four native position/normal poses each. Run `python tools/rebuild-physical-cloth.py` to reproduce them from the archived offline caches in `tools/cloth-poses/`; its README documents simulation authoring and pose limits. Source photograph reconstruction remains in `tools/build-garment-meshes.py`. `tools/build-custom-fabric.py` produces neutral maps and print masks. Front/back texture coordinates remain fixed throughout a turn; there are no angle atlases, runtime cloth solvers, or per-frame image loads. These lightweight hanging surfaces approximate garments rather than full garment CAD or scanned cloth.

## Reference and verification

All **1,136 frames at 60 fps** of the supplied reference were decoded in order. Layout and motion measurements are in `docs/reference-analysis.md`; subsequent comparisons retain all **341 frames of seven revealed turns**. Seven fronts use the supplied pixels. Camo, studio, and washed-grey fronts, unseen backs, and added hoodies include inferred photography or surfaces; they do not claim to reproduce unseen original artwork.

Production GLSL and native GLBs are rendered under Mesa/EGL for asset QA. The current checks cover all eleven physical assets, four clothing templates, transparent front/back prints, uploads and type switching, texture disposal, persistence, and 632 mobile/studio camera-framing cases. The cloth clearance check covers 4,704 interrupted simulation steps and 6,162,240 model pairs at 30/60/120Hz for 10/11/20/100-piece collections, with zero conservative bound intersections. The browser checks exercise scrollbar, wheel, native touch, keyboard selection, bounded artwork residency and persisted 100-piece collections. Current evidence is documented in `docs/qa/three/physical-cloth.md`; older iterations remain historical. Reference width differences are reported as diagnostics, because draped geometry changes projected width independently of turn timing; width alone does not establish perceptual smoothness.

Chromium with software WebGL verifies desktop and mobile interactions. Hardware browser FPS has not been verified; software-driver timings do not establish hardware performance. The WebGL canvas exposes measured browser intervals, draw counts, resolution, rotation, and coasting state in its `data-performance` attribute on a WebGL-capable browser.

Offline tools are not needed to run or deploy the app. Python QA requires Pillow, NumPy, SciPy, OpenCV, ModernGL, and reference crops. `node tools/check-design-studio.mjs` also exercises native image processing when `@napi-rs/canvas` is available, including through the primary runtime. `node tools/check-mobile-rack.mjs` validates production renderer transforms against the actual GLB bounds. `node tools/check-motion.mjs` checks spring consistency across refresh rates, direct dragging, momentum, re-grabs, stable hover acquisitions on actual meshes, stalled frames, adaptive resolution, reference turn widths, and background-cache invalidation. `python tools/check-browser-motion.py http://localhost:3001 /tmp/wardrobe-browser-qa` verifies desktop and touch interactions against a running production export with Playwright Chromium. Motion verification and its hardware-performance limits are recorded in `docs/qa/three/fluid-motion.md` and `docs/qa/three/input-fluidity.md`. The current cloth construction and continuous captures are documented in `docs/qa/three/physical-cloth.md`; earlier attempts remain in `docs/qa/three/draped-panels.md` and `docs/qa/three/controlled-cloth.md`. Upload/type switching, PNG exports, persistence and responsive layouts are verified in `docs/qa/three/responsive-studio.md` with `tools/check-browser-studio.py`. `tools/profile-browser-motion.py` measures native wall-clock frame delivery separately from controlled motion captures.

## Source history

Meaningful implementation and verification steps are committed and pushed to [joshuaM07/wardrobe-viewer](https://github.com/joshuaM07/wardrobe-viewer). Credentials are never bundled in the source.

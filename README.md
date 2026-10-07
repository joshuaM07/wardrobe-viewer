# Wardrobe Viewer

A Next.js App Router recreation of the supplied Batch Merch clothing rack, rendered with **Three.js**, with a garment design studio. Closed front, back, and seam meshes carry photographic fabric detail and artwork. Continuous rotation, damped hanger sway, and soft normal-based lighting keep garments responsive without runtime cloth simulation.

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
- On mobile, swipe, use arrows, or move the slider. The nearest piece faces forward automatically; camera movement stops at the rail ends.
- Drag a selected piece through a full rotation, or use Front and Back. Arrow keys navigate pieces; Escape closes the editor before closing the viewer.
- Choose **Customize** to set any fabric colour with swatches, the colour picker, or a hex value. Keep or remove the original graphic.
- Upload independent front and back artwork, then change print size and horizontal/vertical placement while viewing it on the actual mesh. Transparent PNGs retain their alpha.
- PNG, JPG, and WebP files up to 15 MB are supported. Images decode once, reduce to a 1536px maximum edge, and lose unnecessary transparent padding. Artwork never switches to a screen overlay during rotation.
- Add blank T-shirts, long sleeves, crewnecks, or hoodies from the studio or bottom handle. Up to 20 pieces spread along the rail, with spacing around the active garment. Added pieces can be removed.
- Designs, added pieces, and processed images save in IndexedDB on the current device. There is no account sync; removing browser storage also removes these designs. Save failures appear in the editor.
- The bottom handle also offers **Replay motion**. Reduced-motion preferences are honored.

Availability, About, and Contact remain local presentation panels. Live inventory and checkout are not connected. Without WebGL, an explicitly labelled static catalogue preview appears and customization is disabled.

## Rendering and assets

`lib/wardrobe-three.ts` owns the renderer, orthographic camera, demand-driven animation, chrome rail, GPU background blur, selection, and design texture lifecycle. Geometry and picking BVHs stay fixed during interaction. Each garment/hanger uses one body draw call plus one metal hook. Rotation follows the pointer with a faster spring during dragging, then settles; rendering stops when the scene settles and pauses while the document is hidden. Resolution adapts to the pixel budget and measured frame intervals. Mobile retains a 750,000-pixel limit and DPR up to 2; desktop retains 1.4 million pixels and DPR 1.5.

`lib/garment-material.ts` retains the original fixed UV albedo atlas, separate front/back surfaces, and wooden hanger. Neutral fabric maps are loaded only when a piece is customized. The material combines a colour-neutral fold texture, optional original-graphic mask, and independent alpha artwork for each side. Artwork placement uses object coordinates, including a reversed X coordinate on the back so lettering reads correctly. Lighting follows transformed mesh normals. Slider movement changes uniforms, with no image decoding, mesh rebuild, or shader compilation. Superseded uploads and removed pieces release their textures; late uploads cannot overwrite newer choices.

`lib/garment-design.ts` supplies template types, upload processing, saved-state validation, and rack placement. `components/GarmentStudio.tsx` is a desktop side panel and mobile bottom sheet; the canvas fits the full piece alongside it.

`public/models/` contains GLBs and fixed textures. `lib/garments.json` describes catalogue meshes, hanger pivots, resting angles, framing, and calibrated turn response. `tools/build-garment-meshes.py` reconstructs static meshes from registered front/side photos. `tools/build-custom-fabric.py` produces neutral maps and print masks without changing the original catalogue textures. Its fabric continuation avoids angular large-region inpaint patches. Front, back, and side texture islands remain fixed throughout a turn; there are no angle atlases, runtime cloth physics, or per-frame image loads.

## Reference and verification

All **1,136 frames at 60 fps** of the supplied reference were decoded in order. Layout and motion measurements are in `docs/reference-analysis.md`; subsequent comparisons retain all **341 frames of seven revealed turns**. Seven fronts use the supplied pixels. Camo, studio, and washed-grey fronts, unseen backs, and added hoodies include inferred photography or surfaces; they do not claim to reproduce unseen original artwork.

Production GLSL and GLBs are rendered under Mesa/EGL for asset QA. The design checks cover four clothing templates in five colours, transparent front/back prints through a full turn, original silhouettes, 632 camera-framing cases, uploads, late-upload races, texture disposal, and validated saved state. The framing checks include a 20-piece rack and the mobile/desktop studio. Evidence and reproducible tools live in `docs/qa/three/` and `tools/`.

Hardware browser FPS and the final browser UI cannot be verified in the available managed environment. Software-driver timings are asset QA, not browser performance claims. The WebGL canvas exposes measured browser intervals, draw counts, and resolution in its `data-performance` attribute on a WebGL-capable browser.

Offline tools are not needed to run or deploy the app. Python QA requires Pillow, NumPy, SciPy, OpenCV, ModernGL, and reference crops. `node tools/check-design-studio.mjs` also exercises native image processing when `@napi-rs/canvas` is available, including through the primary runtime. `node tools/check-mobile-rack.mjs` validates production renderer transforms against the actual GLB bounds.

## Source history

Meaningful implementation and verification steps are committed and pushed to [joshuaM07/wardrobe-viewer](https://github.com/joshuaM07/wardrobe-viewer). Sites maintains the same source state for deployment. Credentials are never bundled in the source.

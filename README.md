# Wardrobe Viewer

An interactive Next.js App Router recreation of the supplied Batch Merch wardrobe video, rendered with **Three.js**. Continuous 3D rotation replaces the earlier Canvas2D angle atlases. The garments have closed front, back, and seam geometry, static fold relief, photographic textures, wooden hangers, and separate metal hooks. There is no cloth simulation.

## Run

Node 22.13 or later and pnpm 11 are required.

```sh
git clone https://github.com/joshuaM07/wardrobe-viewer.git
cd wardrobe-viewer
pnpm install --frozen-lockfile
pnpm dev
```

Normal checkouts run Next.js. The managed Sites preview uses its Vite/Vinext adapter for the same App Router source. Production is built by Next.js and statically exported to `out/`.

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

`pnpm start` serves the export on localhost:3000. No server, database, secrets, or remote media APIs are needed.

## Interaction

- Hover to turn a garment forward; click or press Enter to inspect it.
- On mobile, the enlarged rack pans with a slider, swipes, or arrows. The nearest garment turns forward automatically. Camera movement stops at the rack ends, and the entire garment fits the available height. Arrows stay in sync with the slider and added hoodie.
- Desktop rack arrows turn the previous or next garment forward without opening the viewer and wrap through the collection.
- Previous/next buttons and arrow keys navigate the viewer. Escape closes it.
- Drag the selected garment to rotate it. Touch opens garments directly.
- The bottom handle opens **Add hoodie** and **Replay reference motion**.
- Reduced-motion preferences are honored.

Availability, About, and Contact are local presentation panels. Live inventory and checkout are not connected.

## Rendering

`lib/wardrobe-three.ts` owns the renderer, orthographic camera, demand-driven animation, rigid transforms, chrome rail, GPU background blur, and selection. Each garment and wooden hanger share one draw call; its metal hook uses a second. Geometry and textures are prepared while loading, not recreated during animation. Picking uses a static BVH. Resolution adapts to the pixel budget and measured frame intervals. Rendering stops when the scene settles and pauses when the document is hidden.

`lib/garment-material.ts` applies fixed UV textures to the actual garment surfaces, preserving captured fabric detail and artwork. The print stays attached to the front at every angle; it is never replaced by a side photograph or faded according to rotation. Side captures constrain the mesh's shape offline. There are no animated image atlases, videos, time-indexed images, or per-frame image decoding in the normal renderer. A browser without WebGL receives an explicitly labelled static poster, with replay disabled.

Meshes and textures live in `public/models/`; `lib/garments.json` defines the measured pivots, resting angles, product framing, and calibrated turn response. `tools/build-garment-meshes.py` generates the static meshes offline from registered front/side photos. To add garments, supply consistently registered RGBA photos around the hanger pivot, add their metadata, then generate the GLB. Hood volume, pocket relief, and sleeve folds are baked once.

## Reference and verification

All **1,136 reference frames at 60 fps** were decoded and reviewed in order. `docs/frame-audit.json` records frame deltas; `docs/reference-analysis.md` records layout and motion measurements. The subsequent 3D comparison measures all **341 frames across seven revealed turns**, retaining every measurement and its segmentation uncertainty.

Seven fronts use the supplied video pixels. The camo, studio, and washed-grey fronts are inferred because the clip never reveals them. Their original side views are retained. The added hoodie uses generated source photography. Unseen backs are inferred fabric surfaces; they are not claimed to reproduce unknown original artwork.

`docs/qa/three/` includes production-shader renders, a side-by-side comparison of every captured turn frame, front and side silhouette comparisons, motion measurements, and BVH picking checks. Front silhouette overlap is approximately 99%; resting cloth silhouette overlap is approximately 97.4–98.5%, excluding the hanger and hook (rows before 110). These measure garment outlines, not whole-screen pixel equality.

The managed QA browser has WebGL disabled, so hardware browser FPS cannot be verified there. The actual garment and blur GLSL compiled under Mesa/EGL, and production GLBs were rendered offscreen. Those software-driver timings are asset QA, not browser performance claims. The real renderer exposes measured browser intervals and draw counts in the canvas `data-performance` attribute on a WebGL-capable browser.

The offline tools are not needed to run or deploy the app. They require Python, Pillow, NumPy, SciPy, OpenCV, ModernGL, and the original decoded reference for source measurements. Old angle metadata is retained in `docs/original-angle-metadata.json`; removed atlases remain recoverable in Git history.

## Source history

The project is committed and pushed to [joshuaM07/wardrobe-viewer](https://github.com/joshuaM07/wardrobe-viewer). Meaningful implementation and verification steps are saved as separate commits. Sites maintains the same source state for the published preview. GitHub credentials are never bundled in the source.

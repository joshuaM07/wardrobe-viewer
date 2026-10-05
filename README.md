# Wardrobe Viewer

A Next.js App Router recreation of the supplied Batch Merch clothing-rack video. Real garment photography, a reflective chrome rail, a patterned wall, hover turns, neighboring hanger movement, and the centered garment viewer are independent interactive layers.

## Run

Node 22 or later and pnpm 11 are required.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs Next.js on a normal checkout. The managed Sites preview selects the compatible Vite/Vinext adapter for this same App Router source. Production is always built by **Next.js**, using static export.

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

`pnpm start` serves the exported `out/` directory on localhost:3000. The same directory can be deployed to any static host; no database, application server, secrets, or remote media APIs are required.

## Interaction

- Hover a garment to bring it forward. Click to inspect it.
- Previous/next buttons or left/right arrow keys navigate the viewer; Escape closes it.
- Tab selects the same garments with visible focus outlines; Enter opens them.
- The small bottom handle opens **Add hoodie** and **Replay reference motion**.
- The replay follows the original 18.933-second sequence using the real interactive renderer.
- Reduced-motion preferences are honored. Touch opens garments directly.

Stock and checkout are not connected. The availability button states that clearly.

## Rendering and assets

No cloth simulation, physics engine, video playback, or WebGL is used. The renderer uses registered photographic angle textures with spring-driven rigid hanger motion. Every supplied video frame was decoded and inspected: **1,136 frames at 60 fps**. `docs/frame-audit.json` records measurements for all frames; `docs/reference-analysis.md` records motion and layout findings.

Seven garment fronts and their turn angles are reconstructed from the supplied video pixels. The video never reveals front views of the camo, studio, and washed-grey garments; those three fronts are inferred illustrations, with the original side views retained at rest. The added heavyweight charcoal hoodie uses separate generated multi-angle photography. These inferred images are not claimed to reproduce unseen original artwork.

The runtime assets live in `public/garments/`, and `lib/garments.json` controls garment order, dimensions, pivots, and angle metadata. To add a garment, export consistently registered RGBA views around the wooden hanger's pivot, pack them into equal atlas cells, and supply monotonically increasing visible widths. Fabric stays fixed, so hoodies and long sleeves retain their surface detail while turning.

`tools/` contains the offline source-processing work; it is not needed to run, build, or deploy the app. It expects the supplied reference and analysis frames and uses Python/Pillow/NumPy/SciPy/OpenCV.

## GitHub destination

Prepared for `https://github.com/joshuaM07/wardrobe-viewer`. Nothing has been pushed to GitHub. The `github` remote points to that destination. Sites retains a separate copy of the source for this preview.

When you choose to push later:

```sh
git push github HEAD:main
```

If you start from the downloaded ZIP, initialize its Git metadata first:

```sh
git init -b main
git add .
git commit -m "Recreate the interactive wardrobe"
git remote add github https://github.com/joshuaM07/wardrobe-viewer.git
```

The target repository was empty when inspected. Use your own GitHub authentication; credentials are not bundled with the project.

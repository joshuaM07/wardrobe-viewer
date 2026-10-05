Historical verification of the superseded Canvas2D version. This does not describe the current Three.js renderer.

# Verification

- Every reference frame was decoded and reviewed in order: 1,136 frames / 60 fps.
- The default rack was compared beside the normalized reference card.
- The seven observed turn sequences were registered around each hanger pivot.
- Clean product photographs were checked against their reference holds, including separate garment scales, vertical placement, and hook height.
- Browser QA at 1363 × 936 covered pointer selection, keyboard focus and Enter, previous/next navigation, Escape/close, adding/removing the hoodie, the hoodie product viewer, availability, and the 18.933-second reference replay.
- The final side-by-side check caught a five-pixel focus-induced scroll inside the card. `overflow: clip` keeps the card fixed while preserving the rounded clipping.
- The browser's injected cursor attributes caused an extension-only hydration warning; no application runtime errors were observed.
- WebMCP registration is feature-detected. This preview browser exposed no registered tools, so WebMCP execution validation was unavailable.
- Next.js static production build, TypeScript checking, and ESLint passed. The final publishing workflow runs them on the exact committed source.

The screenshot pairs record the resting rack and flower-shirt product view. Generated fronts for the three garments never shown front-on are identified in the README; their source artwork and the hoodie source grid are retained in `docs/`.

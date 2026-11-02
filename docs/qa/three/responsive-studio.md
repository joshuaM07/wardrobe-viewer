# Responsive upload and garment design studio

The rack now has a visible **Create your piece** entry. Its native modal lets the user choose a T-shirt, long sleeve, crewneck or hoodie and optionally add artwork to the front or back before creating the 3D piece. The action stays visible while the form scrolls on short screens. Radio cards support keyboard selection, Tab wraps inside the modal, and Escape closes it. Uploads are processed on the current device.

The editor presents a single **Front / Back / Fabric colour** tab row. On phones and portrait tablets it is a bottom sheet, with a separate live preview above. Landscape phones use a side panel. Touch controls are larger, safe-area padding is supported, and viewport-height updates keep the editor within the available space. Native form text uses 16 px on mobile to avoid input zoom. The preview reserves space for captions on desktop.

Changing a custom piece's clothing type atomically loads and prepares its replacement GLB and fabric maps, retaining the same piece ID and independent front/back designs. The old piece stays visible until the replacement is ready; failures leave it intact. The initial visible height is retained and the replacement reveals gently while its new framing settles. Changing a catalogue item's type creates a new blank with its uploaded artwork, leaving the catalogue geometry in place. Designs refit to conservative torso print areas for each type and side; the hoodie front stays above its pocket. Resizing or moving a print keeps it within that area. The saved type and both images return after a reload.

**Download PNG** renders the selected garment's current angle to a separate 1200 × 1500 framebuffer with transparency. It includes uploaded artwork and fabric colour without changing the live canvas layout or camera. The render target and material opacity are restored even if export fails. Export work is excluded from the adaptive-resolution counter. If WebGL is lost, customization closes and a clearly labelled static retry preview remains; saved design state is retained.

Evidence:

- `responsive-studio-browser.json`: eleven end-to-end groups pass with no page errors. Actual PNGs are uploaded to the production app; the checks inspect the bound garment/material state, switch through all four types without duplicates, exercise an aborted asset request, reject invalid images, restore data after reload, and inspect the exported PNG for visible artwork and transparency.
- Nine editor viewports pass bounds, overflow and reachable-control checks: 320×568, 360×640, 390×844, 390×400, 768×1024, 844×390, 568×320, 1000×400 and 1440×900. A native touch session creates a T-shirt with artwork. Creation is checked on small/short screens with keyboard focus and Escape. Additional centred-modal measurements are in `responsive-studio-dialog.json`.
- `responsive-studio-design.json`: 224 print-area combinations, both-side preservation, atomic replacement, replacement failure/removal, visible-height preservation, export cleanup, texture lifecycle and six image-processing checks pass.
- `responsive-studio-motion.json`: all nine existing desktop/touch motion checks pass. The existing 6,407-frame clearance run, all 632 camera-framing cases, and spring/cache regressions also pass. The controlled cloth modes remain unchanged; no runtime cloth solver or image animation was added.
- Production build and lint pass. Chromium uses SwiftShader here; these checks establish behavior and geometry, not hardware FPS or physical-device Safari results. The existing uninterrupted reference comparison continues to document the unchanged rack-turn dynamics; the new screen images document the editor layouts.

Representative screenshots: `responsive-studio-mobile.png`, `responsive-studio-small-phone.png`, `responsive-studio-landscape.png`, `responsive-studio-desktop.png`, and `responsive-studio-create.png`. `responsive-studio-export.png` is an actual downloaded transparent mockup. The bright “YOUR DESIGN” graphic is a test fixture, not a supplied user design.

Reproduce against a production export:

```sh
node tools/check-design-studio.mjs /tmp/design-checks.json
python tools/check-browser-studio.py http://localhost:3001 /tmp/studio-checks
python tools/check-browser-motion.py http://localhost:3001 /tmp/motion-checks
```

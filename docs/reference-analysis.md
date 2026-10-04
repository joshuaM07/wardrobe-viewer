# Reference analysis

Source: user-supplied MP4, 3448 × 2160, 60 fps, 1,136 frames, 18.933333 seconds, no audio. All frames were decoded in order and reviewed as consecutive contact sheets, with full-resolution crops used for registration and detail. No sampled-frame-only analysis was used.

## Geometry

The card spans source pixels (268,272)–(3180,1892): 2912 × 1620, 84.45% of viewport width. The wall is approximately #e5e5e2. The outer background transitions from pale blue to white. The chrome rail spans (620,654)–(2810,766). Ten hanger pivots are 830, 1022, 1214, 1406, 1598, 1790, 1998, 2190, 2382, and 2574. The rack body's local y origin is 418. Each garment is registered independently in a 640 × 810 cell.

The header contains ABOUT, the photographic Batch Merch script mark, and CONTACT. The bottom navy ticker is 72 source pixels tall. SEE AVAILABILITY is an outlined pill. The product viewer hides the header/ticker, fades and blurs the rack, raises the selected garment 142 local pixels and scales it by 1.36.

## Motion

The folds, sleeves, and hems remain essentially rigid throughout each turn. The visible fabric changes through viewpoint, with modest hanger roll and overshoot; there is no evidence that a runtime cloth solver is necessary. The original angle samples preserve the photographic folds rather than deforming them.

| Time (s) | Event |
|---:|---|
| 0–0.95 | Resting rack |
| 0.95 | Essential tee turns forward |
| 2.42 | Dollar tee turns forward |
| 3.48 | Underclass tee turns forward |
| 4.95 | Republic crewneck turns forward |
| 6.27 | Remi long sleeve turns forward |
| 7.18 | Flowers tee turns forward |
| 8.45 | Flowers product viewer opens |
| 10.10 | Previous: Remi |
| 10.72 | Previous: Republic |
| 11.29 | Previous: Underclass |
| 12.21 | Previous: Dollar |
| 13.55 | Returns to rack |
| 14.25 | Portrait tee turns forward |
| 15.02 | Remi turns forward |
| 15.34 | Dollar turns forward |
| 16.81 | Essential turns forward |
| 17.95–18.93 | Returns to resting rack |

The ticker advances left by 76 source pixels per second, measured from correlations at 30, 60, 120, and 180 frames.

Turns generally settle in roughly 0.5–0.7 seconds. Neighbors shift away from the active garment, with the nearest approximately 182 source pixels and farther displacements decaying geometrically. View selection follows visible silhouette width to track angular acceleration, with fixed-step spring integration for consistent results across refresh rates.

## Coverage and limits

All reference-visible layouts and the seven revealed garment fronts were recreated from the supplied pixels. The camo, studio, and washed-grey fronts are not shown anywhere in the clip; their new front views are inferred. The hoodie extends the same rendering method using an independent twelve-view atlas. Availability, about, and contact contents beyond the reference-visible buttons are functional local panels; no live inventory or messaging destination was supplied.

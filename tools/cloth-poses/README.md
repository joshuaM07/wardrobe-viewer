These are offline cloth authoring caches, in millimeters, produced with Blender4.3.2. They are build inputs, not runtime simulation files. Each .json.gz holds the sewn simulation topology, contact pins and print pattern. Each .npz stores the gravity-settled rest surface and four local displacement fields: turn onset, turn reversal, rail onset, rail reversal.

The cotton tee uses the accepted30-degree cotton bake and a separate60mm translation bake. Long sleeves, sweatshirt and hoodie use tools/bake-cloth-poses.py's420-frame protocol with their own pattern, mass and bending stiffness. Simulation cages use a coarser resolution for the heavier shapes; the packager transfers physical fields to the render pattern, smooths the shared topology, and preserves pinned contacts. The hood rim remains free.

Rebuild all eleven production assets with:

    python tools/rebuild-physical-cloth.py --work /tmp/wardrobe-cloth-build

To author another simulation, decompress a canonical .json.gz and run:

    blender --background --threads 2 --factory-startup --python tools/bake-cloth-poses.py -- input.json frames 12

The last argument is solver quality (hoodie uses6). The packager admits65% of moderate onset/reversal states, bounds each pose to45mm turn/20mm rail displacement and8mm upward motion, and never extrapolates a negative pose in the browser. Violent simulation tails are not suitable UI animation. Rest UVs keep uploaded prints attached; native morph normals track deformation. The runtime uses four bounded pose weights driven by gesture/rail velocity and acceleration, not a cloth solver.

These lightweight two-panel assets approximate hanging garments. They are not full garment pattern CAD, material measurement, or high-detail scan assets.

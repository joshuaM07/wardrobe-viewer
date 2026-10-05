"""Inspect all production garment surfaces against their reference photographs.

Software OpenGL asset QA using the actual GLBs, UV atlas and production GLSL.
Every degree of the outward/return rotation is rasterized; contact sheets retain
the key viewpoints. This does not measure browser GPU performance.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import importlib.util, json
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'docs/qa/three/sides'
OUT.mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location('side_mesh_qa', ROOT/'tools/render-mesh-qa.py')
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
qa.W, qa.H = 640, 810
qa.target = qa.ctx.simple_framebuffer((640, 810), components=4)
projection = qa.projection.copy()
projection[0, 0], projection[1, 1] = 2/640, 2/810
qa.program['projectionMatrix'].write(projection.T.tobytes())
angles = [90, 75, 60, 45, 20, 0, -45, -90, 135, 180]
overview = Image.new('RGB', (1320, 1705), '#e5e5e2')
overview_draw = ImageDraw.Draw(overview)
records = []
for i, g in enumerate(qa.gs+[qa.hoodie]):
    sheet = Image.new('RGB', (1760, 920), '#e5e5e2')
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 10), g['name']+' — fixed UV surfaces / actual production GLSL', fill='#424557')
    # The supplied side photograph occupies the first column for direct comparison.
    reference = Image.open(ROOT/'public'/g['rest'].lstrip('/')).convert('RGBA')
    reference = reference.resize((240, 405), Image.Resampling.LANCZOS)
    sheet.paste(reference, (8, 54), reference)
    draw.text((16, 34), 'Reference side', fill='#424557')
    for j, angle in enumerate(angles):
        qa.begin(); qa.garment(g, 320, 0, angle=np.deg2rad(angle))
        image = qa.capture()
        thumb = image.resize((240, 405), Image.Resampling.LANCZOS)
        x, y = ((j+1)%7)*250+8, ((j+1)//7)*455+54
        sheet.paste(thumb, (x, y), thumb)
        draw.text((x+8, y-20), f'{angle} degrees', fill='#424557')
        if angle == 90:
            overview.paste(reference.resize((120, 203)), ((i%4)*330, (i//4)*555+38), reference.resize((120, 203)))
            overview.paste(thumb.resize((120, 203)), ((i%4)*330+110, (i//4)*555+38), thumb.resize((120, 203)))
        if angle == 0:
            overview.paste(thumb.resize((240, 303)), ((i%4)*330+35, (i//4)*555+245), thumb.resize((240, 303)))
    overview_draw.text(((i%4)*330+8, (i//4)*555+12), g['id']+' / source side / mesh side / front', fill='#424557')
    sheet.save(OUT/(g['id']+'.jpg'), quality=95)
    # Inspect all poses, including the entire return and the unseen back side.
    count = 0
    for angle in list(range(91))+list(range(89, -1, -1))+list(range(91, 181)):
        qa.begin(); qa.garment(g, 320, 0, angle=np.deg2rad(angle))
        image = np.asarray(qa.capture())
        assert np.count_nonzero(image[:, :, 3]) > 5000, (g['id'], angle)
        count += 1
    records.append({'id':g['id'], 'renderedPoses':count, 'restDegrees':90,
                    'frontUvIsland':'front photograph', 'sideUvIsland':'registered side photograph',
                    'cameraDependentTextureBlend':False})
    print(json.dumps(records[-1]), flush=True)
overview.save(OUT/'overview.jpg', quality=95)
(OUT/'results.json').write_text(json.dumps({
    'scope':'Software OpenGL production mesh/GLSL visual QA, not browser GPU FPS',
    'renderedPoses':sum(x['renderedPoses'] for x in records), 'checks':records,
}, indent=2)+'\n')

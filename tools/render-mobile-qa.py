"""Render actual production GLBs with the camera matrices checked by Node.

This is software OpenGL visual QA, not a GPU browser capture or FPS benchmark.
The small rail photograph provides alignment; the live app uses its physical rail.
"""
from pathlib import Path
import json, runpy
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
qa=runpy.run_path(str(ROOT/'tools/render-mesh-qa.py'))
ctx,program,models,hooks=map(qa.get,['ctx','program','models','hooks'])
garments={g['id']:g for g in qa['gs']+[qa['hoodie']]}
data=json.loads((ROOT/'docs/qa/three/mobile-framing.json').read_text())
out=ROOT/'docs/qa/three/mobile-garments.jpg'
sheet=Image.new('RGB',(1536,520),'#e5e5e2')
draw=ImageDraw.Draw(sheet)
draw.text((20,14),'Production GLB / GLSL mobile framing - actual camera matrices - software-driver asset QA',fill='#4b4e6d')
for index,pose in enumerate(data['poses']):
    width,height=round(pose['width']*2),round(pose['height']*2)
    target=ctx.simple_framebuffer((width,height),components=4);target.use();target.clear(0,0,0,0,depth=1)
    projection=np.asarray(pose['projection'],dtype='f4').reshape(4,4,order='F')
    view=np.asarray(pose['view'],dtype='f4').reshape(4,4,order='F')
    program['projectionMatrix'].write(projection.T.tobytes())
    for item in pose['items']:
        if pose['name'].startswith('product-') and item['id']!=pose['selected']:
            continue  # The live renderer composites its selected foreground separately.
        model=np.asarray(item['matrix'],dtype='f4').reshape(4,4,order='F')
        program['modelViewMatrix'].write((view@model).T.astype('f4').tobytes())
        g=garments[item['id']];vao,textures=models[g['id']]
        textures[0].use(0);textures[1].use(1)
        program['fabricColor'].value=qa['linear_color'](g.get('fabricColor','#dcd6df'))
        program['woodColor'].value=qa['linear_color']('#563a2f');vao.render()
        program['woodColor'].value=qa['linear_color']('#9c9991');hooks[g['id']].render()
    shot=Image.frombytes('RGBA',(width,height),target.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    background=Image.new('RGBA',shot.size,'#e5e5e2')
    if pose['name'].startswith('rack-'):
        tile=Image.open(ROOT/'public/wall-tile.webp').convert('RGBA').resize((52,42))
        for y in range(0,height,42):
            for x in range(0,width,52):background.alpha_composite(tile,(x,y))
        # Transform the measured rail photo through this same orthographic camera.
        rail=Image.open(ROOT/'public/rail.webp').convert('RGBA')
        a=projection@view
        def project(x,y):
            p=a@np.array([x-1456,810-y,0,1]);return ((p[0]+1)*width/2,(1-p[1])*height/2)
        left,top=project(352,382);right,bottom=project(352+rail.width,382+rail.height)
        rail=rail.resize((max(1,round(right-left)),max(1,round(bottom-top))),Image.Resampling.LANCZOS)
        background.alpha_composite(rail,(round(left),round(top)))
    background.alpha_composite(shot)
    picture=background.convert('RGB').resize((366,420),Image.Resampling.LANCZOS)
    sheet.paste(picture,(index*384+9,72))
    label=pose['name'].replace('rack-camo','First garment / bounded end').replace('rack-flowers','Middle garment / centered').replace('rack-hoodie','Hoodie / bounded end').replace('product-flowers','Product mesh / fitted camera')
    draw.text((index*384+12,44),label,fill='#4b4e6d')
    target.release()
sheet.save(out,quality=95)
print(json.dumps({'output':str(out),'poses':len(data['poses']),'productionGarmentShader':True,'scope':'software-driver GLB visual QA; not browser FPS'}))

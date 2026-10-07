"""Render custom colours and front/back prints with the production GLSL/GLBs.

Uses software EGL, not a browser. Test artwork is a deterministic alpha fixture.
"""
from pathlib import Path
import importlib.util, json, sys, os
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(sys.argv[1] if len(sys.argv)>1 else '/workspace/scratch/wardrobe-custom-qa')
OUT.mkdir(parents=True,exist_ok=True)
if len(sys.argv)>2:os.environ['WARDROBE_SHADER_PATH']=sys.argv[2]
spec=importlib.util.spec_from_file_location('qa',ROOT/'tools/render-mesh-qa.py')
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
qa.target=qa.ctx.simple_framebuffer((640,810),components=4)
projection=qa.projection.copy();projection[0,0]=2/640;projection[1,1]=2/810
qa.program['projectionMatrix'].write(projection.T.tobytes())
font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
fixture=Image.new('RGBA',(640,560))
d=ImageDraw.Draw(fixture);font=ImageFont.truetype(font_path,85)
d.rounded_rectangle((5,5,635,555),radius=110,fill=(229,137,84,240))
d.text((320,135),'YOUR',anchor='mm',font=font,fill=(255,250,240,255))
d.text((320,245),'DESIGN',anchor='mm',font=font,fill=(255,250,240,255))
d.line((145,380,495,380),fill=(40,58,66,255),width=24)
d.ellipse((286,430,350,494),fill=(40,58,66,255))
art=qa.ctx.texture(fixture.size,4,fixture.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes(),internal_format=0x8c43)
art.build_mipmaps();art.use(5);art.use(6)
qa.program['frontPlacement'].value=(0,-320,240,210)
qa.program['backPlacement'].value=(0,-320,240,210)
qa.program['frontEnabled'].value=1;qa.program['backEnabled'].value=1
qa.program['customized'].value=1;qa.program['keepOriginal'].value=0

models=[next(g for g in qa.gs if g['id']==name) for name in ['flowers','world','republic']]+[qa.hoodie]
colors=['#f5f1e8','#17191c','#8b3437','#3d5b48','#263e62']
sheet=Image.new('RGB',(1500,len(models)*400),'#e5e5e2')
turn_sheet=Image.new('RGB',(1800,740),'#e5e5e2')
records=[]
for row,g in enumerate(models):
 textures=[]
 for suffix,slot in [('fabric.jpg',2),('fabric-back.jpg',3),('print-mask.png',4)]:
  image=Image.open(ROOT/'public/models'/f'{g["id"]}-{suffix}').convert('RGB')
  tex=qa.ctx.texture(image.size,3,image.tobytes(),internal_format=0x8051 if slot==4 else 0x8c41)
  tex.build_mipmaps();tex.use(slot);textures.append(tex)
 for col,color in enumerate(colors):
  colored={**g,'fabricColor':color};qa.begin();qa.garment(colored,1456,405)
  render=Image.frombytes('RGBA',(640,810),qa.target.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
  tile=Image.new('RGB',(300,400),'#e5e5e2');tile.paste(render.resize((300,380)),(0,20),render.resize((300,380)))
  ImageDraw.Draw(tile).text((12,4),f'{g["type"]} / {color}',fill='#4b4e6d')
  sheet.paste(tile,(col*300,row*400))
  records.append({'type':g['type'],'color':color,'nonEmpty':int((np.array(render)[:,:,3]>100).sum())>10000})
 if g['id']=='flowers':
  for i,angle in enumerate([0,45,80,90,135,180,225,270,315,360]):
   qa.begin();qa.garment({**g,'fabricColor':'#263e62'},1456,405,angle=np.deg2rad(angle))
   shot=Image.frombytes('RGBA',(640,810),qa.target.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
   tile=Image.new('RGB',(360,370),'#e5e5e2');resize=shot.resize((284,350));tile.paste(resize,(38,20),resize)
   ImageDraw.Draw(tile).text((10,5),f'{angle} degrees',fill='#4b4e6d');turn_sheet.paste(tile,((i%5)*360,(i//5)*370))
 for tex in textures:tex.release()
sheet.save(OUT/'custom-colours.jpg',quality=94)
turn_sheet.save(OUT/'custom-front-back-turn.jpg',quality=94)
assert all(r['nonEmpty'] for r in records)
(OUT/'results.json').write_text(json.dumps({'scope':'Software EGL production garment shader/GLBs, not browser FPS','renderer':qa.ctx.info['GL_RENDERER'],'colours':records,'rotationAngles':[0,45,80,90,135,180,225,270,315,360]},indent=2)+'\n')
print(json.dumps({'output':str(OUT),'colours':len(records),'rotationAngles':10}))

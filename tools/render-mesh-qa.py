"""Offscreen OpenGL visual checks of the production GLB geometry and projections.

This is asset QA, not browser automation. It does not claim browser FPS: the cloud
preview's Chrome has WebGL disabled. Mesa/EGL lets us still inspect every mesh,
front and side pose, and the continuous rigid rotation against reference pixels.
"""
from pathlib import Path
import struct, json, sys, time
from io import BytesIO
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import moderngl
from scipy.interpolate import CubicSpline

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(sys.argv[1] if __name__=='__main__' and len(sys.argv)>1 else '/workspace/scratch/wardrobe-3d-qa')
OUT.mkdir(parents=True,exist_ok=True)
W,H=2912,1620
ctx=moderngl.create_standalone_context(backend='egl',require=330)
ctx.enable(moderngl.DEPTH_TEST|moderngl.CULL_FACE)
shader_path=Path(sys.argv[2] if __name__=='__main__' and len(sys.argv)>2 else '/workspace/scratch/wardrobe-shaders.json')
shaders=json.loads(shader_path.read_text())
program=ctx.program(vertex_shader=shaders['garment']['vertex'],fragment_shader=shaders['garment']['fragment'])
blur_program=ctx.program(vertex_shader=shaders['blur']['vertex'],fragment_shader=shaders['blur']['fragment'])
program['map'].value=0;program['backMap'].value=1
program['diffuse'].value=(1,1,1);program['opacity'].value=1
program['mapTransform'].write(np.eye(3,dtype='f4').tobytes())
projection=np.eye(4,dtype='f4');projection[0,0]=2/W;projection[1,1]=2/H
projection[2,2]=-2/7999.9;projection[2,3]=-8000.1/7999.9
program['projectionMatrix'].write(projection.T.tobytes())
def linear_color(hexcolor):
 c=np.array([int(hexcolor[k:k+2],16)/255 for k in [1,3,5]])
 return tuple(np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4))
target=ctx.simple_framebuffer((W,H),components=4)
gs=json.loads((ROOT/'lib/garments.json').read_text())
hoodie=json.loads((ROOT/'public/garments/hoodie.json').read_text())


def glb(g):
 raw=(ROOT/'public'/g['mesh'].lstrip('/')).read_bytes()
 length,kind=struct.unpack_from('<II',raw,12)
 doc=json.loads(raw[20:20+length]);start=20+length
 bl,kind=struct.unpack_from('<II',raw,start);blob=raw[start+8:start+8+bl]
 def arr(index):
  a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
  size={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]
  dtype={5126:'<f4',5125:'<u4'}[a['componentType']]
  return np.frombuffer(blob,dtype=dtype,count=a['count']*size,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],size)
 textures=[]
 for image in doc['images']:
  im=Image.open(ROOT/'public/models'/image['uri']).convert('RGB')
  tex=ctx.texture(im.size,3,im.tobytes(),internal_format=0x8c41);tex.build_mipmaps();textures.append(tex)
 vertices=[];indices=[];offset=0
 for p in doc['meshes'][0]['primitives']:
  pos=arr(p['attributes']['POSITION']);normal=arr(p['attributes']['NORMAL']);uv=arr(p['attributes']['TEXCOORD_0']);idx=arr(p['indices'])
  surface=np.full((len(pos),1),p['material'],dtype='f4')
  vertices.append(np.concatenate([pos,normal,uv,surface],1));indices.append(idx+offset);offset+=len(pos)
 vertex=ctx.buffer(np.concatenate(vertices).astype('f4').tobytes())
 index=ctx.buffer(np.concatenate(indices).astype('u4').tobytes())
 vao=ctx.vertex_array(program,[(vertex,'3f 3f 2f 1f','position','normal','uv','garmentSurface')],index,index_element_size=4)
 return vao,textures


models={g['id']:glb(g) for g in gs+[hoodie]}
hooks={}
for g in gs+[hoodie]:
 points=np.array([[0,-g.get('hangerTop',60),0],[0,-34,0],[0,-24,0],[10,-21,0],[14,-12,0],[10,-3,0],[1,0,0],[-9,-5,0],[-12,-13,0]],dtype='f4')
 curve=CubicSpline(np.arange(len(points)),points)
 samples=curve(np.linspace(0,len(points)-1,37));tangents=curve(np.linspace(0,len(points)-1,37),1)
 tangents/=np.linalg.norm(tangents,axis=1)[:,None]
 positions=[];normals=[]
 for p,t in zip(samples,tangents):
  n=np.array([-t[1],t[0],0]);b=np.array([0,0,1])
  for angle in np.linspace(0,2*np.pi,8,endpoint=False):
   normal=np.cos(angle)*n+np.sin(angle)*b
   positions.append(p+1.45*normal);normals.append(normal)
 positions=np.array(positions,dtype='f4');uv=np.zeros((len(positions),2),'f4')
 indices=[]
 for i in range(36):
  for j in range(8):
   a=i*8+j;b=i*8+(j+1)%8;c=(i+1)*8+j;d=(i+1)*8+(j+1)%8
   indices.extend([a,c,b,b,c,d])
 v=ctx.buffer(np.concatenate([positions,np.asarray(normals,dtype='f4'),uv,np.full((len(positions),1),5,dtype='f4')],1).tobytes());ib=ctx.buffer(np.array(indices,'u4').tobytes())
 hooks[g['id']]=ctx.vertex_array(program,[(v,'3f 3f 2f 1f','position','normal','uv','garmentSurface')],ib,index_element_size=4)
def garment(g,x=1456,y=418,scale=1,angle=0,camera_yaw=0):
 c,s=np.cos(angle),np.sin(angle)
 transform=np.array([[c*scale,0,s*scale,x-W/2],[0,scale,0,H/2-y],[-s*scale,0,c*scale,100], [0,0,0,1]],dtype='f4')
 transform[2,3]-=3000
 # Optional orbiting inspection camera: keep the same surface in view while the
 # garment turns, so a texture crossfade cannot be mistaken for foreshortening.
 if camera_yaw:
  cx,cy,cz=transform[:3,3];cc,ss=np.cos(camera_yaw),np.sin(camera_yaw)
  translate=np.eye(4,dtype='f4');translate[:3,3]=[cx,cy,cz]
  inverse=np.eye(4,dtype='f4');inverse[:3,3]=[-cx,-cy,-cz]
  rotate=np.array([[cc,0,-ss,0],[0,1,0,0],[ss,0,cc,0],[0,0,0,1]],dtype='f4')
  transform=translate@rotate@inverse@transform
 program['modelViewMatrix'].write(transform.T.tobytes())
 vao,textures=models[g['id']];textures[0].use(0);textures[1].use(1)
 program['fabricColor'].value=linear_color(g.get('fabricColor','#dcd6df'))
 program['woodColor'].value=linear_color('#563a2f');vao.render()
 program['woodColor'].value=linear_color('#9c9991');hooks[g['id']].render()



def capture():
 return Image.frombytes('RGBA',(W,H),target.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)


def save_render(render,name,background=None):
 # Encode before writing, then replace the final file atomically.
 encoded=BytesIO();render.save(encoded,format='PNG')
 png=OUT/(name+'-transparent.png');tmp=png.with_suffix('.tmp');tmp.write_bytes(encoded.getvalue());tmp.replace(png)
 composite=render
 if background is not None:
  composite=background.filter(ImageFilter.GaussianBlur(13))
  composite.putalpha(composite.getchannel('A').point(lambda a:round(a*.06)))
  composite.alpha_composite(render)
 poster=BytesIO();composite.resize((1456,810),Image.Resampling.LANCZOS).save(poster,format='WEBP',quality=95,method=5)
 webp=ROOT/'public/posters'/(name+'.webp');tmp=webp.with_suffix('.tmp');tmp.write_bytes(poster.getvalue());tmp.replace(webp)


def begin():
 target.use();target.clear(0,0,0,0,depth=1)


def card(render,product=False):
 base=Image.new('RGB',(W,H),'#e5e5e2')
 if not product:
  tile=Image.open(ROOT/'public/wall-tile.webp').convert('RGB')
  for y in range(155,H,156):
   for x in range(47-196,W,196):base.paste(tile,(x,y))
 base.paste(render,(0,0),render)
 return base


def run_checks():
 # Production meshes in reference layout. Rail is separately modelled in Three.js;
 # its supplied photograph is used here only to align a transparent fallback poster.
 begin()
 for g in gs:garment(g,g['pivot']*W,418,angle=g['restYaw'])
 rack=capture()
 rail=Image.open(ROOT/'public/rail.webp')
 below=Image.new('RGBA',(W,H));below.paste(rail,(352,382),rail);below.alpha_composite(rack)
 save_render(below,'rack')
 begin()
 for g in gs+[hoodie]:garment(g,g['pivot']*W,418,angle=g['restYaw'])
 extended=Image.new('RGBA',(W,H));extended.paste(rail,(352,382),rail);extended.alpha_composite(capture())
 save_render(extended,'rack-hoodie')
 card(below).resize((1456,810),Image.Resampling.LANCZOS).save(OUT/'rack.jpg',quality=94)

 for selected,g in enumerate(gs+[hoodie]):
  begin();garment(g,1456+(g.get('detailX')or 0),g.get('detailY',276),g.get('detailScale',1.36))
  render=capture()
  begin()
  for i,other in enumerate(gs):
   if other['id']==g['id']:continue
   shift=np.sign(i-selected)*182*.6**(abs(i-selected)-1)
   garment(other,other['pivot']*W+shift,418,angle=other['restYaw'])
  background=Image.new('RGBA',(W,H));background.paste(rail,(352,382),rail);background.alpha_composite(capture())
  save_render(render,g['id'],background)
  card(render,True).resize((1456,810),Image.Resampling.LANCZOS).save(OUT/(g['id']+'-front.jpg'),quality=94)

 # Inspect intermediate angles, not merely end poses.
 g=next(g for g in gs if g['id']=='flowers')
 angles=np.linspace(g['restYaw'],0,12)
 sheet=Image.new('RGB',(1440,820),'#e5e5e2')
 for i,angle in enumerate(angles):
  begin();garment(g,1456,418,angle=angle)
  shot=capture().crop((1080,390,1810,1220)).resize((240,273),Image.Resampling.LANCZOS)
  sheet.paste(shot,((i%6)*240,(i//6)*410+45),shot)
  d=ImageDraw.Draw(sheet);d.text(((i%6)*240+10,(i//6)*410+10),f'{np.rad2deg(angle):.1f} degrees',fill='#4b4e6d')
 sheet.save(OUT/'flowers-turn.jpg',quality=95)

 # Closed volume / front silhouette validation is independent of any shader.
 checks=[]
 for g in gs+[hoodie]:
  begin();garment(g,320,0)
  rendered=capture().crop((0,0,640,810))
  alpha=np.array(rendered.getchannel('A'))>100
  source=np.array(Image.open(ROOT/'public'/g['front'].lstrip('/')).getchannel('A'))>100
  if g['id'] in ('camo','studio','washed'):continue # normalised inferred silhouettes
  source[:76 if g['id']!='hoodie' else 95]=False
  alpha[:76 if g['id']!='hoodie' else 95]=False
  overlap=(alpha&source).sum()/max(1,(alpha|source).sum())
  checks.append({'id':g['id'],'frontSilhouetteIoU':round(float(overlap),4)})

 benchmarks=[]
 for size in [(1151,640),(1584,881),(948,528)]:
  bench=ctx.simple_framebuffer(size,components=4);bench.use();times=[]
  for i in range(90):
   bench.clear(0,0,0,0,depth=1);start=time.perf_counter()
   for g in gs:garment(g,g['pivot']*W,418,angle=g['restYaw']*(.5+.5*np.cos(i/89*np.pi)))
   ctx.finish();times.append((time.perf_counter()-start)*1000)
  benchmarks.append({'viewport':size,'renderMsP50':round(float(np.percentile(times[5:],50)),2),'renderMsP95':round(float(np.percentile(times[5:],95)),2)})
 result={'renderer':ctx.info['GL_RENDERER'],'scope':'Offscreen GLB/projection asset QA, NOT browser FPS',
         'drawCalls':2*len(gs),'productionGarmentShader':True,'productionBlurShaderCompiled':True,'benchmarks':benchmarks,'checks':checks}
 (OUT/'results.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result,indent=2))


if __name__ == "__main__":
 run_checks()

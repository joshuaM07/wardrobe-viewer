"""Inspect exact native glTF pose interpolation with production GLSL under EGL.
Continuous frames supplement the real browser interaction recording, not FPS.
"""
from pathlib import Path
import json,sys,struct,subprocess
import numpy as np
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1];folder=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
ns={'__file__':str(root/'tools/render-mesh-qa.py'),'__name__':'cloth_qa'}
import os
os.environ['WARDROBE_SHADER_PATH']=sys.argv[3]
exec((root/'tools/render-mesh-qa.py').read_text().split("models={g['id']:glb(g)")[0],ns)
ctx,p=ns['ctx'],ns['program'];ctx.disable(ns['moderngl'].CULL_FACE)
projection=np.eye(4,dtype='f4');projection[0,0]=2/640;projection[1,1]=2/810;projection[2,2]=-2/7999.9;projection[2,3]=-8000.1/7999.9;p['projectionMatrix'].write(projection.T.tobytes());target=ctx.simple_framebuffer((640,810),components=4)
garments=ns['gs']+[ns['hoodie']];selected=[g for g in garments if g['id'] in ['flowers','world','republic','hoodie'] and (folder/(g['id']+'.glb')).exists()]
sheet=Image.new('RGB',(1200,430*len(selected)),'#e5e5e2')
for row,g in enumerate(selected):
 raw=(folder/(g['id']+'.glb')).read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);blob=raw[28+length:]
 def arr(index):
  a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];size={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']];return np.frombuffer(blob,dtype={5126:'<f4',5125:'<u4'}[a['componentType']],count=a['count']*size,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],size)
 vertices=[];indices=[];deltas=[];offset=0
 for primitive in doc['meshes'][0]['primitives']:
  a=primitive['attributes'];pos=arr(a['POSITION']);norm=arr(a['NORMAL']);uv=arr(a['TEXCOORD_0']);vertices.append(np.c_[pos,norm,uv,np.full(len(pos),primitive['material'])]);indices.append(arr(primitive['indices'])+offset);offset+=len(pos);deltas.append([np.c_[arr(t['POSITION']),arr(t['NORMAL'])] for t in primitive['targets']])
 base=np.concatenate(vertices).astype('f4');modes=np.stack([np.concatenate([part[i] for part in deltas]) for i in range(4)]);buffer=ctx.buffer(base.tobytes());index=ctx.buffer(np.concatenate(indices).astype('u4').tobytes());vao=ctx.vertex_array(p,[(buffer,'3f 3f 2f 1f','position','normal','uv','garmentSurface')],index,index_element_size=4)
 textures=[]
 for i,image in enumerate(doc['images']):
  im=Image.open(root/'public/models'/image['uri']).convert('RGB');tex=ctx.texture(im.size,3,im.tobytes(),internal_format=0x8c41);tex.build_mipmaps();tex.use(i);textures.append(tex)
 p['fabricColor'].value=ns['linear_color'](g['fabricColor']);p['woodColor'].value=ns['linear_color']('#563a2f')
 def render(angle,weights):
  data=base.copy();data[:,:6]+=np.tensordot(weights,modes,axes=1);buffer.write(data.tobytes());c,s=np.cos(angle),np.sin(angle);model=np.array([[c,0,s,0],[0,1,0,405],[-s,0,c,-3000],[0,0,0,1]],dtype='f4');p['modelMatrix'].write(model.T.tobytes());p['modelViewMatrix'].write(model.T.tobytes());target.use();target.clear(0,0,0,0,depth=1);vao.render();im=Image.frombytes('RGBA',(640,810),target.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM);canvas=Image.new('RGB',im.size,'#e5e5e2');canvas.paste(im,(0,0),im);return canvas
 for col,(angle,weights) in enumerate([(0,[0,0,0,0]),(.7,[1,0,0,0]),(np.pi/2,[0,1,0,0]),(np.pi,[0,0,0,0])]):
  im=render(angle,weights);im.thumbnail((300,400));sheet.paste(im,(col*300,row*430+25));ImageDraw.Draw(sheet).text((col*300+8,row*430+5),f'{g["id"]} / pose {col}',fill='#222')
 if '--still' in sys.argv:continue
 encoder=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size','640x840','-framerate','60','-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p',str(out/(g['id']+'.mp4'))],stdin=subprocess.PIPE)
 for frame in range(240):
  t=frame/60;angle=2*np.pi*(.5-.5*np.cos(np.pi*t/2));velocity=np.sin(np.pi*t/2);weights=[max(0,velocity),max(0,-velocity),0,0];im=render(angle,weights);canvas=Image.new('RGB',(640,840),'#e5e5e2');canvas.paste(im,(0,30));ImageDraw.Draw(canvas).text((12,9),f'{g["id"]} / exact glTF native poses + production GLSL / {frame:03}',fill='#222');encoder.stdin.write(canvas.tobytes())
 encoder.stdin.close();assert encoder.wait()==0;vao.release();buffer.release();index.release();[t.release() for t in textures];print(g['id'],'240 consecutive pose frames',flush=True)
sheet.save(out/'catalogue.jpg',quality=94)

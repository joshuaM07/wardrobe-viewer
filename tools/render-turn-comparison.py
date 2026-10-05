"""Render every captured turn frame beside the reference using production GLSL.

Offline asset QA only. The MP4 is never loaded by the application.
Usage: python tools/render-turn-comparison.py /path/to/reference-analysis /path/to/output
"""
from pathlib import Path
from PIL import Image, ImageDraw
import importlib.util, json, sys, subprocess
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(sys.argv[1])
OUT=Path(sys.argv[2] if len(sys.argv)>2 else '/workspace/scratch/wardrobe-turn-comparison')
OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('mesh_qa',ROOT/'tools/render-mesh-qa.py')
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
measurements=json.loads((ROOT/'docs/qa/three/motion-measurements.json').read_text())
projection=qa.projection.copy();projection[0,0]=2/640;projection[1,1]=2/810
qa.program['projectionMatrix'].write(projection.T.tobytes())
target=qa.ctx.simple_framebuffer((640,810),components=4)
encoder=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24',
 '-s','640x436','-r','60','-i','-','-an','-c:v','libx264','-preset','fast','-crf','19',
 '-pix_fmt','yuv420p',str(OUT/'all-341-turn-frames.mp4')],stdin=subprocess.PIPE)
fileindex=0;records=[];sheets=[]
for turn in measurements['turns']:
 g=next(g for g in qa.gs if g['id']==turn['id'])
 focus=velocity=0.;columns=[]
 for k,n in enumerate(range(turn['startFrame'],turn['endFrame']+1)):
  fileindex+=1;target.use();target.clear(0,0,0,0,depth=1)
  desired=1. if k>=max(0,turn['calibrated']['delayFrames']) else 0.
  for _ in range(2):
   velocity+=((desired-focus)*g['turnStiffness']-velocity*g['turnDamping'])/120
   focus+=velocity/120
  angle=g['restYaw']*(1-float(np.clip(focus,0,1)))
  qa.garment(g,1456,405,angle=angle)
  rgba=Image.frombytes('RGBA',(640,810),target.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
  mesh=Image.new('RGB',(640,810),'#e5e5e2');mesh.paste(rgba,(0,0),rgba)
  center=round(turn['centers'][k]);ref=Image.open(SOURCE/'turns'/f'{fileindex:04d}.jpg').crop((center-320,690,center+320,1500))
  pair=Image.new('RGB',(640,436),'#e5e5e2')
  pair.paste(ref.resize((320,405),Image.Resampling.LANCZOS),(0,31))
  pair.paste(mesh.resize((320,405),Image.Resampling.LANCZOS),(320,31))
  draw=ImageDraw.Draw(pair);draw.text((8,8),f'Reference frame {n} / {n/60:.3f}s',fill='#4b4e6d')
  draw.text((328,8),'Production 3D mesh / GLSL',fill='#4b4e6d')
  encoder.stdin.write(pair.tobytes())
  columns.append(pair.resize((384,262),Image.Resampling.LANCZOS))
  records.append({'sourceFrame':n,'videoFrame':fileindex-1,'garment':g['id'],
   'angleDegrees':round(float(np.rad2deg(angle)),3),'focus':round(float(focus),6)})
 # Consecutive sheets retain every frame, including stationary lead-in frames.
 for offset in range(0,len(columns),16):
  sheet=Image.new('RGB',(1536,1048),'#e5e5e2')
  for j,im in enumerate(columns[offset:offset+16]):sheet.paste(im,((j%4)*384,(j//4)*262))
  name=f'{g["id"]}-{offset//16+1:02d}.jpg';sheet.save(OUT/name,quality=94);sheets.append(name)
 print(json.dumps({'garment':g['id'],'framesRendered':len(columns)}),flush=True)
encoder.stdin.close()
if encoder.wait()!=0:raise RuntimeError('Turn comparison encoding failed')
assert len(records)==measurements['processedFrames']==341
(OUT/'frame-index.json').write_text(json.dumps({'scope':'Offscreen production garment shader, all 341 reference turn frames; not browser FPS',
 'frames':records,'sheets':sheets},indent=2)+'\n')
print(json.dumps({'output':str(OUT),'frames':len(records),'sheets':len(sheets)}))

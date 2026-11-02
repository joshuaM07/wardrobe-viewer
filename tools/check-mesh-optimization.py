"""Compare complete rotations of original and optimized static surfaces at 1 px/world unit.
Usage: WARDROBE_SHADER_PATH=... python tools/check-mesh-optimization.py ORIGINAL_MODELS OUTPUT_DIR
Requires the production shader export from check-garment-shader.mjs. Does not alter posters.
"""
import os,sys,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import importlib.util
spec=importlib.util.spec_from_file_location('mesh_qa',Path(__file__).with_name('render-mesh-qa.py'));qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)

source=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
qa.target.release();qa.target=qa.ctx.simple_framebuffer((800,950),components=4)
projection=qa.projection.copy();projection[0,0]=2/800;projection[1,1]=2/950
qa.program['projectionMatrix'].write(projection.T.tobytes())
checks=[];sheet=Image.new('RGB',(1400,220*len(qa.gs+[qa.hoodie])),'#e5e5e2')
for row,g in enumerate(qa.gs+[qa.hoodie]):
 optimized=qa.models[g['id']];original=qa.glb(g,source)
 worst=None
 for angle in range(0,360,15):
  shots=[]
  for model in [original,optimized]:
   qa.models[g['id']]=model;qa.begin();qa.garment(g,1456,395,angle=np.deg2rad(angle))
   shots.append(np.frombuffer(qa.target.read(components=4),dtype=np.uint8).reshape(950,800,4)[::-1].copy())
  a,b=shots;ma=a[:,:,3]>127;mb=b[:,:,3]>127;union=ma|mb
  iou=(ma&mb).sum()/max(1,union.sum())
  # Compare premultiplied colour so antialias/background do not hide edge changes.
  colour_a=a[:,:,:3].astype(float)*a[:,:,3:4]/255;colour_b=b[:,:,:3].astype(float)*b[:,:,3:4]/255
  delta=np.abs(colour_a-colour_b).mean(2)
  mae=float(delta[union].mean());p99=float(np.percentile(delta[union],99))
  checks.append({'id':g['id'],'degrees':angle,'silhouetteIoU':round(float(iou),6),'colourMae255':round(mae,4),'colourP99':round(p99,3)})
  assert iou>.997,(g['id'],angle,iou)
  assert mae<1.5,(g['id'],angle,mae)
  if angle in [0,45,90,135,180]:
   col=[0,45,90,135,180].index(angle);tile=Image.new('RGB',(280,220),'#e5e5e2')
   for x,shot in [(0,a),(140,b)]:
    im=Image.fromarray(shot).resize((140,190),Image.Resampling.LANCZOS);tile.paste(im,(x,25),im)
   ImageDraw.Draw(tile).text((5,5),f"{g['id']} {angle}° original / optimized",fill='#222');sheet.paste(tile,(col*280,row*220))
 qa.models[g['id']]=optimized
 original[0].release()
 for texture in original[1]:texture.release()
 print(g['id'],flush=True)
sheet.save(out/'all-garments.jpg',quality=95)
result={'scope':'EGL production shader at 1 px/world unit, higher than normal displayed garment resolution. 24 poses per garment; includes fronts, backs, side silhouettes and hoodies. Not browser FPS.','checks':checks,'minSilhouetteIoU':min(c['silhouetteIoU'] for c in checks),'maxColourMae255':max(c['colourMae255'] for c in checks)}
(out/'results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='checks'}))

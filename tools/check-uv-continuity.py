"""Check production textured GLBs through complete out-and-return rotations.

An inspection camera orbits with the garment to keep the same front surface in
view. Its artwork must remain unchanged; a rotation-controlled photo crossfade
would change these pixels even though the visible surface is the same.
"""
from pathlib import Path
import importlib.util,json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('mesh_qa',ROOT/'tools/render-mesh-qa.py')
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
qa.W=640;qa.H=810
projection=qa.projection.copy();projection[0,0]=2/640;projection[1,1]=2/810
qa.program['projectionMatrix'].write(projection.T.tobytes())
qa.target=qa.ctx.simple_framebuffer((640,810),components=4)
checks=[]
for g in qa.gs+[qa.hoodie]:
 def render(angle):
  qa.begin();qa.garment(g,320,0,angle=angle,camera_yaw=angle)
  return np.array(qa.capture())
 baseline=render(0)
 cloth=(baseline[:,:,3]>100);cloth[:160]=False
 poses=list(np.linspace(0,g['restYaw'],41))+list(np.linspace(g['restYaw'],0,41)[1:])
 errors=[];large=[]
 for angle in poses:
  frame=render(float(angle));difference=abs(frame[:,:,:3].astype(float)-baseline[:,:,:3].astype(float)).max(2)
  errors.append(float(difference[cloth].mean()));large.append(float((difference[cloth]>12).mean()))
 # Floating point matrix cancellation may move a silhouette boundary by one
 # pixel. A whole texture swap/fade affects the interior, far above this bound.
 assert max(errors)<.12,(g['id'],max(errors))
 assert max(large)<.002,(g['id'],max(large))
 checks.append({'id':g['id'],'poses':len(poses),'maxMeanRgbDifference':round(max(errors),5),'maxChangedFractionAbove12':round(max(large),6),'passed':True})
 print(json.dumps(checks[-1]),flush=True)
result={'scope':'Production garment GLSL on actual GLBs; orbiting inspection camera keeps the same front surface visible. Full outward and return rotations; not browser FPS.','poses':sum(x['poses'] for x in checks),'checks':checks}
(ROOT/'docs/qa/three/uv-continuity.json').write_text(json.dumps(result,indent=2)+'\n')

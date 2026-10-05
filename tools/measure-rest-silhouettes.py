"""Compare every resting mesh projection against its registered source alpha."""
from pathlib import Path
import json,struct
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
checks=[]
for g in json.loads((ROOT/'lib/garments.json').read_text()):
 raw=(ROOT/'public'/g['mesh'].lstrip('/')).read_bytes()
 length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);blob=raw[28+length:]
 def array(index):
  a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
  size={'VEC3':3,'SCALAR':1}[a['type']];dtype={5126:'<f4',5125:'<u4'}[a['componentType']]
  return np.frombuffer(blob,dtype=dtype,count=a['count']*size,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],size)
 mask=Image.new('1',(640,810));draw=ImageDraw.Draw(mask)
 c,s=np.cos(g['restYaw']),np.sin(g['restYaw'])
 for primitive in doc['meshes'][0]['primitives'][:3]:
  positions=array(primitive['attributes']['POSITION']);triangles=array(primitive['indices']).reshape(-1,3)
  projected=np.stack([positions[:,0]*c+positions[:,2]*s+320,-positions[:,1]],1)
  for triangle in triangles:draw.polygon([tuple(x) for x in projected[triangle]],fill=1)
 source=np.array(Image.open(ROOT/'public'/g['rest'].lstrip('/')).getchannel('A'))>100
 projected=np.array(mask,dtype=bool)
 # Exclude the hanger and hook from the garment silhouette comparison.
 source[:110]=False;projected[:110]=False
 sy,sx=np.where(source);my,mx=np.where(projected)
 checks.append({'id':g['id'],'restSilhouetteIoU':round(float((source&projected).sum()/max(1,(source|projected).sum())),4),'sourceWidth':int(sx.max()-sx.min()+1),'meshWidth':int(mx.max()-mx.min()+1),'sourceHem':int(sy.max()),'meshHem':int(my.max())})
result={'scope':'Orthographic triangle silhouette against registered reference photo; garment rows from 110 onward','checks':checks}
(ROOT/'docs/qa/three/side-silhouettes.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

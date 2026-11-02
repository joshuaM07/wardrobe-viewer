"""Validate actual GLB panel thickness, sleeve curl and open garment edges."""
import json,struct,sys
from pathlib import Path
from collections import Counter
import numpy as np

root=Path(__file__).resolve().parents[1]
garments=json.loads((root/'lib/garments.json').read_text())+[json.loads((root/'public/garments/hoodie.json').read_text())]
def read(file):
 raw=file.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);blob=raw[28+length:]
 def array(i):
  a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];size={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
  return np.frombuffer(blob,dtype={5126:'<f4',5125:'<u4'}[a['componentType']],count=a['count']*size,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,size)
 return [(p['material'],array(p['attributes']['POSITION']),array(p['attributes']['TEXCOORD_0']),array(p['indices']).reshape(-1,3)) for p in doc['meshes'][0]['primitives'] if p['material']<3]
checks=[]
for g in garments:
 parts=read(root/'public'/g['mesh'].lstrip('/'));keys={};points=[];edges=Counter();uv_panels={}
 for kind,positions,uv,triangles in parts:
  remap=[]
  for p in positions:
   key=tuple(np.round(p*1000).astype(int))
   if key not in keys:keys[key]=len(points);points.append(p)
   remap.append(keys[key])
  remap=np.array(remap)
  for tri in remap[triangles]:
   for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:edges[tuple(sorted((int(a),int(b))))]+=1
  if kind<2:
   panel={}
   for p,t in zip(positions,uv):panel[tuple(np.round(t*np.array([2 if kind==0 else 1,1])*100000).astype(int))]=p
   uv_panels[kind]=panel
 points=np.array(points);hem=-points[:,1].min()
 open_edges=np.array([points[list(edge)].mean(0) for edge,count in edges.items() if count==1])
 torso_hem=-points[abs(points[:,0])<150,1].min()
 hem_edges=open_edges[(-open_edges[:,1]>torso_hem-25)&(abs(open_edges[:,0])<150)]
 cuff_edges=open_edges[(abs(open_edges[:,0])>175)&(-open_edges[:,1]>205)&(-open_edges[:,1]<(400 if g['type']=='tee' else hem+1))]
 assert len(hem_edges)>8,(g['id'],'sealed hem');assert len(cuff_edges)>4,(g['id'],'sealed cuff')
 gaps=[]
 for key,front in uv_panels[0].items():
  back=uv_panels[1].get(key)
  if back is not None and abs(front[0])<150 and 330<-front[1]<hem-20:gaps.append(float(front[2]-back[2]))
 assert len(gaps)>3,(g['id'],'not enough corresponding panel samples')
 assert min(gaps)>0 and max(gaps)<(30 if g['type']=='tee' else 50),(g['id'],min(gaps),max(gaps))
 torso=points[(abs(points[:,0])<140)&(-points[:,1]>330)&(-points[:,1]<hem-25)]
 span=float(np.ptp(torso[:,2]));record={'id':g['id'],'openHemEdges':len(hem_edges),'openCuffEdges':len(cuff_edges),'panelGapSamples':len(gaps),'maxPanelGap':round(max(gaps),3),'torsoDepthSpan':round(span,3)}
 before=root.parent/'scratch/slab-before'/Path(g['mesh']).name
 if before.exists():
  old=np.concatenate([p for _,p,_,_ in read(before)]);old=old[(abs(old[:,0])<140)&(-old[:,1]>330)&(-old[:,1]<hem-25)]
  old_span=float(np.ptp(old[:,2]));record.update(previousTorsoDepthSpan=round(old_span,3),torsoDepthReductionPercent=round(100*(1-span/old_span),1))
 checks.append(record)
result={'scope':'Actual optimized GLB geometry; open hems/cuffs and thin, separated draped panels. Not a realism score or FPS test.','checks':checks}
out=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/draped-panels.json');out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

"""Prepare open fabric panels and smooth sewn returns for offline cloth baking."""
import json,sys,argparse
from collections import Counter
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi
from PIL import Image
root=Path(__file__).resolve().parents[1];parser=argparse.ArgumentParser();parser.add_argument('garment');parser.add_argument('output');parser.add_argument('--step',type=int,default=8);args=parser.parse_args();folder=Path(args.output);folder.mkdir(parents=True,exist_ok=True);ns={'__file__':str(root/'tools/build-garment-meshes.py')}
source=(root/'tools/build-garment-meshes.py').read_text().split('\nfor g in garments:')[0].replace('boundary = contour[::3]','boundary = contour[::8]').replace('interior = np.stack([xx[mask[yy, xx]], yy[mask[yy, xx]]], 1)','inside = ndi.distance_transform_edt(mask)>5; interior = np.stack([xx[inside[yy, xx]], yy[inside[yy, xx]]], 1)');source=source.replace('0:810:8, 0:640:8',f'0:810:{args.step}, 0:640:{args.step}').replace('boundary = contour[::8]',f'boundary = contour[::{args.step}]');exec(source,ns)
g=next(g for g in ns['garments'] if g['id']==args.garment);a=np.array(Image.open(root/'public'/g['front'].lstrip('/')).convert('RGBA'))
if g['id'] in ('camo','studio','washed'):
 rest=Image.open(root/'public'/g['rest'].lstrip('/')).convert('RGBA');fy=np.where(a[:,:,3]>100)[0].max();ry=np.where(np.array(rest)[:,:,3]>100)[0].max();im=Image.fromarray(a);normalized=Image.new('RGBA',(640,810));normalized.paste(im.crop((0,0,640,58)),(0,0));normalized.paste(im.crop((0,58,640,fy+1)).resize((640,ry-57),Image.Resampling.LANCZOS),(0,58));a=np.array(normalized)
rgb=a[:,:,:3].astype(float);mask=a[:,:,3]>100
wood=(rgb[:,:,0]>rgb[:,:,1]+9)&(rgb[:,:,0]>rgb[:,:,2]+6)&mask;wood[155:]=False;
if g['type']=='hoodie':wood[:77]=False
wood[:,:220]=False;wood[:,420:]=False;wood=ndi.binary_closing(wood,iterations=2);labels,n=ndi.label(wood);counts=np.bincount(labels.ravel());counts[0]=0;wood=ndi.binary_fill_holes(labels==counts.argmax())
cloth=mask&~ndi.binary_dilation(wood,iterations=1);cloth[:95 if g['type']=='hoodie' else 76]=False;labels,n=ndi.label(cloth);counts=np.bincount(labels.ravel());counts[0]=0;cloth=ndi.binary_fill_holes(labels==counts.argmax())
yy,xx=np.mgrid[:810,:640];seed=np.sin((xx-320)/45+yy/160)*1.2
gap={'tee':8,'long-sleeve':9,'crewneck':10,'hoodie':12}[g['type']]
hood=np.exp(-(((xx-320)/105)**4)-((yy-150)/85)**4) if g['type']=='hoodie' else np.zeros_like(seed)
parts=ns['shell'](cloth,gap+seed+hood*10,-gap+seed-hood*28,0,garment_type=g['type'])
verts=[];faces=[];keys={};sew=set();records=[]
for kindpart,(pos,uv,tri,kind) in enumerate(parts):
 pos=pos.copy();roll=np.clip((-pos[:,1]-145)/150,0,1)*.5;extra=np.maximum(np.abs(pos[:,0])-160,0);pos[:,0]+=np.sign(pos[:,0])*extra*(1/np.cos(roll)-1)
 remap=[]
 for p in pos:
  key=tuple(np.round(p*1000).astype(int))
  if key not in keys:keys[key]=len(verts);verts.append(p.tolist())
  remap.append(keys[key])
 remap=np.array(remap)
 if kind<2:faces.extend(remap[tri].tolist())
 else:
  for t in remap[tri]:
   for i,j in [(t[0],t[1]),(t[1],t[2]),(t[2],t[0])]:
    if np.linalg.norm(np.array(verts[i])[:2]-np.array(verts[j])[:2])<.01:sew.add(tuple(sorted((int(i),int(j)))))
 records.append({'kind':kind,'map':remap.tolist(),'uv':uv.tolist(),'tri':tri.tolist()})
top=np.where(cloth,np.arange(810)[:,None],810).min(axis=0)
pins=[i for i,p in enumerate(verts) if abs(p[0])<172 and -p[1]<220 and -p[1]<top[int(round(p[0]+320))]+11]
hanger=[[float(x),-float(top[int(x+320)]+5),0.] for x in np.linspace(-170,170,35)]
if g['type']=='hoodie':
 pins=[i for i,p in enumerate(verts) if (90<abs(p[0])<172 and abs(-p[1]-(145+abs(p[0])*.3))<9) or (abs(p[0])<70 and abs(-p[1]-172)<7)]
 hanger=[[float(x),-float(152+abs(x)*.3),0.] for x in np.linspace(-170,170,35)]
data={'garment':g,'vertices':verts,'faces':faces,'sew':list(sew),'pins':pins,'hanger':hanger,'records':records}
(folder/'pattern.json').write_text(json.dumps(data));print('vertices',len(verts),'faces',len(faces),'sew',len(sew),'pins',len(pins));print('tops',[(x,int(top[x+320])) for x in [-170,-120,-60,0,60,120,170]])

d=json.loads((folder/'pattern.json').read_text());v=np.array(d['vertices']);t=np.array(d['faces']);pairs={}
for a,b in d['sew']:
 if v[a,2]<v[b,2]:a,b=b,a
 pairs[a]=b
front=np.array([tri for tri in d['faces'] if all(v[i,2]>0 for i in tri)]);direct={};counts=Counter()
for tri in front:
 for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:key=tuple(sorted((a,b)));counts[key]+=1;direct[key]=(a,b)
edges=[direct[k] for k,n in counts.items() if n==1 and direct[k][0] in pairs and direct[k][1] in pairs]
normals={a:np.zeros(2) for a in pairs}
for a,b in edges:
 delta=v[b,:2]-v[a,:2];n=np.array([delta[1],-delta[0]]);normals[a]+=n;normals[b]+=n
verts=v.tolist();faces=d['faces'][:];rings={a:[a] for a in pairs};all_side=set()
for a,b in pairs.items():
 n=normals[a];n/=max(np.linalg.norm(n),1e-9);center=(v[a]+v[b])/2;half=(v[a]-v[b])/2;radius=np.linalg.norm(half)
 for k in range(1,4):
  theta=np.pi*k/4;q=center+half*np.cos(theta);q[:2]+=n*radius*np.sin(theta);rings[a].append(len(verts));all_side.add(len(verts));verts.append(q.tolist())
 rings[a].append(b)
sidefaces=[]
for a,b in edges:
 for k in range(4):
  x,y,z,w=rings[a][k],rings[b][k],rings[a][k+1],rings[b][k+1];sidefaces.extend([[x,z,y],[y,z,w]])
faces.extend(sidefaces);sideids=sorted({i for tri in sidefaces for i in tri});index={old:i for i,old in enumerate(sideids)};sideuv=[]
for i in sideids:
 q=np.array(verts[i]);sideuv.append([(q[0]+320)/1280,-q[1]/810])
d['vertices']=verts;d['faces']=faces;d['sew']=[];d['records']=[r for r in d['records'] if r['kind']<2]+[{'kind':2,'map':sideids,'uv':sideuv,'tri':[[index[i] for i in tri] for tri in sidefaces]}]
exclude=all_side|set(d['pins'])|set(pairs)|set(pairs.values())
for _ in range(1):
 ex=set(exclude)
 for tri in faces:
  if any(i in exclude for i in tri):ex.update(tri)
 exclude=ex
d['selfExcluded']=sorted(exclude);d['seamRings']=list(rings.values());(folder/'rounded.json').write_text(json.dumps(d));print('vertices',len(verts),'faces',len(faces),'roundedges',len(edges),'excluded',len(exclude))

d=json.loads((folder/'rounded.json').read_text());v=np.array(d['vertices']);x=v[:,0];depth=-v[:,1];t=np.clip((depth-145)/235,0,1);w=t*t*(3-2*t);w[d['pins']]=0
# Author an isometric vertical drape, rather than an inflated solid volume.
# The horizontal arc length is retained as the fabric folds into depth.
grid=np.linspace(-340,340,1361);z=11*np.sin(grid/34+.4)+5*np.sin(grid/65-1.2);dz=11/34*np.cos(grid/34+.4)+5/65*np.cos(grid/65-1.2)
for i in range(len(v)):
 curve=np.sqrt(np.maximum(.001,1-(w[i]*dz)**2));integral=np.concatenate([[0],np.cumsum((curve[:-1]+curve[1:])*.25)]);center=np.interp(0,grid,integral);v[i,0]=np.interp(x[i],grid,integral)-center;v[i,2]+=w[i]*np.interp(x[i],grid,z)
d['vertices']=v.tolist();(folder/'input.json').write_text(json.dumps(d));print('torso depth',np.ptp(v[(abs(x)<140)&(depth>330)&(depth<650),2]))

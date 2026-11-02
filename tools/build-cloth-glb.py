"""Package a physically baked cloth surface as native glTF morph targets.

Blender simulation happens offline. The viewer only interpolates vertex poses;
print UVs and pattern coordinates stay attached to the same fabric triangles.
"""
from pathlib import Path
import json,struct,argparse,gzip
import numpy as np
from scipy import sparse
from scipy.interpolate import LinearNDInterpolator,NearestNDInterpolator
from PIL import Image
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--frames');parser.add_argument('--output',required=True);parser.add_argument('--bake');parser.add_argument('--canonical-input');parser.add_argument('--rest',type=int,default=240);parser.add_argument('--rail-frames');parser.add_argument('--pattern');parser.add_argument('--subdivide',type=int,default=1);args=parser.parse_args()
source=Path(args.input);frames=Path(args.frames) if args.frames else None;output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
def read_json(path):
    path=Path(path);return json.loads(gzip.decompress(path.read_bytes()) if path.suffix=='.gz' else path.read_text())
d=read_json(source);g=d['garment'];slug=g['id']
# Reuse the existing texture/GLB container helpers, without running asset builds.
ns={'__file__':str(ROOT/'tools/build-garment-meshes.py')};exec((ROOT/'tools/build-garment-meshes.py').read_text().split('\nfor g in garments:')[0],ns)
rest=None
def corotated(folder,frame,translation=False):
    p=np.load(folder/f'{frame}.npy').astype(float)
    if translation:
        amount=json.loads((folder/f'{frame}-translation.json').read_text());p[:,0]-=amount
    else:
        theta=json.loads((folder/f'{frame}-angle.json').read_text());c,s=np.cos(theta),np.sin(theta);p=p@np.array([[c,0,s],[0,1,0],[-s,0,c]])
    return p
# Only moderate onset/reversal states are admitted; wrung poses are excluded.
if args.bake:
    baked=np.load(args.bake);rest=baked['rest'].astype(float);modes=[baked[name].astype(float)*.65 for name in ['turnPositive','turnNegative','railPositive','railNegative']]
else:
    assert frames is not None
    rest=np.load(frames/f'{args.rest}.npy').astype(float)
    modes=[(corotated(frames,60)-rest)*.65,(corotated(frames,135)-rest)*.65]
    if args.rail_frames:
        rail=Path(args.rail_frames);modes.extend([(corotated(rail,60,True)-rest)*.65,(corotated(rail,135,True)-rest)*.65])
    else:modes.extend([np.zeros_like(rest),np.zeros_like(rest)])
if args.canonical_input:
    canonical=read_json(args.canonical_input)
    if canonical['garment']['id']!=g['id'] or len(canonical['vertices'])!=len(d['vertices']):
        initial=np.array(canonical['vertices']);target=np.array(d['vertices']);delta=rest-initial
        sx=np.ptp(target[:,0])/np.ptp(initial[:,0]);anchor=185 if g['type']=='hoodie' else 145
        sy=(-target[:,1].min()-anchor)/(-initial[:,1].min()-anchor);scale=np.array([sx,sy,np.sqrt(sx*sy)])
        moved=target.copy();fields=[np.zeros_like(target) for _ in modes]
        for kind in [0,1]:
            r=next(r for r in canonical['records'] if r['kind']==kind);mapping=np.array(r['map']);uv=np.array(r['uv']);points=np.stack([uv[:,0]*(640 if kind==1 else 1280)-320,-uv[:,1]*810],axis=1)
            data=np.concatenate([delta[mapping]]+[m[mapping] for m in modes],axis=1)
            linear=LinearNDInterpolator(points,data);nearest=NearestNDInterpolator(points,data)
            target_r=next(r for r in d['records'] if r['kind']==kind);indices=np.array(target_r['map']);uv=np.array(target_r['uv']);query=np.stack([(uv[:,0]*(640 if kind==1 else 1280)-320)/sx,-(anchor+(uv[:,1]*810-anchor)/sy)],axis=1)
            values=linear(query);missing=~np.isfinite(values).all(axis=1)
            if missing.any():values[missing]=nearest(query[missing])
            moved[indices]+=values[:,:3]*scale
            for j,field in enumerate(fields):field[indices]=values[:,3+j*3:6+j*3]*scale
        for ring in d['seamRings']:
            a,b=ring[0],ring[-1]
            for j,vertex in enumerate(ring[1:-1]):
                t=(j+1)/(len(ring)-1);moved[vertex]+=((moved[a]-target[a])*(1-t)+(moved[b]-target[b])*t)
                for field in fields:field[vertex]=field[a]*(1-t)+field[b]*t
        moved[d['pins']]=target[d['pins']];rest=moved;modes=fields
for mode in modes:mode[d['pins']]=0
# Reduce the visible seam bight; the simulation keeps its collision-safe gap.
# The same linear operation is applied to rest and every deformation field.
if args.pattern or d.get('seamRings'):
    pattern=json.loads(Path(args.pattern).read_text()) if args.pattern else None;pairs={};initial=np.array(pattern['vertices']) if pattern else None
    if pattern:
        for a,b in pattern['sew']:
            if initial[a,2]<initial[b,2]:a,b=b,a
            pairs[a]=b
    rows=list(range(len(rest)));cols=rows.copy();data=[1.]*len(rest)
    r=sparse.lil_matrix((len(rest),len(rest)));r.setdiag(1.)
    rings=d.get('seamRings') or [[a,len(initial)+n*3,len(initial)+n*3+1,len(initial)+n*3+2,b] for n,(a,b) in enumerate(pairs.items())]
    for ring in rings:
        a,b=ring[0],ring[-1]
        for j,vertex in enumerate(ring[1:-1]):
            t=(j+1)/(len(ring)-1);r.rows[vertex]=[vertex,a,b];r.data[vertex]=[.2,.8*(1-t),.8*t]
    r=r.tocsr();rest[:,:2]=r@rest[:,:2]
    for mode in modes:mode[:,:2]=r@mode[:,:2]
# Shared topology supplies smooth normals across material and UV seams.
records=d['records'];tri=np.concatenate([np.array(r['map'])[np.array(r['tri'])] for r in records]);labels=np.concatenate([np.full(len(r['tri']),r['kind']) for r in records])
pattern_xy=np.full((len(rest),2),np.nan)
for record in records:
    mapping=np.array(record['map']);uv=np.array(record['uv']);xy=np.stack([uv[:,0]*(640 if record['kind']==1 else 1280)-320,-uv[:,1]*810],axis=1)
    missing=np.isnan(pattern_xy[mapping,0]);pattern_xy[mapping[missing]]=xy[missing]
assert np.isfinite(pattern_xy).all()
pins=set(d['pins'])
for _ in range(args.subdivide):
    edges={};neighbors=[set() for _ in rest];boundaries=[set() for _ in rest]
    for a,b,c in tri:
        for u,v,opposite in [(a,b,c),(b,c,a),(c,a,b)]:
            key=tuple(sorted((int(u),int(v))));edges.setdefault(key,[]).append(int(opposite));neighbors[u].add(int(v));neighbors[v].add(int(u))
    for (a,b),opposite in edges.items():
        if len(opposite)==1:boundaries[a].add(b);boundaries[b].add(a)
    rows=[];cols=[];values=[]
    for i,adjacent in enumerate(neighbors):
        if i in pins or not adjacent:weights={i:1.}
        elif len(boundaries[i])==2:weights={i:.75,**{j:.125 for j in boundaries[i]}}
        else:
            beta=3/(8*len(adjacent)) if len(adjacent)>3 else 3/16
            weights={i:1-len(adjacent)*beta,**{j:beta for j in adjacent}}
        for j,w in weights.items():rows.append(i);cols.append(j);values.append(w)
    mid={}
    for (a,b),opposite in edges.items():
        i=len(rest)+len(mid);mid[(a,b)]=i
        if len(opposite)==2 and not (a in pins and b in pins):weights={a:.375,b:.375,opposite[0]:.125,opposite[1]:.125}
        else:weights={a:.5,b:.5}
        for j,w in weights.items():rows.append(i);cols.append(j);values.append(w)
    matrix=sparse.csr_matrix((values,(rows,cols)),shape=(len(rest)+len(mid),len(rest)))
    faces=[]
    for a,b,c in tri:
        ab=mid[tuple(sorted((int(a),int(b))))];bc=mid[tuple(sorted((int(b),int(c))))];ca=mid[tuple(sorted((int(c),int(a))))]
        faces.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])
    rest=matrix@rest;modes=[matrix@mode for mode in modes];pattern_xy=matrix@pattern_xy;tri=np.array(faces);labels=np.repeat(labels,4)
    pins|={index for (a,b),index in mid.items() if a in pins and b in pins}
base_normals=ns['normals'](rest,tri);normal_modes=[ns['normals'](rest+mode,tri)-base_normals for mode in modes]
records=[]
for kind in [0,1,2]:
    faces=tri[labels==kind];used,remap=np.unique(faces,return_inverse=True);xy=pattern_xy[used]
    uv=np.stack([(xy[:,0]+320)/(640 if kind==1 else 1280),-xy[:,1]/810],axis=1)
    records.append({'map':used.tolist(),'uv':uv.tolist(),'tri':remap.reshape(-1,3).tolist(),'kind':kind})
# The wood support remains rigid and has zero influence in every cloth pose.
a=np.array(Image.open(ROOT/'public'/g['front'].lstrip('/')).convert('RGBA'));rgb=a[:,:,:3].astype(float);mask=a[:,:,3]>100
wood=(rgb[:,:,0]>rgb[:,:,1]+9)&(rgb[:,:,0]>rgb[:,:,2]+6)&mask;wood[155:]=False;wood[:,:220]=False;wood[:,420:]=False
if slug=='hoodie':wood[:77]=False
wood=ndi.binary_closing(wood,iterations=2);labels,n=ndi.label(wood)
if n:
    counts=np.bincount(labels.ravel());counts[0]=0;wood=ndi.binary_fill_holes(labels==counts.argmax())
wood_parts=ns['shell'](wood,np.full((810,640),5.),np.full((810,640),-5.),3) if wood.sum()>50 else []
parts=[(rest[np.array(r['map'])],np.array(r['uv']),np.array(r['tri']),r['kind']) for r in records]+wood_parts
path=output/f'{slug}.glb';ns['write_glb'](path,parts,slug)
raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);blob=bytearray(raw[28+length:])
def append(array):
    while len(blob)%4:blob.append(0)
    values=np.asarray(array,dtype='<f4');offset=len(blob);blob.extend(values.tobytes());doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':values.nbytes,'target':34962});doc['accessors'].append({'bufferView':len(doc['bufferViews'])-1,'componentType':5126,'count':len(values),'type':'VEC3','min':values.min(0).tolist(),'max':values.max(0).tolist()});return len(doc['accessors'])-1
for i,primitive in enumerate(doc['meshes'][0]['primitives']):
    count=doc['accessors'][primitive['attributes']['POSITION']]['count']
    if i<len(records):
        mapping=np.array(records[i]['map']);primitive['attributes']['NORMAL']=append(base_normals[mapping]);targets=[{'POSITION':append(mode[mapping]),'NORMAL':append(norm[mapping])} for mode,norm in zip(modes,normal_modes)]
    else:
        zero=np.zeros((count,3));targets=[{'POSITION':append(zero),'NORMAL':append(zero)} for _ in modes]
    primitive['targets']=targets
mesh=doc['meshes'][0];mesh['weights']=[0]*4;mesh['extras']={'targetNames':['turnPositive','turnNegative','railPositive','railNegative']};doc['asset']['generator']='Wardrobe offline cloth bake / bounded native morph poses';doc['buffers']=[{'byteLength':len(blob)}]
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);blob+=b'\0'*((-len(blob))%4)
path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(blob))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(blob),0x004e4942)+blob)
print(json.dumps({'file':str(path),'vertices':sum(len(p[0]) for p in parts),'triangles':sum(len(p[2]) for p in parts),'modeMaxDisplacements':[float(np.linalg.norm(m,axis=1).max()) for m in modes],'pinOffsets':max(float(abs(m[list(pins)]).max()) for m in modes)}))

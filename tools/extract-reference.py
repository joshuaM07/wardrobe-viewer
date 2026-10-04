"""Rebuild view-dependent garment textures from the user's original capture.
Set REFERENCE_ANALYSIS to the decoded frame directory. Processing is offline; the runtime
never reads or plays the reference video. Coordinates are in source pixels.
"""
from pathlib import Path
import json,sys,subprocess,os
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFont
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[1]
ANALYSIS=Path(os.environ.get('REFERENCE_ANALYSIS','reference-analysis'))
OUT=ROOT/'public/garments';OUT.mkdir(parents=True,exist_ok=True)
CARD=(268,272,3180,1892);W,H=2912,1620
PIVOTS=[830,1022,1214,1406,1598,1790,1998,2190,2382,2574]
Y=690;TILEW=640;TILEH=810
ranges=[(57,108),(145,193),(208,257),(296,346),(375,422),(432,482),(859,898)]
all_n=[n for a,b in ranges for n in range(a,b+1)]
turns={n:ANALYSIS/'turns'/f'{i+1:04d}.jpg' for i,n in enumerate(all_n)}
base=Image.open(ANALYSIS/'full/0000.png').convert('RGB')
# The repeating wall tile is sampled from unobstructed user-supplied pixels.
base.crop((315,427,511,583)).save(ROOT/'public/wall-tile.webp',quality=96)
base.crop((620,654,2810,771)).save(ROOT/'public/rail-source.webp',quality=96)
# Metal rail silhouette, including its mount plates and their real highlights.
rail=base.crop((620,654,2810,766));a=np.array(rail).astype(float)
m=a.mean(2)<218;m=ndi.binary_fill_holes(m);m=ndi.binary_closing(m,iterations=2)
# The source rail crop includes hanger tips. These move independently.
m[:34,55:-55]=False;m[74:,55:-55]=False
ra=Image.fromarray(np.dstack((np.array(rail),np.uint8(ndi.gaussian_filter(m.astype(float),.5)*255))))
ra.save(ROOT/'public/rail.webp',quality=98)
logo=base.crop((1600,298,1800,417));a=np.array(logo);al=np.clip((225-a.min(2))*2.5,0,255).astype('uint8');logo.putalpha(Image.fromarray(al));logo.save(ROOT/'public/brand.webp',lossless=True)
# A smooth neutral studio wall, with the reference's delicate repeated circles.
# Products are separately composited, never baked into this background.

def erase_cursor(rgb):
 # OS cursor whites are substantially brighter and more neutral than the fabric.
 white=((rgb.min(2)>238)&(np.ptp(rgb.astype(float),axis=2)<7))
 white=ndi.binary_closing(white,iterations=2).astype('uint8')
 labels,count=ndi.label(white)
 mask=np.zeros(white.shape,'uint8')
 for sl in ndi.find_objects(labels):
  if sl is None:continue
  h=sl[0].stop-sl[0].start;w=sl[1].stop-sl[1].start
  if 55<h<155 and 25<w<125:
   local=np.zeros(white.shape,bool);local[sl]=white[sl]>0
   local=ndi.binary_fill_holes(local)
   expanded=(slice(max(0,sl[0].start-7),min(white.shape[0],sl[0].stop+7)),slice(max(0,sl[1].start-7),min(white.shape[1],sl[1].stop+7)))
   mask[expanded]=255
 if mask.any():return cv2.inpaint(rgb,mask,7,cv2.INPAINT_TELEA)
 return rgb

def matte(im,center,kind='dark',frame=0):
 if frame==0 and kind in ('green','black'):kind='dark'
 # Track the wooden hanger within the measured 60fps movement so every view
 # registers at its real pivot; neighboring products remain independent.
 image_array=np.array(im)
 near=image_array[740:815].astype(float)
 brown=(near[:,:,0]>near[:,:,1]+12)&(near[:,:,0]>near[:,:,2]+10)&(near.mean(2)<195)
 occupied=ndi.binary_closing(brown.sum(0)>1,iterations=20)
 groups,n=ndi.label(occupied); candidates=[]
 for sl in ndi.find_objects(groups):
  lo,hi=sl[0].start,sl[0].stop
  weights=brown[:,lo:hi].sum(0)
  if weights.sum()>25:
   candidates.append(float((np.arange(lo,hi)*weights).sum()/weights.sum()))
 if candidates and frame!=0:
  closest=min(candidates,key=lambda x:abs(x-center))
  if abs(closest-center)<240:center=closest
 x=round(center)-TILEW//2
 crop=im.crop((x,Y,x+TILEW,Y+TILEH));rgb=erase_cursor(np.array(crop));a=rgb.astype(float)
 chroma=a[:,:,2]-a[:,:,1]
 m=((chroma>1.5)&(a.mean(2)>176)) if kind=='white' else ((a[:,:,1]>a[:,:,0]+3)&(a.mean(2)<185)) if kind=='green' else ((chroma>1)&(a.mean(2)<185)) if kind=='black' else a.mean(2)<185
 if kind in ('white','green','black'):
  wood=(a[:,:,0]>a[:,:,1]+9)&(a[:,:,0]>a[:,:,2]+7)&(a.mean(2)<195)
  wood[150:]=False;wood[:,:TILEW//2-110]=False;wood[:,TILEW//2+110:]=False
  m|=wood
 wood_m=wood.copy() if kind in ('white','green','black') else np.zeros(m.shape,bool)
 m[:54,:]=False
 lab,num=ndi.label(m)
 # The component connecting the center hanger to the shirt is the garment.
 candidates=[]
 for yy in range(60,140,3):
  for xx in range(TILEW//2-15,TILEW//2+16,3):
   if lab[yy,xx]:candidates.append(int(lab[yy,xx]))
 if kind=='green':
  areas=ndi.sum(m,lab,range(num+1));areas[0]=0;label=areas.argmax()
 elif candidates:
  counts=np.bincount(candidates);label=counts.argmax()
 else:
  areas=ndi.sum(m,lab,range(num+1));areas[0]=0;label=areas.argmax()
 m=(lab==label)|wood_m
 m=ndi.binary_fill_holes(m);m=ndi.binary_closing(m,iterations=2)
 # Graph-cut edge refinement keeps pale cotton sleeves and thread detail.
 gc=np.zeros(m.shape,'uint8')
 gc[ndi.binary_dilation(m,iterations=35 if kind=='green' else 9)]=cv2.GC_PR_FGD
 gc[m]=cv2.GC_PR_FGD
 gc[ndi.binary_erosion(m,iterations=3)]=cv2.GC_FGD
 gc[:54,:]=cv2.GC_BGD
 gc[:,0:2]=cv2.GC_BGD;gc[:,-2:]=cv2.GC_BGD
 if m.sum()>300:
  bg=np.zeros((1,65),np.float64);fg=np.zeros((1,65),np.float64)
  cv2.grabCut(rgb,gc,None,bg,fg,2,cv2.GC_INIT_WITH_MASK)
  refined=(gc==cv2.GC_FGD)|(gc==cv2.GC_PR_FGD)
  lab,num=ndi.label(refined)
  point=lab[200 if kind=='green' else 120,TILEW//2]
  if point:refined=(lab==point)|wood_m
  m=ndi.binary_fill_holes(refined)
 # The captured chrome rod is removed, leaving only the independent garment.
 # Its hook is drawn as a small rigid piece by the renderer.
 m[:54,:]=False
 alpha=np.clip(ndi.gaussian_filter(m.astype(float),.46)*255,0,255).astype('uint8')
 out=Image.fromarray(np.dstack((rgb,alpha)))
 return out

# Photo fronts and multi-angle views. Each texture contains only one garment.
items=[
 ('camo','Camo Graphic Long Sleeve','long-sleeve','dark',None,0),
 ('essential','Made This Essential Tee','tee','black',ranges[0],90),
 ('dollar','Made This Dollar Tee','tee','white',ranges[1],180),
 ('underclass','Escape the Permanent Underclass Tee','tee','dark',ranges[2],250),
 ('republic','Save Chicken Republic Crewneck','crewneck','green',ranges[3],340),
 ('world','Remi 3 Long Sleeve','long-sleeve','black',ranges[4],400),
 ('flowers','Made This Flowers Tee','tee','white',ranges[5],480),
 ('studio','Made This Studio Tee','tee','white',None,0),
 ('portrait','Cheers Tee','tee','white',ranges[6],887),
 ('washed','Washed Grey Tee','tee','dark',None,0),
]
metadata=[]
for idx,(slug,name,typ,kind,rng,front_n) in enumerate(items):
 if os.environ.get('EXTRACT_ONLY') and slug not in os.environ['EXTRACT_ONLY'].split(','):continue
 pivot=PIVOTS[idx]
 hooks=ROOT/'public/hooks';hooks.mkdir(exist_ok=True)
 head=base.crop((pivot-40,654,pivot+40,694));rgb=np.array(head);hm=rgb.mean(2)<207;hm[34:]=False
 head.putalpha(Image.fromarray(np.uint8(ndi.gaussian_filter(hm.astype(float),.35)*255)));head.save(hooks/f'{slug}.webp',lossless=True)
 rest=matte(base,pivot,kind)
 rest.save(OUT/f'{slug}-rest.webp',quality=96)
 if os.environ.get('EXTRACT_REST_ONLY'):
  atlas=Image.open(OUT/f'{slug}-views.webp');atlas.paste(rest,(0,0));atlas.save(OUT/f'{slug}-views.webp',quality=97,method=3);continue
 if os.environ.get('EXTRACT_RACK_FRONT_ONLY'):
  if rng:
   old=json.loads((ROOT/'lib/garments.json').read_text());item=next(g for g in old if g['id']==slug)
   n=rng[1]-4;front=matte(Image.open(turns[n]).convert('RGB'),pivot,kind,n)
   atlas=Image.open(OUT/f'{slug}-views.webp');j=item['frames']-1;atlas.paste(front,((j%4)*640,(j//4)*810));atlas.save(OUT/f'{slug}-views.webp',quality=97,method=3)
  continue
 views=[]
 if rng:
  # All transition frames are processed, preserving the observed acceleration.
  for n in range(*[rng[0],rng[1]+1]):
   im=Image.open(turns[n]).convert('RGB');view=matte(im,pivot,kind,n)
   alpha=np.array(view.getchannel('A'))
   yy,xx=np.where(alpha>100)
   width=int(xx.max()-xx.min()) if len(xx) else 0
   views.append((n,view,width))
  # Keep rotation samples with growing visible width; stable duplicates are
  # redundant. 30 distinct high-quality angles are ample for this arc.
  growing=[];last=0
  for v in views:
   if v[2]>last+4:growing.append(v);last=v[2]
  if len(growing)>32:growing=[growing[j] for j in np.linspace(0,len(growing)-1,32).astype(int)]
  front=matte(Image.open(ANALYSIS/'full'/f'{front_n:04d}.png').convert('RGB'),pivot,kind,front_n)
  # Select a cursor-free front where available from the rotation's early hold.
  selected=min(views,key=lambda v:abs(v[0]-(rng[0]+29)))[1]
  front=selected
  fronts=[rest]+[v[1] for v in growing]+[front]
  widths=[0]+[v[2] for v in growing]+[max(v[2] for v in views)]
 else:
  front=rest
  fronts=[rest]
  widths=[0]
 front.save(OUT/f'{slug}-front.webp',quality=97)
 # Atlas sizes stay within browser texture limits; each cell is high resolution.
 cols=4;rows=(len(fronts)+cols-1)//cols
 atlas=Image.new('RGBA',(TILEW*cols,TILEH*rows))
 for j,im in enumerate(fronts):atlas.paste(im,((j%cols)*TILEW,(j//cols)*TILEH))
 atlas.save(OUT/f'{slug}-views.webp',quality=96,method=3)
 metadata.append(dict(id=slug,name=name,type=typ,pivot=(pivot-CARD[0])/W,asset=f'/garments/{slug}-views.webp',rest=f'/garments/{slug}-rest.webp',front=f'/garments/{slug}-front.webp',columns=cols,frames=len(fronts),cellWidth=TILEW,cellHeight=TILEH,widths=widths,sourceFrames=[v[0] for v in views],reference=True))
 print(slug,len(fronts),widths)
if os.environ.get('EXTRACT_REST_ONLY') or os.environ.get('EXTRACT_RACK_FRONT_ONLY'):sys.exit(0)
if os.environ.get('EXTRACT_ONLY'):
 old=json.loads((ROOT/'lib/garments.json').read_text());updated={g['id']:g for g in metadata};metadata=[updated.get(g['id'],g) for g in old]
(ROOT/'lib/garments.json').write_text(json.dumps(metadata,indent=2))
# Audit every decoded frame, with no frame sampling. Numerical temporal metrics
# document hold intervals, turns, and the focus transition in the supplied clip.
frames=sorted((ANALYSIS/'frames').glob('*.jpg'));previous=None;metrics=[]
for i,f in enumerate(frames):
 a=np.array(Image.open(f)).astype(float)
 delta=float(np.abs(a-previous).mean()) if previous is not None else 0
 metrics.append({'frame':i,'time':round(i/60,6),'meanAbsoluteFrameDelta':round(delta,5)})
 previous=a
(ROOT/'docs/frame-audit.json').write_text(json.dumps({'frames':len(frames),'fps':60,'duration':len(frames)/60,'metrics':metrics},indent=2))
print('Audit',len(frames),'frames')

# Offline candidate fitting from consecutive reference silhouettes. Does not edit assets.
# Only the first dark tee fit was accepted after visual review; white/occluded fits are uncertain.
# Usage: python tools/fit-consecutive-turns.py REFERENCE_FRAMES OUTPUT_JSON
import json, numpy as np,struct,cv2,sys
from pathlib import Path
from scipy import ndimage as ndi
from scipy.optimize import least_squares
root=Path(__file__).resolve().parents[1];frames=Path(sys.argv[1]);gs=json.load(open(root/'lib/garments.json'));measure=json.load(open(root/'docs/qa/three/motion-measurements.json'))['turns'];output=[]
for turn in measure:
 g=next(g for g in gs if g['id']==turn['id']);center=268+2912*g['pivot'];start=turn['startFrame']-10;end=min(turn['endFrame']+25,900 if g['id']=='portrait' else 2000)
 widths=[];bounds=[]
 for n in range(start,end+1):
  im=cv2.imread(str(frames/f'{n:04d}.jpg'));rgb=cv2.cvtColor(im[800:1450,round(center)-340:round(center)+340],cv2.COLOR_BGR2RGB).astype(float)
  chroma=rgb[:,:,2]-rgb[:,:,1]
  if g['id']=='republic':mask=(rgb[:,:,1]>rgb[:,:,0]+3)&(rgb.mean(2)<185)
  elif g['id'] in ['dollar','flowers','portrait']:mask=(chroma>1.5)&(rgb.mean(2)>176)&(rgb.mean(2)<239)
  else:mask=rgb.mean(2)<100
  mask=ndi.binary_closing(mask,iterations=2);labels,num=ndi.label(mask);areas=np.bincount(labels.ravel());areas[0]=0
  candidates=[]
  for lab in range(1,num+1):
   if areas[lab]<500:continue
   yy,xx=np.where(labels==lab)
   dist=abs(np.median(xx)-340)
   candidates.append((dist-areas[lab]/10000,lab))
  if not candidates:widths.append(None);bounds.append(None);continue
  chosen=min(candidates)[1];m=labels==chosen;yy,xx=np.where(m)
  # Use central body/sleeve rows; exclude cursor region at hem.
  rowwidth=[]
  for y in range(50,400):
   xs=np.where(m[y])[0]
   if len(xs)>10:rowwidth.append(xs[-1]-xs[0]+1)
  widths.append(float(np.percentile(rowwidth,98)) if rowwidth else None);bounds.append([int(xx.min()),int(xx.max())])
 raw=(root/'public'/g['mesh'].lstrip('/')).read_bytes();l=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+l]);binary=raw[28+l:];pos=[]
 for prim in doc['meshes'][0]['primitives'][:3]:
  a=doc['accessors'][prim['attributes']['POSITION']];v=doc['bufferViews'][a['bufferView']];p=np.frombuffer(binary,dtype='<f4',count=a['count']*3,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,3);pos.append(p)
 pos=np.concatenate(pos);pos=pos[(pos[:,1]<-160)&(pos[:,1]>-510)] # y in source crop rows850..1200 relative pivot690
 angles=np.linspace(-.5,1.7,2201);proj=pos[:,0,None]*np.cos(angles)+pos[:,2,None]*np.sin(angles);model=proj.max(0)-proj.min(0)
 obs=np.array([np.nan if w is None else w for w in widths]);valid=np.isfinite(obs);t=np.arange(len(widths))/60+start/60
 # Ignore disconnected side silhouettes at earliest yaw, but retain their measurements.
 fitvalid=valid&(t>=turn['startFrame']/60+.16)&(t<=turn['endFrame']/60+.10)
 def prediction(params):
  k,z,onset,scale=params;a=z*np.sqrt(k);wd=np.sqrt(k)*np.sqrt(1-z*z);dt=np.maximum(0,t-onset)
  yaw=np.exp(-a*dt)*(np.cos(wd*dt)+a/wd*np.sin(wd*dt))*g['restYaw']
  return np.interp(yaw,angles,model)*scale
 best=None
 for z in [.4,.6,.8]:
  fit=least_squares(lambda p:(prediction(p)-obs)[fitvalid],[75,z,turn['startFrame']/60,.98],bounds=([25,.3,start/60,.8],[240,.95,turn['startFrame']/60+.15,1.1]),loss='soft_l1',f_scale=8)
  err=float(np.mean(np.abs(prediction(fit.x)[fitvalid]-obs[fitvalid])))
  if best is None or err<best[0]:best=(err,fit.x)
 err,(k,z,onset,scale)=best
 rec={'id':g['id'],'startFrame':start,'widths':widths,'bounds':bounds,'acceptedForRuntime':g['id']=='essential','fit':{'stiffness':round(float(k),3),'damping':round(float(2*z*np.sqrt(k)),3),'ratio':round(float(z),3),'onset':round(float(onset),6),'scale':round(float(scale),4),'mae':round(err,3)}};output.append(rec);print(rec['id'],rec['fit'],flush=True)
Path(sys.argv[2]).write_text(json.dumps(output,indent=2)+'\n')

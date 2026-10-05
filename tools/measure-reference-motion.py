"""Measure every captured turn frame and fit rigid spring response to GLB widths.
Usage: python tools/measure-reference-motion.py /path/to/reference-analysis
Records measurements without changing runtime garment metadata.
"""
from pathlib import Path
import os,sys
import json,struct
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.optimize import least_squares
ROOT=Path(__file__).resolve().parents[1]
ANALYSIS=Path(sys.argv[1] if len(sys.argv)>1 else os.environ.get('REFERENCE_ANALYSIS','reference-analysis'))
gs=json.loads((ROOT/'lib/garments.json').read_text())
ranges=[('essential',57,108,'black'),('dollar',145,193,'white'),('underclass',208,257,'dark'),('republic',296,346,'green'),('world',375,422,'black'),('flowers',432,482,'white'),('portrait',859,898,'white')]
results=[];fileindex=0
for slug,start,end,kind in ranges:
 g=next(g for g in gs if g['id']==slug);pivot=268+2912*g['pivot'];widths=[];centers=[]
 for n in range(start,end+1):
  fileindex+=1;rgb=np.array(Image.open(ANALYSIS/'turns'/f'{fileindex:04d}.jpg'))
  near=rgb[740:815].astype(float);brown=(near[:,:,0]>near[:,:,1]+12)&(near[:,:,0]>near[:,:,2]+10)&(near.mean(2)<195)
  occupied=ndi.binary_closing(brown.sum(0)>1,iterations=20);labels,num=ndi.label(occupied);candidates=[]
  for sl in ndi.find_objects(labels):
   lo,hi=sl[0].start,sl[0].stop;weights=brown[:,lo:hi].sum(0)
   if weights.sum()>25:candidates.append(float((np.arange(lo,hi)*weights).sum()/weights.sum()))
  center=min(candidates,key=lambda x:abs(x-pivot)) if candidates else pivot
  if abs(center-pivot)>240:center=pivot
  a=rgb[690:1500,round(center)-320:round(center)+320].astype(float);chroma=a[:,:,2]-a[:,:,1]
  m=((chroma>1.5)&(a.mean(2)>176)) if kind=='white' else ((a[:,:,1]>a[:,:,0]+3)&(a.mean(2)<185)) if kind=='green' else ((chroma>1)&(a.mean(2)<185)) if kind=='black' else a.mean(2)<185
  wood=(a[:,:,0]>a[:,:,1]+9)&(a[:,:,0]>a[:,:,2]+7)&(a.mean(2)<195);wood[150:]=False;wood[:,:210]=False;wood[:,430:]=False
  m|=wood;m[:54]=False;m=ndi.binary_closing(m,iterations=2);lab,num=ndi.label(m)
  candidates=lab[60:140:3,305:336:3].ravel();candidates=candidates[candidates>0]
  if kind=='green' or len(candidates)==0:
   counts=np.bincount(lab.ravel());counts[0]=0;label=counts.argmax()
  else:label=np.bincount(candidates).argmax()
  mask=ndi.binary_fill_holes(lab==label);mask[:110]=False
  yy,xx=np.where(mask)
  widths.append(int(xx.max()-xx.min()+1) if len(xx) else None);centers.append(round(float(center),2))
 raw=(ROOT/'public'/g['mesh'].lstrip('/')).read_bytes();l=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+l]);b=raw[28+l:];positions=[]
 for p in d['meshes'][0]['primitives'][:3]:
  a=d['accessors'][p['attributes']['POSITION']];v=d['bufferViews'][a['bufferView']];positions.append(np.frombuffer(b,dtype='<f4',count=a['count']*3,offset=v['byteOffset']).reshape(-1,3))
 pos=np.concatenate(positions);focus=np.linspace(0,1,1001);angles=g['restYaw']*(1-focus)
 projected=pos[:,0,None]*np.cos(angles)+pos[:,2,None]*np.sin(angles)
 model_width=projected.max(0)-projected.min(0)
 # Keep all measurements. Non-monotonic widths are visible occlusions/segmentation
 # uncertainty, not missing or skipped frames.
 observed=np.array(widths,dtype=float);smooth=ndi.median_filter(observed,size=3)
 t=np.arange(len(observed))/60
 def sim(stiffness,damping,delay):
  value=0.;vel=0.;output=[]
  for at in t:
   target=1. if at>=delay else 0.
   for _ in range(2):vel+=((target-value)*stiffness-vel*damping)/120;value+=vel/120
   output.append(np.interp(np.clip(value,0,1),focus,model_width))
  return np.array(output)
 base=sim(145,23,0)
 best_fit=None
 for delay_frames in range(13):
  delay=delay_frames/60
  candidate=least_squares(lambda p:sim(p[0],p[1],delay)-smooth,[145,23],bounds=([60,14],[500,50]),loss='soft_l1',f_scale=10)
  prediction=sim(candidate.x[0],candidate.x[1],delay)
  error=float(abs(prediction-smooth).mean())
  if best_fit is None or error<best_fit[0]:best_fit=(error,delay_frames,candidate.x,prediction)
 best=best_fit[3]
 fit_params=[best_fit[2][0],best_fit[2][1],best_fit[1]/60]
 result={'id':slug,'startFrame':start,'endFrame':end,'frames':len(widths),'widths':widths,'centers':centers,'baselineWidthMae':round(float(abs(base-smooth).mean()),2),'fitWidthMae':round(float(abs(best-smooth).mean()),2),'fit':{'stiffness':round(float(fit_params[0]),3),'damping':round(float(fit_params[1]),3),'delay':round(float(fit_params[2]),3)}}
 result['calibrated']={'widthMae':round(best_fit[0],2),'startTime':round((start+best_fit[1])/60,6),'delayFrames':best_fit[1],'stiffness':round(float(best_fit[2][0]),3),'damping':round(float(best_fit[2][1]),3)}
 results.append(result)
 print(slug,'frames',len(widths),'widths',widths[:20],'baselineMae',result['baselineWidthMae'],'fit',result['fit'],'fitMae',result['fitWidthMae'])
(ROOT/'docs/qa/three/motion-measurements.json').write_text(json.dumps({'scope':'All 341 reference turn frames; threshold segmentation includes measurement uncertainty. Calibration uses actual production GLB projection widths.', 'processedFrames':sum(r['frames'] for r in results),'turns':results},indent=2)+'\n')

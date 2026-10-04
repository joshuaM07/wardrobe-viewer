"""Normalize the best hold poses and a hoodie's multi-view studio photography."""
from pathlib import Path
import sys,json,os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import cv2
root=Path(__file__).resolve().parents[1];out=root/'public/garments';analysis=Path(os.environ.get('REFERENCE_ANALYSIS','reference-analysis'))/'full'

def segment(im,kind):
 rgb=np.array(im);a=rgb.astype(float)
 m=((a[:,:,2]-a[:,:,1]>1.5)&(a.mean(2)>176)) if kind=='white' else a.mean(2)<190
 # Only the central garment; remove disconnected blurred products behind it.
 m[:30]=False
 lab,num=ndi.label(m);areas=ndi.sum(m,lab,range(num+1));areas[0]=0
 # Center chest is unambiguously the foreground garment in a detail hold.
 label=int(lab[min(450,m.shape[0]-1),m.shape[1]//2])
 if label==0:label=areas.argmax()
 m=ndi.binary_fill_holes(lab==label)
 brown=(a[:,:,0]>a[:,:,1]+10)&(a[:,:,0]>a[:,:,2]+7)&(a.mean(2)<192)
 brown[280:]=False;brown[:,:m.shape[1]//2-150]=False;brown[:,m.shape[1]//2+150:]=False
 m|=brown
 if kind=='white':
  m=ndi.binary_closing(m,iterations=3);m=ndi.binary_opening(m,iterations=2)
  gc=np.zeros(m.shape,'uint8');gc[ndi.binary_dilation(m,iterations=14)]=cv2.GC_PR_FGD
  gc[m]=cv2.GC_PR_FGD;gc[ndi.binary_erosion(m,iterations=3)]=cv2.GC_FGD
  gc[:30]=cv2.GC_BGD
  cv2.grabCut(rgb,gc,None,np.zeros((1,65)),np.zeros((1,65)),3,cv2.GC_INIT_WITH_MASK)
  refined=(gc==cv2.GC_FGD)|(gc==cv2.GC_PR_FGD);lab,n=ndi.label(refined)
  central=lab[450,m.shape[1]//2]
  if central:refined=lab==central
  m=ndi.binary_fill_holes(refined)|brown
  m=ndi.binary_closing(m,iterations=2)
 # Reject capture cursor whites, only the OS overlay is completely neutral.
 white=(rgb.min(2)>238)&(np.ptp(rgb.astype(float),axis=2)<7);white=ndi.binary_closing(white,iterations=2); lab,n=ndi.label(white)
 for sl in ndi.find_objects(lab):
  if sl is None:continue
  h=sl[0].stop-sl[0].start;w=sl[1].stop-sl[1].start
  if 55<h<155 and 25<w<125:
   mask=np.zeros(m.shape,'uint8');mask[max(0,sl[0].start-7):min(m.shape[0],sl[0].stop+7),max(0,sl[1].start-7):min(m.shape[1],sl[1].stop+7)]=255
   rgb=cv2.inpaint(rgb,mask,7,cv2.INPAINT_TELEA)
 alpha=np.uint8(np.clip(ndi.gaussian_filter(m.astype(float),.5)*255,0,255))
 return Image.fromarray(np.dstack((rgb,alpha)))

metadata=json.loads((root/'lib/garments.json').read_text())
# Product views in the capture have no cursor covering the front and much more
# visible detail than the small rack view. Use those for their held front poses.
refs={'dollar':(752,'white'),'underclass':(705,'dark'),'republic':(660,'dark'),'world':(625,'dark'),'flowers':('extra-07','white')}
for item in metadata:
 slug=item['id']
 if slug not in refs:continue
 n,kind=refs[slug];file=analysis/(f'{n:04d}.png' if isinstance(n,int) else f'{n}.png')
 im=Image.open(file).convert('RGB');roi=im.crop((1244,510,2204,1510));cut=segment(roi,kind)
 aa=np.array(cut.getchannel('A'));ys,xs=np.where(aa>100)
 # The broad front silhouette determines scale; shirt cloth stays crisp.
 desired=543 if slug=='republic' else max(item['widths']);item['widths'][-1]=desired;factor=desired/(xs.max()-xs.min())
 rgb=np.array(roi).astype(float);wood=(rgb[:,:,0]>rgb[:,:,1]+12)&(rgb[:,:,0]>rgb[:,:,2]+10)&(rgb.mean(2)<190);wood[260:]=False
 wy,wx=np.where(wood);cx=float(np.median(wx));top=float(np.where(wood.sum(1)>35)[0].min())
 item.update(detailScale=round(1/factor,6),detailY=round(510+top-272-58/factor,3),detailX=round(1244+cx-1724,3),detailHookHeight=int(top-wy.min()+2))
 view=Image.new('RGBA',(640,810));res=cut.resize((round(cut.width*factor),round(cut.height*factor)),Image.Resampling.LANCZOS)
 view.paste(res,(round(320-cx*factor),round(58-top*factor)),res)
 # Remove the chrome hook from the texture; a separate rigid hook is composited.
 arr=np.array(view);arr[:54,:,3]=0;view=Image.fromarray(arr)
 view.save(out/f'{slug}-front.webp',quality=98)
 atlas=Image.open(out/f'{slug}-views.webp');j=item['frames']-1
 atlas.paste(view,((j%4)*640,(j//4)*810));atlas.save(out/f'{slug}-views.webp',quality=97,method=3)
 print(slug,'front normalized',factor)
# Isolate the detail-view hook from its existing clean 4K capture.
im=Image.open(analysis/'extra-07.png').convert('RGB').crop((1678,531,1758,617));a=np.array(im).astype(float);alpha=np.uint8(np.clip((225-a.min(2))*6,0,255));im.putalpha(Image.fromarray(alpha));im.save(root/'public/detail-hook.webp',lossless=True)

(root/'lib/garments.json').write_text(json.dumps(metadata,indent=2))

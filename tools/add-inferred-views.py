"""Build angle textures for the three fronts not exposed in the reference."""
from pathlib import Path
from PIL import Image
import numpy as np,json,sys
root=Path(__file__).resolve().parents[1]
if len(sys.argv)!=2:raise SystemExit('Usage: python tools/add-inferred-views.py inferred-front-sheet.png')
src=Image.open(sys.argv[1])
meta=json.loads((root/'lib/garments.json').read_text())
for slug,box in [('camo',(0,0,608,887)),('studio',(608,0,1174,887)),('washed',(1174,0,1774,887))]:
 crop=src.crop(box);a=np.array(crop);alpha=a[:,:,3]
 yy,xx=np.where(alpha>100);lo,hi=xx.min(),xx.max();bottom=yy.max()
 # Registration at the wooden hanger's top, without its generated hook.
 brown=(a[:,:,0]>a[:,:,1]+25)&(a[:,:,0]>a[:,:,2]+25)&(alpha>100)
 brown[200:]=False
 by,bx=np.where(brown);top=np.where(brown.sum(1)>20)[0].min();cx=np.median(bx)
 sx=540/(hi-lo);sy=720/(bottom-top)
 resized=crop.resize((round(crop.width*sx),round(crop.height*sy)),Image.Resampling.LANCZOS)
 front=Image.new('RGBA',(640,810));front.paste(resized,(round(320-cx*sx),round(58-top*sy)))
 a=np.array(front);a[:54,:,3]=0;front=Image.fromarray(a)
 rest=Image.open(root/f'public/garments/{slug}-rest.webp')
 views=[rest];widths=[0]
 for k in range(1,25):
  t=k/24;w=round(155+(540-155)*np.sin(t*np.pi/2))
  narrow=front.resize((round(640*w/540),810),Image.Resampling.LANCZOS)
  view=Image.new('RGBA',(640,810));view.paste(narrow,((640-narrow.width)//2,0));views.append(view);widths.append(w)
 atlas=Image.new('RGBA',(2560,810*7))
 for j,view in enumerate(views):atlas.paste(view,((j%4)*640,(j//4)*810))
 atlas.save(root/f'public/garments/{slug}-views.webp',quality=96,method=3)
 front.save(root/f'public/garments/{slug}-front.webp',quality=97)
 item=next(g for g in meta if g['id']==slug);item.update(frames=25,widths=widths,frontInferred=True)
(root/'lib/garments.json').write_text(json.dumps(meta,indent=2))

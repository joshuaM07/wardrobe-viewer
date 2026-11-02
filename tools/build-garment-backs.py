"""Infer clean unprinted backs from the colour-neutral cotton maps.

The original backs were filled across large graphics and contained dark smudges.
Use the print-free fabric continuation, keeping its grain and broad shading.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
import cv2
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parents[1]
MODELS=ROOT/'public/models'
garments=json.loads((ROOT/'lib/garments.json').read_text())+[json.loads((ROOT/'public/garments/hoodie.json').read_text())]
def linear(c):return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
def srgb(c):return np.where(c<=.0031308,c*12.92,1.055*np.maximum(c,0)**(1/2.4)-.055)
for g in garments:
    neutral=np.asarray(Image.open(MODELS/f'{g["id"]}-fabric.jpg').convert('RGB'))[:,:640][:,::-1].copy()
    if g['id']=='hoodie':
        # A front kangaroo pocket must not be copied onto the inferred back.
        # Continue broad cloth shading from its boundary, then retain grain
        # from the clean upper chest rather than painting a flat rectangle.
        region=np.zeros((810,640),'uint8');region[420:669,145:497]=1
        small=cv2.resize(neutral.astype('float32'),(160,203),interpolation=cv2.INTER_AREA)
        mask=cv2.resize(region,(160,203),interpolation=cv2.INTER_NEAREST)>0
        small[mask]=np.median(small[~mask],axis=0)
        kernel=np.array([[0,.25,0],[.25,0,.25],[0,.25,0]],dtype='float32')
        for _ in range(1200):small[mask]=cv2.filter2D(small,-1,kernel)[mask]
        continuation=cv2.resize(small,(640,810),interpolation=cv2.INTER_CUBIC)
        clean=neutral.astype(float);grain=clean-ndi.gaussian_filter(clean,(2,2,0))
        continuation[420:669]+=np.tile(grain[230:355],(2,1,1))[:249]*.6
        weight=np.clip(ndi.distance_transform_edt(region)/12,0,1)[:,:,None]
        neutral=np.clip(clean*(1-weight)+continuation*weight,0,255).astype('uint8')
    shade=np.clip(linear(neutral.astype(float)/255)[:,:,:1]/.5149,.08,1.4)
    color=linear(np.array([int(g['fabricColor'][i:i+2],16)/255 for i in [1,3,5]]))
    back=np.clip(np.rint(srgb(color*shade)*255),0,255).astype('uint8')
    Image.fromarray(back).save(MODELS/f'{g["id"]}-back.jpg',quality=92)
    Image.fromarray(neutral).save(MODELS/f'{g["id"]}-fabric-back.jpg',quality=90)
    print(g['id'],'clean cotton back')

"""Infer clean unprinted backs from the colour-neutral cotton maps.

The original backs were filled across large graphics and contained dark smudges.
Use the print-free fabric continuation, keeping its grain and broad shading.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
MODELS=ROOT/'public/models'
garments=json.loads((ROOT/'lib/garments.json').read_text())+[json.loads((ROOT/'public/garments/hoodie.json').read_text())]
def linear(c):return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
def srgb(c):return np.where(c<=.0031308,c*12.92,1.055*np.maximum(c,0)**(1/2.4)-.055)
for g in garments:
    neutral=np.asarray(Image.open(MODELS/f'{g["id"]}-fabric.jpg').convert('RGB'))[:,:640][:,::-1].copy()
    shade=np.clip(linear(neutral.astype(float)/255)[:,:,:1]/.5149,.08,1.4)
    color=linear(np.array([int(g['fabricColor'][i:i+2],16)/255 for i in [1,3,5]]))
    back=np.clip(np.rint(srgb(color*shade)*255),0,255).astype('uint8')
    Image.fromarray(back).save(MODELS/f'{g["id"]}-back.jpg',quality=92)
    Image.fromarray(neutral).save(MODELS/f'{g["id"]}-fabric-back.jpg',quality=90)
    print(g['id'],'clean cotton back')

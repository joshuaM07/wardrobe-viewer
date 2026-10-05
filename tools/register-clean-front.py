"""Register clean captured pixels over an occluded reference texture region.

The original frontal outline, artwork, and other texels are preserved. This is
offline reference registration, not runtime image animation or cloth simulation.
"""
from pathlib import Path
import cv2, numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
raw=Image.open(ROOT/'docs/reference-crops/portrait-raw-front.webp').convert('RGBA')
clean=Image.open(ROOT/'docs/reference-crops/portrait-clean-capture.webp').convert('RGBA')
a=np.array(raw);b=np.array(clean)
mask=np.zeros((810,640),'uint8');mask[360:650,230:460]=255
gray_a=cv2.cvtColor(a[:,:,:3],cv2.COLOR_RGB2GRAY).astype('float32')/255
gray_b=cv2.cvtColor(b[:,:,:3],cv2.COLOR_RGB2GRAY).astype('float32')/255
matrix=np.eye(2,3,dtype='float32')
correlation,matrix=cv2.findTransformECC(gray_a,gray_b,matrix,cv2.MOTION_AFFINE,
 (cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,180,1e-6),mask,5)
if correlation<.85:raise RuntimeError(f'Insufficient reference registration: {correlation}')
aligned=cv2.warpAffine(b[:,:,:3],matrix,(640,810),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP)
patch=np.zeros((810,640),'uint8');patch[238:565,160:279]=255
sample=np.zeros((810,640),bool);sample[200:490,140:300]=True
sample&=(a[:,:,3]>240)&(patch==0)&(a[:,:,:3].mean(2)>195)&(aligned.mean(2)>195)
delta=np.median(a[:,:,:3].astype(float)[sample]-aligned.astype(float)[sample],axis=0)
aligned=np.clip(aligned.astype(float)+delta,0,255)
blend=cv2.GaussianBlur(patch.astype('float32')/255,(0,0),5)[:,:,None]
result=a.copy();result[:,:,:3]=np.rint(a[:,:,:3]*(1-blend)+aligned*blend).astype('uint8')
Image.fromarray(result).save(ROOT/'public/garments/portrait-front.webp',quality=97,method=5)
print({'registrationCorrelation':round(float(correlation),4),'frontalAlphaPreserved':bool(np.array_equal(a[:,:,3],result[:,:,3]))})

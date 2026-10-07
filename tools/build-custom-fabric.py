"""Prepare colour-neutral fabric and original-print masks offline.

These maps share the production GLB's UV islands. They add no per-frame image
work and never alter the geometry, wood hanger, or original catalogue textures.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
import cv2
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models'
GARMENTS = json.loads((ROOT/'lib/garments.json').read_text())
GARMENTS += [json.loads((ROOT/'public/garments/hoodie.json').read_text())]

# Registered print areas, in the original 640x810 front-photo coordinates.
BOXES = {
    'camo': (165, 210, 472, 685), 'essential': (260, 250, 380, 320),
    'dollar': (170, 180, 470, 660), 'underclass': (160, 160, 480, 550),
    'republic': (175, 200, 465, 575), 'world': (170, 160, 470, 530),
    'flowers': (175, 140, 465, 520), 'studio': None,
    'portrait': (150, 160, 480, 715), 'washed': None, 'hoodie': None,
}

def remove_print(rgb, region, base_color):
    # A large Telea fill leaves angular wedges in the chest. Solve a smooth
    # fabric continuation from the unprinted boundary at quarter resolution.
    size=(160,203)
    small=cv2.resize(rgb.astype('float32'),size,interpolation=cv2.INTER_AREA)
    mask=cv2.resize(region,size,interpolation=cv2.INTER_NEAREST)>0
    small[mask]=base_color
    kernel=np.array([[0,.25,0],[.25,0,.25],[0,.25,0]],dtype='float32')
    for _ in range(1000):small[mask]=cv2.filter2D(small,-1,kernel)[mask]
    continuation=cv2.resize(small,(640,810),interpolation=cv2.INTER_CUBIC)
    weight=np.clip(ndi.distance_transform_edt(region>0)/8,0,1)[:,:,None]
    return np.clip(rgb*(1-weight)+continuation*weight,0,255).astype('uint8')

def neutral(rgb, base):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(float)
    if base < 100:
        # Very bright dots on dark side captures are neighbouring white-shirt
        # contamination, not cotton highlights. Remove them before recolouring.
        contamination=(gray>max(base*2.3,80)).astype('uint8')*255
        rgb=cv2.inpaint(rgb,contamination,9,cv2.INPAINT_TELEA)
        gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY).astype(float)
    # Retain broad folds and fine cotton detail without amplifying dark-source
    # JPEG noise into a new fabric pattern when changing charcoal to white.
    smooth = ndi.gaussian_filter(gray, 2)
    ratio = np.clip(smooth / max(base, 8), .08, 1.8) ** .42
    detail = np.clip((gray-smooth) / max(base, 12), -.12, .12)
    value = np.clip(190 * ratio + detail*26, 35, 250).astype('uint8')
    return np.repeat(value[:, :, None], 3, axis=2)

for g in GARMENTS:
    slug = g['id']
    atlas = np.array(Image.open(OUT/f'{slug}-albedo.jpg').convert('RGB'))
    back = np.array(Image.open(OUT/f'{slug}-back.jpg').convert('RGB'))
    front, side = atlas[:, :640].copy(), atlas[:, 640:].copy()
    fabric_rgb = [int(g['fabricColor'][i:i+2],16) for i in (1,3,5)]
    region = np.zeros((810, 640), 'uint8')
    box = BOXES[slug]
    if box:
        x0, y0, x1, y1 = box
        region[y0:y1, x0:x1] = 255
        blank = remove_print(front, region, fabric_rgb)
        # The print alpha excludes the surrounding photographed fabric so a
        # colour change never leaves an old-colour rectangle around the logo.
        difference = np.linalg.norm(front.astype(float)-blank.astype(float), axis=2)
        threshold = 18 if np.mean(front[region==0]) > 90 else 14
        alpha = np.clip((difference-threshold) / 18, 0, 1) * (region/255)
        alpha = ndi.gaussian_filter(alpha, .4)
    else:
        blank, alpha = front, np.zeros((810, 640))
    base = float(np.dot(fabric_rgb, [.299, .587, .114]))
    clean_atlas = np.concatenate([neutral(blank, base), neutral(side, base)], axis=1)
    Image.fromarray(clean_atlas).save(OUT/f'{slug}-fabric.jpg', quality=90)
    Image.fromarray(neutral(back, base)).save(OUT/f'{slug}-fabric-back.jpg', quality=90)
    mask = np.concatenate([np.rint(alpha*255).astype('uint8'), np.zeros((810,640),'uint8')], axis=1)
    Image.fromarray(mask).save(OUT/f'{slug}-print-mask.png', optimize=True)
    print(slug, 'neutral fabric + original print mask')

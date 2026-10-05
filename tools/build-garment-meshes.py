"""Bake static, closed garment/hanger meshes from the registered reference photos.

The browser loads these GLBs, not the original rotation atlases. A front silhouette
and the measured side silhouette constrain the volume. Fold relief is baked once;
there is no runtime cloth solver. Unseen backs remain explicitly inferred.
"""
from pathlib import Path
import json, struct, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import Delaunay
import cv2

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models'
OUT.mkdir(exist_ok=True)
garments = json.loads((ROOT/'lib/garments.json').read_text())
garments += [json.loads((ROOT/'public/garments/hoodie.json').read_text())]


def normals(positions, triangles):
    n = np.zeros_like(positions)
    t = positions[triangles]
    fn = np.cross(t[:, 1]-t[:, 0], t[:, 2]-t[:, 0])
    for k in range(3):
        np.add.at(n, triangles[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)


def shell(mask, depth_front, depth_back, material):
    contours, _ = cv2.findContours(mask.astype('uint8'), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea).reshape(-1, 2)
    boundary = contour[::3]
    yy, xx = np.mgrid[0:810:8, 0:640:8]
    interior = np.stack([xx[mask[yy, xx]], yy[mask[yy, xx]]], 1)
    points = np.unique(np.concatenate([boundary, interior]), axis=0)
    dt = Delaunay(points)
    tri = dt.simplices
    samples = [points[tri].mean(1)] + [(points[tri[:, k]]+points[tri[:, (k+1)%3]])/2 for k in range(3)]
    dilated = ndi.binary_dilation(mask, iterations=2)
    keep = np.ones(len(tri), bool)
    for sample in samples:
        s = np.rint(sample).astype(int)
        keep &= dilated[s[:, 1].clip(0, 809), s[:, 0].clip(0, 639)]
    tri = tri[keep]
    # Image Y runs down; glTF Y runs up. Front faces must face +Z.
    tri = tri[:, [0, 2, 1]]
    p = points.astype('float32')
    uv = np.stack([p[:, 0]/640, p[:, 1]/810], 1)
    front = np.stack([p[:, 0]-320, -p[:, 1], depth_front[points[:, 1], points[:, 0]]], 1)
    back = front.copy()
    back[:, 2] = depth_back[points[:, 1], points[:, 0]]
    front_tri = tri.copy()
    # scipy's Delaunay winding is consistent in image coordinates, but explicitly
    # orient against the physical outward direction rather than relying on it.
    ft = front[front_tri]
    wrong = np.cross(ft[:, 1]-ft[:, 0], ft[:, 2]-ft[:, 0])[:, 2] < 0
    front_tri[wrong] = front_tri[wrong][:, [0, 2, 1]]
    back_tri = front_tri[:, [0, 2, 1]]
    edges = np.concatenate([front_tri[:, [0, 1]], front_tri[:, [1, 2]], front_tri[:, [2, 0]]])
    sorted_edges = np.sort(edges, axis=1)
    _, unique_indices, counts = np.unique(sorted_edges, axis=0, return_index=True, return_counts=True)
    edge = edges[unique_indices[counts == 1]]
    # Independent seam vertices keep the thin edge from smoothing into the face.
    sides = np.concatenate([front[edge[:, 0]], front[edge[:, 1]], back[edge[:, 0]], back[edge[:, 1]]])
    e = len(edge)
    side_tri = np.concatenate([np.stack([np.arange(e), np.arange(e)+2*e, np.arange(e)+e], 1),
                               np.stack([np.arange(e)+e, np.arange(e)+2*e, np.arange(e)+3*e], 1)])
    suv = np.concatenate([uv[edge[:, 0]], uv[edge[:, 1]], uv[edge[:, 0]], uv[edge[:, 1]]])
    return [(front, uv, front_tri, material), (back, uv, back_tri, material+1), (sides, suv, side_tri, material+2)]


def write_glb(path, primitives, slug):
    blob = bytearray()
    views, accessors, ps = [], [], []
    def accessor(array, typ, component, target):
        while len(blob)%4: blob.append(0)
        off = len(blob)
        data = array.tobytes()
        blob.extend(data)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
        a = {'bufferView': len(views)-1, 'componentType': component, 'count': len(array), 'type': typ}
        if typ == 'VEC3':
            a['min'] = array.min(0).tolist()
            a['max'] = array.max(0).tolist()
        accessors.append(a)
        return len(accessors)-1
    for p, uv, tri, material in primitives:
        p = p.astype('<f4'); uv = uv.astype('<f4'); tri = tri.astype('<u4')
        n = normals(p, tri).astype('<f4')
        ps.append({'attributes': {'POSITION': accessor(p, 'VEC3', 5126, 34962),
                                  'NORMAL': accessor(n, 'VEC3', 5126, 34962),
                                  'TEXCOORD_0': accessor(uv, 'VEC2', 5126, 34962)},
                   'indices': accessor(tri.reshape(-1), 'SCALAR', 5125, 34963), 'material': material})
    mats = []
    for name, tex, roughness in [('ClothFront', 0, 1), ('ClothBack', 1, 1), ('ClothSeam', 0, 1),
                                 ('HangerFront', 0, .52), ('HangerBack', 0, .52), ('HangerEdge', 0, .52)]:
        mats.append({'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': tex},
                     'metallicFactor': 0, 'roughnessFactor': roughness}, 'doubleSided': False})
    gltf = {'asset': {'version': '2.0', 'generator': 'Wardrobe static surface reconstruction'},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': slug}],
            'meshes': [{'name': slug, 'primitives': ps}], 'materials': mats,
            'textures': [{'source': 0}, {'source': 1}],
            'images': [{'uri': f'{slug}-albedo.jpg'}, {'uri': f'{slug}-back.jpg'}],
            'bufferViews': views, 'accessors': accessors, 'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js))%4)
    blob += b'\0' * ((-len(blob))%4)
    length = 12+8+len(js)+8+len(blob)
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, length)+struct.pack('<II', len(js), 0x4e4f534a)+js+
                     struct.pack('<II', len(blob), 0x004e4942)+blob)


for g in garments:
    slug = g['id']
    if os.environ.get('BUILD_GARMENTS') and slug not in os.environ['BUILD_GARMENTS'].split(','):continue
    im = Image.open(ROOT/'public'/g['front'].lstrip('/')).convert('RGBA')
    rest = Image.open(ROOT/'public'/g['rest'].lstrip('/')).convert('RGBA')
    a, side = np.array(im), np.array(rest)
    # The inferred fronts are normalized to the original garment's actual hem.
    if slug in ('camo', 'studio', 'washed'):
        fy = np.where(a[:, :, 3] > 100)[0].max()
        ry = np.where(side[:, :, 3] > 100)[0].max()
        segment = im.crop((0, 58, 640, fy+1)).resize((640, ry-57), Image.Resampling.LANCZOS)
        normalized = Image.new('RGBA', (640, 810))
        normalized.paste(im.crop((0, 0, 640, 58)), (0, 0))
        normalized.paste(segment, (0, 58))
        a = np.array(normalized)
    if slug == 'hoodie':
        # Generated turntable views have different framing. Register the side hem
        # to the front before using it as a silhouette constraint.
        fy = np.where(a[:, :, 3] > 100)[0].max(); ry = np.where(side[:, :, 3] > 100)[0].max()
        normalized = Image.new('RGBA', (640, 810))
        normalized.paste(rest.crop((0, 0, 640, 77)), (0, 0))
        normalized.paste(rest.crop((0, 77, 640, ry+1)).resize((640, fy-76), Image.Resampling.LANCZOS), (0, 77))
        side = np.array(normalized)
    rgb = a[:, :, :3].astype(float)
    mask = a[:, :, 3] > 100
    wood = (rgb[:, :, 0] > rgb[:, :, 1]+9) & (rgb[:, :, 0] > rgb[:, :, 2]+6) & mask
    wood[155:] = False
    wood[:, :220] = False; wood[:, 420:] = False
    if slug == 'hoodie':
        wood[:77] = False
    wood = ndi.binary_closing(wood, iterations=2)
    labels, n = ndi.label(wood)
    if n:
        counts = np.bincount(labels.ravel()); counts[0] = 0
        wood = ndi.binary_fill_holes(labels == counts.argmax())
    cloth = mask & ~ndi.binary_dilation(wood, iterations=1)
    cloth[:95 if slug == 'hoodie' else 76] = False
    labels, n = ndi.label(cloth)
    counts = np.bincount(labels.ravel()); counts[0] = 0
    cloth = ndi.binary_fill_holes(labels == counts.argmax())
    # Preserve a rounded, inflated fabric cross-section rather than extruding a
    # flat card. The registered side silhouette bounds its actual thickness.
    distance = ndi.distance_transform_edt(cloth)
    depth = 3 + (42 if g['type'] == 'hoodie' else 27 if g['type'] != 'tee' else 24) * np.sqrt(np.clip(distance/38, 0, 1))
    gray = rgb.mean(2)/255
    fold = (ndi.gaussian_filter(gray, 3)-ndi.gaussian_filter(gray, 18))*24
    yy, xx = np.mgrid[:810, :640]
    art_region = (abs(xx-320) < 120) & (yy > 170) & (yy < 485)
    fold[art_region] = 0
    fold *= np.clip(distance/14, 0, 1)
    front = depth + fold
    back = -depth + fold*.35
    rest_yaw = np.deg2rad(77 if slug == 'world' else 74 if slug == 'hoodie' else 80)
    # A side silhouette is a second geometric constraint, not an animation frame.
    sm = side[:, :, 3] > 90
    sm[:110] = False
    for y in range(110, 810):
        row = np.where(sm[y])[0]
        xs = np.where(cloth[y])[0]
        if len(row) == 0 or len(xs) == 0: continue
        # Fit both edges of the measured side silhouette. Merely clamping the
        # initial depth inside these bounds leaves the resting pose too thin.
        c, s = np.cos(rest_yaw), np.sin(rest_yaw)
        xf = (np.arange(640)-320)*c + front[y]*s
        xb = (np.arange(640)-320)*c + back[y]*s
        low = min(xf[xs].min(), xb[xs].min())
        high = max(xf[xs].max(), xb[xs].max())
        ratio = (row.max()-row.min()) / max(1, high-low)
        for depth, projected in [(front, xf), (back, xb)]:
            fitted = row.min()-320 + (projected-low)*ratio
            depth[y] += (fitted-projected)/s
    front = ndi.gaussian_filter(front, 1.4); back = ndi.gaussian_filter(back, 1.4)
    if slug == 'hoodie':
        cavity = np.exp(-((xx-320)/55)**2-((yy-152)/37)**2)
        front -= cavity*40
        # Extra hood volume and the raised kangaroo-pocket surface are baked in.
        front += np.exp(-((abs(xx-320)-88)/25)**2-((yy-151)/52)**2)*15
        pocket = ((yy > 450) & (yy < 638) & (abs(xx-320) < (125-(638-yy)*.13)))
        front += ndi.gaussian_filter(pocket.astype(float), 6)*6
    primitives = shell(cloth, front, back, 0)
    if wood.sum() > 50:
        primitives += shell(wood, np.full((810, 640), 5), np.full((810, 640), -5), 3)
    # Fill outside the matte with the nearest cloth/wood texel. This prevents
    # compressed texture mipmaps from importing a grey background at the seam.
    safe_mask=ndi.binary_erosion(mask,iterations=3)
    _, nearest = ndi.distance_transform_edt(~safe_mask, return_indices=True)
    filled = a[:, :, :3].copy()
    filled[~safe_mask] = filled[nearest[0][~safe_mask], nearest[1][~safe_mask]]
    Image.fromarray(filled).save(OUT/f'{slug}-albedo.jpg', quality=96, subsampling=0)
    # Unseen backs use the same fabric, with print regions removed offline.
    inpaint = np.zeros((810, 640), 'uint8')
    inpaint[140:600, 195:447] = 255
    inferred_back = cv2.inpaint(filled, inpaint, 15, cv2.INPAINT_TELEA)
    Image.fromarray(inferred_back).save(OUT/f'{slug}-back.jpg', quality=91)
    sm = side[:, :, 3] > 100
    _, ni = ndi.distance_transform_edt(~sm, return_indices=True)
    srgb = side[:, :, :3].copy()
    srgb[~sm] = srgb[ni[0][~sm], ni[1][~sm]]
    Image.fromarray(srgb).save(OUT/f'{slug}-side.jpg', quality=96, subsampling=0)
    write_glb(OUT/f'{slug}.glb', primitives, slug)
    g.update(mesh=f'/models/{slug}.glb', sideTexture=f'/models/{slug}-side.jpg', restYaw=float(rest_yaw),
             meshTriangles=sum(len(p[2]) for p in primitives), meshVertices=sum(len(p[0]) for p in primitives))
    # Sample unprinted sleeve/body edges, not the large centre graphics.
    fabric=rgb[cloth & (distance>8) & (abs(xx-320)>145) & (yy>180) & (yy<650)]
    if len(fabric)<50: fabric=rgb[cloth & (distance>15) & (yy>500) & (yy<650)]
    if len(fabric):g['fabricColor']='#'+''.join(f'{int(x):02x}' for x in np.median(fabric,axis=0))
    wood_rows=np.where(wood.sum(1)>3)[0]
    g['hangerTop']=int(wood_rows.min()+4) if len(wood_rows) else 60
    if 'detailScale' not in g:
        hem=int(np.where(cloth)[0].max())
        g.update(detailY=280,detailScale=round(870/hem,6),detailX=0)
    print(slug, g['meshVertices'], 'vertices', g['meshTriangles'], 'triangles')

(ROOT/'lib/garments.json').write_text(json.dumps(garments[:-1], indent=2)+'\n')
(ROOT/'public/garments/hoodie.json').write_text(json.dumps(garments[-1], indent=2)+'\n')

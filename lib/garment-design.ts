import type { Garment } from './wardrobe-three';

export type PrintSide = 'front' | 'back';
export type Artwork = { dataUrl: string; name: string; aspect: number; width: number; x: number; y: number };
export type GarmentDesign = { color?: string; originalPrint: boolean; front?: Artwork; back?: Artwork };
export type SavedWardrobe = { version: 1; designs: Record<string, GarmentDesign>; added: Garment[] };
export const defaultDesign = (): GarmentDesign => ({ originalPrint: true });
export const blankDesign = (color = '#e8e3d8'): GarmentDesign => ({ color, originalPrint: false });
export const COLOR_SWATCHES = ['#f5f1e8','#17191c','#76746e','#5b4036','#3d5b48','#263e62','#8b3437','#cbb792','#d3b8c7','#b7cbd4'];
export const CLOTHING_TYPES = [
  { type: 'tee', label: 'T-shirt', source: 'flowers' },
  { type: 'long-sleeve', label: 'Long sleeve', source: 'world' },
  { type: 'crewneck', label: 'Crewneck', source: 'republic' },
  { type: 'hoodie', label: 'Hoodie', source: 'hoodie' },
] as const;

export function arrangeRack(garments: Garment[]): Garment[] {
  if (garments.length <= 10) return garments;
  return garments.map((g, i) => ({ ...g, pivot: .17 + .66 * i / (garments.length-1) }));
}

export function sanitizeSavedWardrobe(value: unknown): SavedWardrobe | undefined {
  if(!value||typeof value!=='object'||(value as SavedWardrobe).version!==1)return;
  const raw=value as Partial<SavedWardrobe>, designs:Record<string,GarmentDesign>={};
  for(const [id,design] of Object.entries(raw.designs??{})){
    if(!design||typeof design!=='object')continue;
    const clean:GarmentDesign={originalPrint:design.originalPrint!==false};
    if(typeof design.color==='string'&&/^#[0-9a-f]{6}$/i.test(design.color))clean.color=design.color;
    for(const side of ['front','back'] as const){
      const art=design[side];
      if(!art||typeof art.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(art.dataUrl)||art.dataUrl.length>16_000_000)continue;
      if(![art.aspect,art.width,art.x,art.y].every(Number.isFinite)||art.aspect<=0||art.aspect>200)continue;
      clean[side]={dataUrl:art.dataUrl,name:String(art.name??'Artwork').slice(0,200),aspect:art.aspect,width:Math.min(360,Math.max(1,art.width)),x:Math.min(100,Math.max(-100,art.x)),y:Math.min(600,Math.max(100,art.y))};
    }
    designs[id]=clean;
  }
  const seen=new Set<string>();
  const added=Array.isArray(raw.added)?raw.added.filter(g=>{
    if(!g||typeof g.id!=='string'||!/^custom-[a-z0-9-]+$/i.test(g.id)||typeof g.name!=='string'||!CLOTHING_TYPES.some(t=>t.source===g.sourceId)||seen.has(g.id))return false;
    seen.add(g.id);return true;
  }).slice(0,10).map(g=>({...g,name:g.name.slice(0,120)})):[];
  return {version:1,designs,added};
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('wardrobe-designs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Design storage is blocked.'));
  });
}

export async function readSavedWardrobe(): Promise<SavedWardrobe | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('state').objectStore('state').get('wardrobe');
      request.onsuccess = () => {
        resolve(sanitizeSavedWardrobe(request.result));
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveWardrobe(state: SavedWardrobe) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('state', 'readwrite');
      transaction.objectStore('state').put(state, 'wardrobe');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function prepareArtwork(file: File): Promise<Artwork> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be opened.'); });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width*bitmap.height > 80_000_000) throw new Error('This image is too large. Use a smaller version.');
    const ratio = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width*ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height*ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0,0,canvas.width,canvas.height).data;
    let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>12){
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
    }
    if(maxX<0)throw new Error('This image is completely transparent.');
    const crop=document.createElement('canvas');crop.width=maxX-minX+1;crop.height=maxY-minY+1;
    crop.getContext('2d')!.drawImage(canvas,minX,minY,crop.width,crop.height,0,0,crop.width,crop.height);
    const aspect=crop.width/crop.height;
    return {dataUrl:crop.toDataURL('image/png'),name:file.name,aspect,width:Math.min(240,280*aspect),x:0,y:300};
  } finally { bitmap.close(); }
}

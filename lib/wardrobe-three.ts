import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { garmentMaterial, type FabricMaterial } from './garment-material';
import type { GarmentDesign, PrintSide } from './garment-design';
import { garmentAssetUrl } from './garment-assets';
import { clamp, spring, stepSpring, stepGlide, type Spring } from './motion';
import { mobileRackView, mobileProductView, desktopRackView } from './rack-view';
import { clothMotion, stepCloth, separateRack, garmentMass, solveRailContacts, type ClothMotion, type Envelope } from './garment-motion';

export type Garment = {
  id: string; name: string; type: string; pivot: number; mesh: string;
  sourceId?: string;
  restYaw: number; reference: boolean;
  fabricColor?: string;
  hangerTop?: number;
  turnStiffness?: number; turnDamping?: number;
  detailScale?: number; detailY?: number; detailX?: number;
};
export type Mode = 'rack' | 'product' | 'about' | 'contact';
export type WardrobeState = {
  active: number; selected: number; mode: Mode; demo: boolean; demoStart: number;
  reduced: boolean; spin: number;
  dragging?: boolean;
  studio?: boolean;
  mobile: boolean; rackPosition: number;
};
type Item = {
  garment: Garment; root: THREE.Group; body: THREE.Mesh<THREE.BufferGeometry, FabricMaterial>; focus: Spring;
  x: Spring; y: Spring; scale: Spring;
  backMap: THREE.Texture;
  sway: Spring; designVersion: number; released: boolean;
  prepared: boolean;
  cloth: ClothMotion;
  inDetail: boolean;
  design?: GarmentDesign;
  hydrating?: boolean;
  designFailed?: boolean;
  residencyEpoch?: number;
  designTextures: Set<THREE.Texture>;
  fabric?: Promise<THREE.Texture[]>;
  artwork: Partial<Record<PrintSide, { url: string; texture: Promise<THREE.Texture>; value?: THREE.Texture }>>;
};

const W = 2912, H = 1620, GARMENT_Y = 418;
const restingZ = 0;
const blurVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const blurFragment = `precision highp float;
uniform sampler2D image;uniform vec2 direction;uniform float opacity;
varying vec2 vUv;
void main(){
  vec4 c=texture2D(image,vUv)*.227027;
  c+=texture2D(image,vUv+direction*1.384615)*.316216;
  c+=texture2D(image,vUv-direction*1.384615)*.316216;
  c+=texture2D(image,vUv+direction*3.230769)*.070270;
  c+=texture2D(image,vUv-direction*3.230769)*.070270;
  gl_FragColor=vec4(c.rgb,c.a*opacity);
  #include <colorspace_fragment>
}`;

/** Static GLBs, bounded cloth follow-through, and demand-driven rendering. */
export class WardrobeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-W/2, W/2, H/2, -H/2, .1, 8000);
  private rail = new THREE.Group();
  private items: Item[] = [];
  private rackSpread = 182;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hoverProxy = new THREE.Mesh();
  private hoverOwner = -1;
  private hoverAcquired = new THREE.Matrix4();
  private hoverHits: THREE.Intersection[] = [];
  private loader = new GLTFLoader(new THREE.LoadingManager().setURLModifier(garmentAssetUrl));
  private environment: THREE.WebGLRenderTarget;
  private backBuffer = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private blurBuffer = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private backgroundStamp = '';
  private textureRevision = 0;
  private postScene = new THREE.Scene();
  private postCamera = new THREE.Camera();
  private blur = new THREE.ShaderMaterial({
    uniforms: { image: { value: null }, direction: { value: new THREE.Vector2() }, opacity: { value: 1 } },
    vertexShader: blurVertex, fragmentShader: blurFragment,
    transparent: true, depthTest: false, depthWrite: false,
  });
  private postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blur);
  private expand = spring();
  private viewX = spring();
  private viewY = spring();
  private viewZoom = spring(1);
  private spin = spring();
  private spinSelected = -1;
  private spinMomentum = 0;
  private spinFollowing = false;
  private previousMode: Mode = 'rack';
  private productReveal = 1;
  private exporting = false;
  private detailAnchor = W/2;
  private meshAssets = new Map<string,Promise<{geometry:THREE.BufferGeometry;frontTexture:THREE.Texture;backTexture:THREE.Texture}>>();
  private sharedTextures = new Map<string,Promise<THREE.Texture>>();
  private ownedGeometry = new Set<THREE.BufferGeometry>();
  private ownedTextures = new Set<THREE.Texture>();
  private textureLoader = new THREE.TextureLoader();
  private raf = 0;
  private disposed = false;
  private previous = 0;
  private observer: ResizeObserver;
  private frames: number[] = [];
  private costs: number[] = [];
  private drawn = 0;
  private reported = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private resolution = 1.5;
  private pixelBudget = 1_400_000;
  private mobileProfile = false;
  private slowFrames = 0;
  private dirty = true;
  private lastStamp = '';
  private onContextLost: (e: Event) => void;
  private boundsMatrix = new THREE.Matrix4();
  private boundsBox = new THREE.Box3();

  private envelope(item: Item, yaw: number, roll=0, scale=1, padding=0): Envelope {
    const box=item.body.geometry.boundingBox!;
    // The current Euler order is also used by the render transform.
    this.boundsMatrix.makeRotationFromEuler(new THREE.Euler(0,yaw,roll));
    this.boundsBox.copy(box).applyMatrix4(this.boundsMatrix);
    return {left:this.boundsBox.min.x*scale-padding,right:this.boundsBox.max.x*scale+padding};
  }

  private rackLayout(active: number) {
    const positions=this.items.map((item,i)=>item.garment.pivot*W+
      (active<0||i===active?0:Math.sign(i-active)*this.rackSpread*Math.pow(.6,Math.abs(i-active)-1)));
    const envelopes=this.items.map((item,i)=>this.envelope(item,i===active?0:item.garment.restYaw));
    return separateRack(positions,envelopes,active,14);
  }

  private clothPadding(item: Item) {
    const box=item.body.geometry.boundingBox!;
    const radius=Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),Math.max(Math.abs(box.min.z),Math.abs(box.max.z)));
    return (Math.abs(item.cloth.bend.value)+2*Math.sin(Math.abs(item.cloth.twist.value)/2)*radius+
      1.01*Math.max(Math.abs(item.cloth.left?.value??0),Math.abs(item.cloth.right?.value??0))+1.33*Math.abs(item.cloth.hem?.value??0))*item.scale.value;
  }

  private railPadding(item:Item){
    const box=item.body.geometry.boundingBox!,t=Math.abs(item.cloth.twist.value);
    const ax=Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),az=Math.max(Math.abs(box.min.z),Math.abs(box.max.z));
    const cy=Math.abs(Math.cos(item.root.rotation.y)*Math.cos(item.root.rotation.z)),sy=Math.abs(Math.sin(item.root.rotation.y));
    const vertical=Math.abs(Math.cos(item.root.rotation.y)*Math.sin(item.root.rotation.z));
    const sleeves=Math.max(Math.abs(item.cloth.left?.value??0),Math.abs(item.cloth.right?.value??0)),hem=Math.abs(item.cloth.hem?.value??0);
    // Project local depth/vertical flex onto the rail axis. Front-facing loose
    // cuffs do not occupy their full depth as extra horizontal garment width.
    const twist=(cy*(1-Math.cos(t))+sy*Math.sin(t))*ax+(cy*Math.sin(t)+sy*(1-Math.cos(t)))*az;
    return (Math.abs(item.cloth.bend.value)+twist+sy*(sleeves+1.25*hem)+vertical*(.1*sleeves+.08*hem))*item.scale.value;
  }

  stopMomentum() { this.spinMomentum = 0; this.spinFollowing = false; }

  beginSpinDrag() {
    this.stopMomentum();
    this.spinFollowing = true;
    // Re-grabbing a coasting piece starts at its visible orientation.
    this.state().spin = this.spin.value;
    this.spin.velocity = 0;
    return this.spin.value;
  }

  releaseSpin(velocity: number) {
    this.spinFollowing = false;
    this.spinMomentum = this.state().reduced ? 0 : clamp(velocity, -12, 12);
    this.state().spin = this.spin.value;
    this.spin.velocity = this.spinMomentum;
    this.invalidate();
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private state: () => WardrobeState,
    private onFrame: (now: number) => void,
    onError: () => void,
  ) {
    this.frame=this.frame.bind(this);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.camera.position.set(0, 0, 3000);
    this.raycaster.firstHitOnly = true;
    this.camera.lookAt(0, 0, 0);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    room.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c6c0, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(-500, 900, 1200); this.scene.add(light);
    this.makeRail(); this.scene.add(this.rail);
    this.postScene.add(this.postQuad);
    this.canvas.dataset.renderer = 'three.js';
    this.observer = new ResizeObserver(() => { this.resize(); this.invalidate(); });
    this.observer.observe(canvas);
    this.onContextLost = e => { e.preventDefault(); onError(); };
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.resize();
  }

  private makeRail() {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xbfc0b8, metalness: .96,
      roughness: .18, envMapIntensity: 1.15 });
    const mounting = new THREE.MeshStandardMaterial({ color: 0xb8b9b2, metalness: .7,
      roughness: .35 });
    // Short overhangs beyond the wall brackets leave room for a moving hanger.
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 2600, 32), chrome);
    cylinder.rotation.z = Math.PI/2;
    cylinder.position.set(1447-W/2, H/2-437, -5); this.rail.add(cylinder);
    for (const x of [377, 2517]) {
      const bracket=new THREE.Group();bracket.position.x=x-W/2;this.rail.add(bracket);
      const plate = new THREE.Mesh(new RoundedBoxGeometry(49, 112, 12, 2, 7), mounting);
      plate.position.set(0, H/2-438, -38); bracket.add(plate);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 51, 32), chrome);
      collar.rotation.z = Math.PI/2;
      collar.position.set(0, H/2-437, -5); bracket.add(collar);
      for (const dy of [-41, 41]) {
        const screw = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), chrome);
        screw.scale.z = .35; screw.position.set(0, H/2-438+dy, -30); bracket.add(screw);
        const groove = new THREE.Mesh(new THREE.BoxGeometry(5.7, 1.1, .8),
          new THREE.MeshBasicMaterial({ color: 0x65655e }));
        groove.position.copy(screw.position); groove.position.z += 2.3;
        groove.rotation.z = .55; bracket.add(groove);
      }
    }
  }

  async load(garments: Garment[]) {
    const roots = await Promise.all(garments.map(g => this.loadItem(g)));
    if (this.disposed) { roots.forEach(item => this.releaseItem(item)); return; }
    this.items = roots;
    this.items.forEach(item => this.scene.add(item.root));
    this.update(0);
    // Compile and upload once behind the loading state, before interaction.
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.renderer.compileAsync(this.postScene, this.postCamera);
    this.items.forEach(item => {
      this.renderer.initTexture(item.backMap);
      item.root.traverse(o => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshBasicMaterial;
          if (m.map) this.renderer.initTexture(m.map);
        }
      });
    });
    if (!this.disposed) this.invalidate();
  }

  private loadMeshAsset(garment: Garment) {
    const existing=this.meshAssets.get(garment.mesh);if(existing)return existing;
    const pending=(async()=>{
    const gltf = await this.loader.loadAsync(garment.mesh);
    const geometries: THREE.BufferGeometry[]=[];
    let frontMap: THREE.Texture | null=null, backMap: THREE.Texture | null=null;
    const kinds: Record<string,number>={ClothFront:0,ClothBack:1,ClothSeam:2,HangerFront:3,HangerBack:4,HangerEdge:5};
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material as THREE.MeshStandardMaterial;
      if(original.name==='ClothFront')frontMap=original.map;
      if(original.name==='ClothBack')backMap=original.map;
      const geometry=object.geometry.clone();
      geometry.setAttribute('garmentSurface',new THREE.Float32BufferAttribute(
        new Float32Array(geometry.getAttribute('position').count).fill(kinds[original.name]??0),1));
      geometries.push(geometry);object.geometry.dispose();original.dispose();
    });
    if(!frontMap||!backMap)throw new Error(`Missing garment materials: ${garment.id}`);
    const frontTexture=frontMap as THREE.Texture, backTexture=backMap as THREE.Texture;
    const anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
    frontTexture.anisotropy=anisotropy;backTexture.anisotropy=anisotropy;
    const geometry=mergeGeometries(geometries,false);
    geometries.forEach(g=>g.dispose());
    if(!geometry)throw new Error(`Incompatible garment surfaces: ${garment.id}`);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    // Build once while loading. Hover only traverses this static spatial index.
    computeBoundsTree.call(geometry, { indirect: true });
      geometry.userData.sharedGarment=true;frontTexture.userData.sharedGarment=backTexture.userData.sharedGarment=true;
      if(this.disposed){geometry.dispose();frontTexture.dispose();backTexture.dispose();throw new Error('Renderer closed.');}
      this.ownedGeometry.add(geometry);this.ownedTextures.add(frontTexture);this.ownedTextures.add(backTexture);
      return {geometry,frontTexture,backTexture};
    })().catch(error=>{this.meshAssets.delete(garment.mesh);throw error;});
    this.meshAssets.set(garment.mesh,pending);return pending;
  }

  private async loadItem(garment: Garment): Promise<Item> {
    const {geometry,frontTexture,backTexture}=await this.loadMeshAsset(garment);
    const root=new THREE.Group();
    const material=garmentMaterial(frontTexture,backTexture,garment.fabricColor??'#dcd6df');
    material.transparent=true;
    const body=new THREE.Mesh(geometry,material);
    body.raycast=acceleratedRaycast;body.userData.garmentId=garment.id;root.add(body);
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,-(garment.hangerTop??60),0),new THREE.Vector3(0,-34,0),new THREE.Vector3(0,-24,0),
      new THREE.Vector3(10,-21,0),new THREE.Vector3(14,-12,0),new THREE.Vector3(10,-3,0),
      new THREE.Vector3(1,0,0),new THREE.Vector3(-9,-5,0),new THREE.Vector3(-12,-13,0),
    ]);
    const hook = new THREE.Mesh(new THREE.TubeGeometry(path, 36, 1.45, 8, false),
      new THREE.MeshStandardMaterial({ color: 0xaaa79e, roughness: .24, metalness: 1, transparent: true }));
    root.add(hook);
    const x = garment.pivot*W;
    root.position.set(x-W/2, H/2-GARMENT_Y, restingZ);
    return { garment, root, body, focus: spring(), x: spring(x), y: spring(GARMENT_Y),
      scale: spring(1), backMap:backTexture, sway: spring(), cloth:clothMotion(), inDetail:false, designVersion: 0,
      released: false, prepared: true, designTextures: new Set(), artwork: {} };
  }

  async add(garment: Garment, design?: GarmentDesign, deferDesign=false) {
    const item = await this.loadItem(garment);
    if (this.disposed) { this.releaseItem(item); return; }
    item.design=design;item.prepared=!design;item.root.visible=item.prepared;
    this.items.push(item); this.scene.add(item.root);
    if(deferDesign)return;
    try{
      if(design)await this.applyItemDesign(item,design);
      item.prepared=true;item.root.visible=true;
      await this.renderer.compileAsync(this.scene, this.camera);
    }catch(error){this.remove(garment.id);throw error;}
    this.invalidate();
  }

  async replace(id: string, garment: Garment, design: GarmentDesign) {
    const previous=this.items.find(item=>item.garment.id===id);
    if(!previous)throw new Error('This garment is no longer on the rack.');
    const next=await this.loadItem({...garment,id});
    next.design=design;next.prepared=false;next.root.visible=false;
    try{
      await this.applyItemDesign(next,design);
      if(this.disposed||!this.items.includes(previous))throw new Error('This garment is no longer on the rack.');
      // Compile the new material before swapping. The current piece remains
      // visible and editable until all replacement assets are ready.
      await this.renderer.compileAsync(next.root,this.camera,this.scene);
      const index=this.items.indexOf(previous);
      if(this.disposed||index<0)throw new Error('This garment is no longer on the rack.');
      for(const key of ['focus','x','y','scale','sway'] as const)next[key]={...previous[key]};
      next.cloth=Object.fromEntries(Object.entries(previous.cloth).map(([key,value])=>[key,{...value}])) as ClothMotion;
      next.inDetail=previous.inDetail;next.root.position.copy(previous.root.position);
      next.root.rotation.copy(previous.root.rotation);next.root.scale.copy(previous.root.scale);
      if(next.inDetail){
        // Keep the initial visible height while the new template's framing
        // settles, so tall replacements do not flash outside a phone preview.
        const oldHeight=previous.body.geometry.boundingBox!.getSize(new THREE.Vector3()).y;
        const newHeight=next.body.geometry.boundingBox!.getSize(new THREE.Vector3()).y;
        next.scale.value*=oldHeight/Math.max(1,newHeight);next.root.scale.setScalar(next.scale.value);
      }
      next.prepared=true;next.root.visible=true;
      this.items[index]=next;this.scene.remove(previous.root);this.scene.add(next.root);
      this.releaseItem(previous);
      if(this.state().mode==='product'&&this.items[this.state().selected]===next)this.productReveal=0;
      this.textureRevision++;this.backgroundStamp='';this.invalidate();
    }catch(error){this.releaseItem(next);throw error;}
  }

  async exportPng() {
    const item=this.items[this.state().selected];
    if(!item?.prepared||this.disposed||this.exporting)throw new Error('The garment is still preparing.');
    const width=1200,height=1500;
    const target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true});
    target.texture.colorSpace=THREE.SRGBColorSpace;
    const photo=new THREE.Scene();photo.environment=this.scene.environment;
    const model=item.root.clone(true);photo.add(model);
    this.scene.children.forEach(child=>{if(child instanceof THREE.Light)photo.add(child.clone());});
    const box=new THREE.Box3().setFromObject(model).expandByScalar(this.clothPadding(item)+40);
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const h=Math.max(size.y,size.x*height/width),w=h*width/height;
    const camera=new THREE.OrthographicCamera(-w/2,w/2,h/2,-h/2,.1,8000);
    camera.position.set(center.x,center.y,3000);camera.lookAt(center.x,center.y,0);camera.updateMatrixWorld();
    const r=this.renderer,previousTarget=r.getRenderTarget(),autoClear=r.autoClear;
    const materials: {material:THREE.Material;opacity:number}[]=[];
    model.traverse(object=>{if(object instanceof THREE.Mesh){const material=object.material as THREE.Material;materials.push({material,opacity:material.opacity});material.opacity=1;}});
    this.exporting=true;
    try{
      try{
        r.setRenderTarget(target);r.autoClear=true;r.render(photo,camera);
      }finally{
        r.setRenderTarget(previousTarget);r.autoClear=autoClear;
        materials.forEach(({material,opacity})=>{material.opacity=opacity;});
      }
      const pixels=await r.readRenderTargetPixelsAsync(target,0,0,width,height,new Uint8Array(width*height*4));
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d');if(!context)throw new Error('Image export is unavailable.');
      const image=context.createImageData(width,height);
      for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);
      context.putImageData(image,0,0);
      return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create the PNG.')),'image/png'));
    }finally{target.dispose();this.exporting=false;this.slowFrames=0;}
  }

  remove(id: string) {
    const item = this.items.find(i => i.garment.id === id);
    if (item) { this.scene.remove(item.root); this.releaseItem(item); }
    this.items = this.items.filter(i => i.garment.id !== id);
    this.invalidate();
  }

  setGarments(garments: Garment[],snap=false) {
    for (const item of this.items) {
      const garment=garments.find(g=>g.id===item.garment.id);
      if(garment){item.garment=garment;if(snap){item.x.value=garment.pivot*W;item.x.velocity=0;}}
    }
    let gap=Infinity;
    for(let i=1;i<this.items.length;i++)gap=Math.min(gap,(this.items[i].garment.pivot-this.items[i-1].garment.pivot)*W);
    this.rackSpread=Math.max(182,360-gap);
    if(this.rail){
      // Added pieces need a longer physical rail; the viewport can browse a
      // section of it without leaving any hangers floating past an end cap.
      const first=(this.items[0]?.garment.pivot??562/W)*W,last=(this.items.at(-1)?.garment.pivot??2306/W)*W;
      const left=this.items.length>10?Math.min(47,first-900):47;
      const right=this.items.length>10?Math.max(2847,last+900):2847;
      const cylinder=this.rail.children[0],template=this.rail.children[1];
      if(cylinder&&template){
        cylinder.scale.y=(right-left)/2600;cylinder.position.x=(left+right)/2-W/2;
        this.rail.remove(...this.rail.children.slice(1));
        const count=Math.max(2,Math.ceil((right-left-460)/2140)+1);
        for(let i=0;i<count;i++){
          const bracket=i===0?template:template.clone(true);
          bracket.position.x=left+230+(right-left-460)*i/(count-1)-W/2;this.rail.add(bracket);
        }
      }
      this.backgroundStamp='';
    }
    this.invalidate();
  }

  async applyDesign(id: string, design: GarmentDesign) {
    const item=this.items.find(i=>i.garment.id===id);
    if(!item)return;
    item.design=design;item.designFailed=false;
    if(!this.nearViewport(item)){this.evictDesign(item);return;}
    item.hydrating=true;
    const epoch=item.residencyEpoch??0;
    try{await this.applyItemDesign(item,design);if(!item.released&&(item.residencyEpoch??0)===epoch)item.prepared=true;}
    catch(error){if((item.residencyEpoch??0)===epoch){item.designFailed=true;item.prepared=true;}throw error;}
    finally{if((item.residencyEpoch??0)===epoch)item.hydrating=false;this.invalidate();}
  }

  private async applyItemDesign(item: Item, design: GarmentDesign) {
    const version=++item.designVersion,epoch=item.residencyEpoch??0;
    const uniforms=item.body.material.fabricUniforms;
    const cleanTextures=()=>{
      const keep=new Set<THREE.Texture>([item.backMap,item.body.material.map!,uniforms.fabricMap.value,uniforms.fabricBackMap.value,uniforms.printMask.value,uniforms.frontArtwork.value,uniforms.backArtwork.value]);
      for(const art of Object.values(item.artwork))if(art?.value)keep.add(art.value);
      for(const texture of item.designTextures)if(!keep.has(texture)){texture.dispose();item.designTextures.delete(texture);}
    };
    const customized=!!design.color||!!design.front||!!design.back||!design.originalPrint;
    if(!customized){
      uniforms.customized.value=0;this.textureRevision++;
      for(const side of ['front','back'] as const){uniforms[`${side}Artwork`].value=item.body.material.map!;uniforms[`${side}Enabled`].value=0;delete item.artwork[side];}
      cleanTextures();this.invalidate();return;
    }
    const source=item.garment.sourceId??item.garment.id;
    const loadTexture=async(url:string,atlas=false,mask=false)=>{
      if(atlas){
        const cached=this.sharedTextures?.get(url);if(cached)return cached;
        if(this.sharedTextures){
          const shared=(async()=>{
            const t=await this.textureLoader.loadAsync(url);t.colorSpace=mask?THREE.NoColorSpace:THREE.SRGBColorSpace;t.flipY=false;
            t.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());t.userData.sharedGarment=true;
            if(this.disposed){t.dispose();return t;}this.ownedTextures.add(t);this.renderer.initTexture(t);return t;
          })().catch(error=>{this.sharedTextures.delete(url);throw error;});
          this.sharedTextures.set(url,shared);return shared;
        }
      }
      const texture=await this.textureLoader.loadAsync(url);
      texture.colorSpace=mask?THREE.NoColorSpace:THREE.SRGBColorSpace;
      texture.flipY=!atlas;
      texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate=true;
      if(item.released||this.disposed||(item.residencyEpoch??0)!==epoch){texture.dispose();return texture;}
      item.designTextures.add(texture);
      this.renderer.initTexture(texture);
      return texture;
    };
    if(!item.fabric)item.fabric=Promise.all([
      loadTexture(garmentAssetUrl(`/models/${source}-fabric.jpg`),true),
      loadTexture(garmentAssetUrl(`/models/${source}-fabric-back.jpg`),true),
      loadTexture(garmentAssetUrl(`/models/${source}-print-mask.png`),true,true),
    ]).catch(error=>{item.fabric=undefined;throw error;});
    const upload=(side:PrintSide)=>{
      const art=design[side];if(!art)return Promise.resolve(undefined);
      const existing=item.artwork[side];
      if(existing?.url===art.dataUrl)return existing.texture;
      const record:{url:string;texture:Promise<THREE.Texture>;value?:THREE.Texture}={url:art.dataUrl,texture:Promise.resolve(item.body.material.map!)};
      record.texture=loadTexture(art.dataUrl).then(texture=>{record.value=texture;return texture;}).catch(error=>{if(item.artwork[side]===record)delete item.artwork[side];throw error;});
      item.artwork[side]=record;
      return record.texture;
    };
    const [fabric,front,back]=await Promise.all([item.fabric,upload('front'),upload('back')]);
    if(item.released||this.disposed||(item.residencyEpoch??0)!==epoch)return;
    uniforms.fabricMap.value=fabric[0];uniforms.fabricBackMap.value=fabric[1];uniforms.printMask.value=fabric[2];
    if(version!==item.designVersion){cleanTextures();return;}
    uniforms.fabricColor.value.set(design.color??item.garment.fabricColor??'#e8e3d8');
    uniforms.keepOriginal.value=design.originalPrint?1:0;
    for(const [side,texture] of [['front',front],['back',back]] as const){
      const art=design[side];
      uniforms[`${side}Enabled`].value=art&&texture?1:0;
      if(art&&texture){
        uniforms[`${side}Artwork`].value=texture;
        uniforms[`${side}Placement`].value.set(art.x,-art.y,art.width,art.width/art.aspect);
      }else{
        uniforms[`${side}Artwork`].value=item.body.material.map!;delete item.artwork[side];
      }
    }
    uniforms.customized.value=1;this.textureRevision++;cleanTextures();this.invalidate();
  }

  private nearViewport(item: Item) {
    const s=this.state();
    if((s.mode==='product'&&this.items[s.selected]===item)||this.items[s.active]===item)return true;
    const half=W/(2*this.camera.zoom)+650;
    const center=this.camera.position.x+W/2;
    return Math.abs(item.x.value-center)<half||Math.abs(item.garment.pivot*W-center)<half;
  }

  private evictDesign(item: Item) {
    if(!item.design||(!item.prepared&&!item.hydrating))return;
    item.residencyEpoch=(item.residencyEpoch??0)+1;item.designVersion++;
    item.hydrating=false;item.prepared=false;
    const uniforms=item.body.material.fabricUniforms;
    uniforms.frontArtwork.value=uniforms.backArtwork.value=item.body.material.map!;
    uniforms.frontEnabled.value=uniforms.backEnabled.value=0;
    item.artwork={};item.designTextures.forEach(t=>t.dispose());item.designTextures.clear();
    this.textureRevision++;
  }

  private syncVisibleDesigns() {
    for(const item of this.items){
      if(!item.design)continue;
      if(!this.nearViewport(item)){this.evictDesign(item);continue;}
      if(item.designFailed){item.prepared=true;continue;}
      if(item.prepared||item.hydrating)continue;
      item.hydrating=true;const epoch=item.residencyEpoch??0;
      void this.applyItemDesign(item,item.design).then(()=>{
        if(!item.released&&!this.disposed&&(item.residencyEpoch??0)===epoch)item.prepared=true;
      }).catch(()=>{if((item.residencyEpoch??0)===epoch){item.designFailed=true;item.prepared=true;}}).finally(()=>{if((item.residencyEpoch??0)===epoch)item.hydrating=false;this.invalidate();});
    }
  }

  hit(clientX: number, clientY: number, touch = false) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX-r.left)/r.width*2-1, -(clientY-r.top)/r.height*2+1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const result = this.raycaster.intersectObjects(this.items.filter(i=>i.prepared).map(i => i.body), false);
    for (const h of result) {
      if (!h.object.userData.garmentId) continue;
      const i = this.items.findIndex(item => item.garment.id === h.object.userData.garmentId);
      if (i >= 0) return i;
    }
    if (touch && this.raycaster.ray.origin.y < 420 && this.raycaster.ray.origin.y > -420) {
      const x = this.raycaster.ray.origin.x+W/2;
      let index = -1, distance = this.state().mobile?24*W/(Math.max(1,this.cssWidth)*this.camera.zoom):140;
      this.items.forEach((item, i) => {
        if (Math.abs(x-item.x.value) < distance) { index=i; distance=Math.abs(x-item.x.value); }
      });
      return index;
    }
    return -1;
  }

  /** Retain the acquired surface and final front, so turning cannot drop hover. */
  hoverHit(clientX: number, clientY: number) {
    const r=this.canvas.getBoundingClientRect(),s=this.state();
    this.pointer.set((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const proxy=this.hoverProxy;
    const intersects=(index:number,acquired=false)=>{
      const item=this.items[index];
      if(!item?.prepared||item.inDetail)return false;
      proxy.geometry=item.body.geometry;proxy.material=item.body.material;
      if(acquired)proxy.matrixWorld.copy(this.hoverAcquired);
      else if(index!==s.active)proxy.matrixWorld.copy(item.body.matrixWorld);
      else {
        proxy.position.set(item.garment.pivot*W-W/2,H/2-GARMENT_Y,restingZ);
        proxy.rotation.set(0,index===s.active?0:item.garment.restYaw,0);
        proxy.updateMatrixWorld(true);
      }
      this.hoverHits.length=0;
      acceleratedRaycast.call(proxy,this.raycaster,this.hoverHits);
      return this.hoverHits.length>0;
    };
    // Retain the surface where this hover began as well as the final front.
    // A neighbor moves back to its anchor when selected; neither that move nor
    // the turn should drop ownership beneath a stationary pointer.
    if(s.active>=0&&(intersects(s.active)||(this.hoverOwner===s.active&&intersects(s.active,true))))return s.active;
    let hit=-1,distance=Infinity;
    for(let i=0;i<this.items.length;i++){
      if(i===s.active||!intersects(i))continue;
      const nearest=Math.min(...this.hoverHits.map(h=>h.distance));
      if(nearest<distance){distance=nearest;hit=i;this.hoverAcquired.copy(proxy.matrixWorld);}
    }
    this.hoverOwner=hit;
    return hit;
  }

  invalidate = () => {
    this.dirty = true;
    if (!this.raf && !this.disposed && !document.hidden) {
      this.previous = 0; this.raf = requestAnimationFrame(this.frame);
    }
  };

  private resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.cssWidth = bounds.width; this.cssHeight = bounds.height;
    const worldHeight=W*bounds.height/Math.max(1,bounds.width);
    this.camera.top=worldHeight/2;this.camera.bottom=-worldHeight/2;
    this.camera.updateProjectionMatrix();
    const mobile=this.state().mobile;
    if(mobile!==this.mobileProfile){this.mobileProfile=mobile;this.resolution=mobile?2:1.5;this.pixelBudget=mobile?750_000:1_400_000;}
    const dpr = Math.min(devicePixelRatio || 1, this.resolution);
    const pixels = bounds.width*bounds.height*dpr*dpr;
    const cap = Math.min(1, Math.sqrt(this.pixelBudget/Math.max(1, pixels)));
    const width = Math.max(1, Math.round(bounds.width*dpr*cap));
    const height = Math.max(1, Math.round(bounds.height*dpr*cap));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.renderer.setSize(width, height, false);
    }
  }

  private update(dt: number) {
    const s = this.state();
    const modal = s.mode === 'product' ? 1 : 0;
    if (s.reduced) { this.expand.value = modal; this.expand.velocity = 0; }
    else stepSpring(this.expand, modal, dt, 110, 22);
    const p = clamp(this.expand.value);
    if(s.mobile!==this.mobileProfile)this.resize();
    const active = s.mode === 'product' ? s.selected : s.active;
    const replaceProduct = this.spinSelected !== s.selected && this.previousMode === 'product' && modal === 1;
    if(modal&&this.previousMode!=='product')this.detailAnchor=this.items.length>10?this.items[s.selected].garment.pivot*W:W/2;
    this.previousMode = s.mode;
    // Reference frames 606–620, 643–657, 677–691 and 732–746 reveal the
    // next piece in place. Sliding it across the rail changes the whole rhythm.
    if (s.reduced || !modal) this.productReveal=1;
    else if (replaceProduct) this.productReveal=0;
    else this.productReveal=Math.min(1,this.productReveal+dt/.22);
    let moving = Math.abs(this.expand.value-modal) > .0001 || Math.abs(this.expand.velocity) > .001;
    if(this.productReveal<1)moving=true;
    if (s.mode !== 'product' || s.reduced) this.stopMomentum();
    if(this.spinSelected!==s.selected){this.spinSelected=s.selected;this.spin.value=s.spin;this.spin.velocity=0;this.stopMomentum();}
    const coasting = !s.dragging && Math.abs(this.spinMomentum) > .015;
    if (coasting) {
      const glide = stepGlide(this.spinMomentum, dt);
      s.spin += glide.distance; this.spinMomentum = glide.velocity;
      this.spin.value=s.spin;this.spin.velocity=glide.velocity;moving = true;
    } else this.spinMomentum = 0;
    const spinTarget=s.mode==='product'?s.spin:0;
    if(s.reduced){this.spin.value=spinTarget;this.spin.velocity=0;}
    else if(s.dragging&&this.spinFollowing){
      // Direct manipulation stays attached to the hand. Only free release and
      // button-driven rotation ease; filtering the pointer adds visible lag.
      this.spin.velocity=dt>0?(spinTarget-this.spin.value)/dt:0;
      this.spin.value=spinTarget;
    }
    else if(!coasting)stepSpring(this.spin,spinTarget,dt,125,21);
    if(!s.dragging&&Math.abs(this.spinMomentum)<.015&&Math.abs(this.spin.value-spinTarget)<.0001&&Math.abs(this.spin.velocity)<.001)this.spinFollowing=false;
    if(Math.abs(this.spin.value-spinTarget)>.0001||Math.abs(this.spin.velocity)>.001)moving=true;
    const otherOpen=this.items.reduce((sum,item,i)=>sum+(i===active?0:clamp(item.focus.value)),0);
    this.items.forEach((item, i) => {
      // Make space as the outgoing piece folds back. Fast browsing must not
      // accumulate a row of front-facing garments that pushes off the rail.
      const target = i === active ? (modal||s.reduced?1:clamp(1.15-otherOpen)) : 0;
      if (s.reduced) { item.focus.value = target; item.focus.velocity = 0; }
      else {
        const stiffness = i===active?(item.garment.turnStiffness??85):95;
        const damping=i===active?Math.min(item.garment.turnDamping??18,1.7*Math.sqrt(stiffness)):19.5;
        stepSpring(item.focus,target,dt,stiffness,damping);
      }
    });
    const rackTargets=this.rackLayout(active);
    this.items.forEach((item, i) => {
      const g = item.garment;
      let x = rackTargets[i];
      if(modal&&i!==s.selected&&item.inDetail){
        // The outgoing detail becomes part of the dimmed background in place.
        // It must not fly across, or share the new detail's depth lane.
        item.x.value=x;item.x.velocity=0;item.y.value=GARMENT_Y;item.y.velocity=0;
        item.scale.value=1;item.scale.velocity=0;item.focus.value=0;item.focus.velocity=0;
        item.sway.value=0;item.sway.velocity=0;item.cloth=clothMotion();item.inDetail=false;
      }
      const selected = i === s.selected;
      const detail = selected ? modal : 0;
      x += ((this.detailAnchor??W/2)+(g.detailX||0)-x)*detail;
      if(!modal&&item.inDetail&&Math.abs(item.x.value-x)>W*2){item.x.value=x;item.x.velocity=0;}
      const y = GARMENT_Y+((g.detailY??276)-GARMENT_Y)*detail;
      const scale = 1+((g.detailScale??1.36)-1)*detail;
      for (const [sp, value] of [[item.x,x],[item.y,y],[item.scale,scale]] as [Spring,number][]) {
        if (s.reduced || dt === 0 || (replaceProduct && selected)) { sp.value=value; sp.velocity=0; }
        else {const mass=sp===item.x?garmentMass(g.type):1;stepSpring(sp,value,dt,145/mass,21/Math.sqrt(mass));}
        if (Math.abs(sp.value-value) > .0001 || Math.abs(sp.velocity) > .001) moving=true;
      }
      // Preserve the spring's small overshoot at both ends of the turn.
      if(replaceProduct&&selected){item.focus.value=1;item.focus.velocity=0;item.sway.value=0;item.sway.velocity=0;item.cloth=clothMotion();}
      const f = item.focus.value;
      item.root.rotation.y = g.restYaw*(1-f)+(selected ? this.spin.value*p : 0);
      const turnVelocity = -g.restYaw * item.focus.velocity + (selected ? this.spin.velocity * p : 0);
      // Inertia is driven by actual turn/rail velocity, including neighbors.
      const swayTarget=s.reduced?0:clamp(-turnVelocity*.004-item.x.velocity*.000012,-.022,.022);
      if(s.reduced){item.sway.value=0;item.sway.velocity=0;}
      else stepSpring(item.sway,swayTarget,dt,95,15);
      item.root.rotation.z=item.sway.value;
      if(Math.abs(item.sway.value-swayTarget)>.0001||Math.abs(item.sway.velocity)>.001)moving=true;
      if(stepCloth(item.cloth,turnVelocity,item.x.velocity,dt,g.type,s.reduced))moving=true;
      const uniforms=item.body.material.fabricUniforms;
      if(uniforms){
        uniforms.clothBend.value.set(Math.cos(item.root.rotation.y)*item.cloth.bend.value,Math.sin(item.root.rotation.y)*item.cloth.bend.value);
        uniforms.clothTwist.value=item.cloth.twist.value;
        uniforms.clothSleeves.value.set(item.cloth.left?.value??0,item.cloth.right?.value??0);
        uniforms.clothHem.value=item.cloth.hem?.value??0;
      }
      // Orthographic detail view uses a separate depth lane for its whole
      // entrance and return, instead of travelling through the hanging rack.
      if(selected&&(modal||p>.003))item.inDetail=true;
      else if(Math.abs(item.x.value-rackTargets[i])<4&&Math.abs(item.scale.value-1)<.01)item.inDetail=false;
      item.root.position.set(item.x.value-W/2,H/2-item.y.value,item.inDetail?1200:restingZ);
      item.root.scale.setScalar(item.scale.value);
      if (Math.abs(item.focus.value-(i===active?1:0)) > .0001 || Math.abs(item.focus.velocity) > .001) moving=true;
    });
    // Targets make room in advance. This final projection handles interrupted
    // turns and overshoot using the geometry's current occupied envelope.
    const onRail=this.items.filter(item=>item.root.position.z===restingZ);
    const bodies=solveRailContacts(onRail.map(item=>({position:item.x.value,velocity:item.x.velocity,mass:garmentMass(item.garment.type),envelope:this.envelope(item,item.root.rotation.y,item.root.rotation.z,item.scale.value,this.railPadding(item))})));
    onRail.forEach((item,i)=>{item.x.value=bodies[i].position;item.x.velocity=bodies[i].velocity;item.root.position.x=item.x.value-W/2;});
    const view=!s.demo?(s.mobile?mobileRackView(this.items.map(item=>item.garment.pivot),s.rackPosition,this.cssWidth,this.cssHeight):this.items.length>10?desktopRackView(this.items.map(item=>item.garment.pivot),s.rackPosition):{x:0,y:0,zoom:1}):{x:0,y:0,zoom:1};
    const selectedItem=this.items[s.selected];
    const height=-(selectedItem?.body.geometry.boundingBox?.min.y??-756);
    const detail=(s.mobile||s.studio)&&!s.demo&&selectedItem?mobileProductView(selectedItem.garment,this.cssWidth,this.cssHeight,height):{x:0,y:0,zoom:s.mobile?1.4:1};
    const targets:[[Spring,number],[Spring,number],[Spring,number]]=[[this.viewX,view.x+((this.detailAnchor??W/2)-W/2-view.x)*modal],[this.viewY,view.y+(detail.y-view.y)*modal],[this.viewZoom,view.zoom+(detail.zoom-view.zoom)*modal]];
    for(const [sp,target] of targets){
      if(sp===this.viewX&&Math.abs(sp.value-target)>W*2/this.viewZoom.value){sp.value=target;sp.velocity=0;}
      if(s.reduced||dt===0){sp.value=target;sp.velocity=0;}
      else stepSpring(sp,target,dt,s.dragging?650:180,s.dragging?50:27);
      if(Math.abs(sp.value-target)>.0001||Math.abs(sp.velocity)>.001)moving=true;
    }
    if(this.camera.zoom!==this.viewZoom.value){this.camera.zoom=this.viewZoom.value;this.camera.updateProjectionMatrix();}
    this.camera.position.x=this.viewX.value;this.camera.position.y=this.viewY.value;
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    this.syncVisibleDesigns();
    return moving;
  }

  private draw() {
    const p = clamp(this.expand.value), s = this.state();
    const r = this.renderer;
    this.items.forEach(item=>{item.root.visible=item.prepared;});
    this.items.forEach((item,i)=>{
      const opacity=i===s.selected&&s.mode==='product'?1-Math.pow(1-this.productReveal,3):1;
      item.root.traverse(object=>{if(object instanceof THREE.Mesh)(object.material as THREE.Material).opacity=opacity;});
    });
    r.info.reset();
    r.setRenderTarget(null); r.autoClear=true;
    if (p < .003 || !this.items[s.selected]) { this.backgroundStamp='';r.render(this.scene, this.camera); return; }
    // Blur only the small background framebuffer. The selected mesh stays crisp.
    const width=Math.ceil(this.canvas.width/2),height=Math.ceil(this.canvas.height/2);
    if(this.backBuffer.width!==width||this.backBuffer.height!==height){this.backBuffer.setSize(width,height);this.blurBuffer.setSize(width,height);this.backgroundStamp='';}
    // A settled rack is static while the selected piece rotates. Reuse its
    // background instead of rendering all ten garments on every drag frame.
    const stamp=[s.selected,p,this.textureRevision,width,height,
      this.camera.zoom,this.camera.position.x,this.camera.position.y,this.camera.top,this.camera.bottom,
      ...this.items.flatMap((item,i)=>i===s.selected?[]:[Number(item.prepared),item.root.position.x,item.root.position.y,item.root.position.z,
        item.root.scale.x,item.root.rotation.y,item.root.rotation.z,item.cloth.bend.value,item.cloth.twist.value,item.cloth.left?.value??0,item.cloth.right?.value??0,item.cloth.hem?.value??0])]
      .map(value=>Math.round(value*10_000)/10_000).join(':');
    if(stamp!==this.backgroundStamp){
      this.items[s.selected].root.visible=false;
      r.setRenderTarget(this.backBuffer); r.render(this.scene,this.camera);
      this.blur.uniforms.image.value=this.backBuffer.texture;
      this.blur.uniforms.direction.value.set(p*13/W,0);
      this.blur.uniforms.opacity.value=1;
      r.setRenderTarget(this.blurBuffer); r.render(this.postScene,this.postCamera);
      this.backgroundStamp=stamp;
    }
    this.blur.uniforms.image.value=this.blurBuffer.texture;
    this.blur.uniforms.direction.value.set(0,p*13/H);
    this.blur.uniforms.opacity.value=1-.94*p;
    r.setRenderTarget(null); r.render(this.postScene,this.postCamera);
    this.items.forEach((item,i)=>{item.root.visible=item.prepared&&i===s.selected;}); this.rail.visible=false;
    r.autoClear=false; r.clearDepth(); r.render(this.scene,this.camera); r.autoClear=true;
    this.items.forEach(item=>{item.root.visible=item.prepared;}); this.rail.visible=true;
  }

  private frame(now: number) {
    this.raf=0;
    if (this.disposed || document.hidden) return;
    const delta=this.previous ? now-this.previous : 16.667;
    const continuous=!!this.previous;
    this.previous=now;
    this.onFrame(now);
    // Springs and momentum are analytic. Dropping elapsed time on a slow frame
    // stretched turns and made the physical response depend on GPU speed.
    const moving=this.update(delta/1000);
    const state=this.state();
    const stamp=[state.mode,state.active,state.selected,state.spin,state.rackPosition,state.mobile,this.items.length,this.canvas.width,this.canvas.height].join(':');
    if(moving||this.dirty||stamp!==this.lastStamp){
      const start=performance.now(); this.draw(); const cost=performance.now()-start;
      this.drawn++;
      if(continuous){this.frames.push(delta);this.costs.push(cost);}
      if(!this.exporting){
        this.slowFrames=continuous&&delta>24?this.slowFrames+1:Math.max(0,this.slowFrames-2);
        const minimumBudget=Math.min(450_000,Math.round(this.cssWidth*this.cssHeight*.49));
        if(this.slowFrames>=18&&this.pixelBudget>minimumBudget){
          this.pixelBudget=Math.max(minimumBudget,Math.round(Math.min(this.pixelBudget,this.canvas.width*this.canvas.height)*.72));
          this.slowFrames=0;this.resize();
        }
      }
      this.dirty=false;this.lastStamp=stamp;
    }
    if (this.frames.length > 600) { this.frames.shift(); this.costs.shift(); }
    if (now-this.reported > 500) { this.reported=now; this.report(); }
    if (moving || this.state().demo) this.raf=requestAnimationFrame(this.frame);
    else { this.previous=0; this.report(); }
  }

  private report() {
    const percentile=(values:number[],p:number)=>{
      const sorted=[...values].sort((a,b)=>a-b);
      return Math.round((sorted[Math.floor((sorted.length-1)*p)]||0)*100)/100;
    };
    this.canvas.dataset.performance=JSON.stringify({ samples:this.frames.length, frames:this.drawn,
      frameMsP50:percentile(this.frames,.5),frameMsP95:percentile(this.frames,.95),
      renderMsP95:percentile(this.costs,.95),framesOver33ms:this.frames.filter(t=>t>33.4).length,
      drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,
      textures:this.renderer.info.memory.textures,buffer:[this.canvas.width,this.canvas.height],
      display:[Math.round(this.cssWidth),Math.round(this.cssHeight)],
      residentDesigns:this.items.filter(item=>item.design&&item.prepared).length,
      pendingDesigns:this.items.filter(item=>item.design&&item.hydrating).length,
      sharedMeshes:this.meshAssets?.size??0,
      cameraX:Math.round(this.camera.position.x),
      failedDesigns:this.items.filter(item=>item.designFailed).length,
      garmentMeshes:this.items.length,mode:this.state().mode,mobile:this.mobileProfile,cameraZoom:Math.round(this.camera.zoom*100)/100,
      garmentId:this.items[this.state().selected]?.garment.id,garmentType:this.items[this.state().selected]?.garment.type,
      frontArtwork:!!this.items[this.state().selected]?.body.material.fabricUniforms.frontEnabled.value,
      backArtwork:!!this.items[this.state().selected]?.body.material.fabricUniforms.backEnabled.value,
      fabricColor:this.items[this.state().selected]?.body.material.fabricUniforms.fabricColor.value.getHexString(),
      frontPrint:this.items[this.state().selected]?.body.material.fabricUniforms.frontPlacement.value.toArray(),
      backPrint:this.items[this.state().selected]?.body.material.fabricUniforms.backPlacement.value.toArray(),
      rotationRad:Math.round(this.spin.value*10000)/10000,coasting:Math.abs(this.spinMomentum)>.015 });
  }

  private releaseItem(item: Item) {
    item.released=true;item.designVersion++;
    item.designTextures.forEach(texture=>texture.dispose());item.designTextures.clear();
    const disposedTextures = new Set<THREE.Texture>();
    item.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      if(!o.geometry.userData.sharedGarment){if(o.geometry.boundsTree)disposeBoundsTree.call(o.geometry);o.geometry.dispose();}
      const mat=o.material as THREE.MeshBasicMaterial;
      if (mat.map && !mat.map.userData.sharedGarment && !disposedTextures.has(mat.map)) { mat.map.dispose(); disposedTextures.add(mat.map); }
      mat.dispose();
    });
    if(!item.backMap.userData.sharedGarment)item.backMap.dispose();
  }

  dispose() {
    this.disposed=true; cancelAnimationFrame(this.raf); this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    this.items.forEach(item=>this.releaseItem(item));
    this.ownedGeometry.forEach(g=>{if(g.boundsTree)disposeBoundsTree.call(g);g.dispose();});this.ownedTextures.forEach(t=>t.dispose());
    const railMaterials=new Set<THREE.Material>();
    this.rail.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();railMaterials.add(o.material);}});
    railMaterials.forEach(m=>m.dispose());
    this.environment.dispose(); this.backBuffer.dispose(); this.blurBuffer.dispose();
    this.postQuad.geometry.dispose(); this.blur.dispose(); this.renderer.dispose();
  }
}

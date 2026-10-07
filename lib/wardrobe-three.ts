import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { garmentMaterial, type FabricMaterial } from './garment-material';
import type { GarmentDesign, PrintSide } from './garment-design';
import { garmentAssetUrl } from './garment-assets';
import { clamp, spring, stepSpring, type Spring } from './motion';
import { mobileRackView, mobileProductView } from './rack-view';

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

/** One WebGL renderer, immutable GLB geometry, and demand-driven rigid transforms. */
export class WardrobeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-W/2, W/2, H/2, -H/2, .1, 8000);
  private rail = new THREE.Group();
  private items: Item[] = [];
  private rackSpread = 182;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private loader = new GLTFLoader(new THREE.LoadingManager().setURLModifier(garmentAssetUrl));
  private environment: THREE.WebGLRenderTarget;
  private backBuffer = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private blurBuffer = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
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

  constructor(
    private canvas: HTMLCanvasElement,
    private state: () => WardrobeState,
    private onFrame: (now: number) => void,
    onError: () => void,
  ) {
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
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 2140, 32), chrome);
    cylinder.rotation.z = Math.PI/2;
    cylinder.position.set(1447-W/2, H/2-437, -5); this.rail.add(cylinder);
    for (const x of [377, 2517]) {
      const plate = new THREE.Mesh(new RoundedBoxGeometry(49, 112, 12, 2, 7), mounting);
      plate.position.set(x-W/2, H/2-438, -38); this.rail.add(plate);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 51, 32), chrome);
      collar.rotation.z = Math.PI/2;
      collar.position.set(x-W/2, H/2-437, -5); this.rail.add(collar);
      for (const dy of [-41, 41]) {
        const screw = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), chrome);
        screw.scale.z = .35; screw.position.set(x-W/2, H/2-438+dy, -30); this.rail.add(screw);
        const groove = new THREE.Mesh(new THREE.BoxGeometry(5.7, 1.1, .8),
          new THREE.MeshBasicMaterial({ color: 0x65655e }));
        groove.position.copy(screw.position); groove.position.z += 2.3;
        groove.rotation.z = .55; this.rail.add(groove);
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

  private async loadItem(garment: Garment): Promise<Item> {
    const gltf = await this.loader.loadAsync(garment.mesh);
    const root = new THREE.Group();
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
    const material=garmentMaterial(frontTexture,backTexture,garment.fabricColor??'#dcd6df');
    const body=new THREE.Mesh(geometry,material);
    body.raycast=acceleratedRaycast;body.userData.garmentId=garment.id;root.add(body);
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,-(garment.hangerTop??60),0),new THREE.Vector3(0,-34,0),new THREE.Vector3(0,-24,0),
      new THREE.Vector3(10,-21,0),new THREE.Vector3(14,-12,0),new THREE.Vector3(10,-3,0),
      new THREE.Vector3(1,0,0),new THREE.Vector3(-9,-5,0),new THREE.Vector3(-12,-13,0),
    ]);
    const hook = new THREE.Mesh(new THREE.TubeGeometry(path, 36, 1.45, 8, false),
      new THREE.MeshStandardMaterial({ color: 0xaaa79e, roughness: .24, metalness: 1 }));
    root.add(hook);
    const x = garment.pivot*W;
    root.position.set(x-W/2, H/2-GARMENT_Y, restingZ);
    return { garment, root, body, focus: spring(), x: spring(x), y: spring(GARMENT_Y),
      scale: spring(1), backMap:backTexture, sway: spring(), designVersion: 0,
      released: false, prepared: true, designTextures: new Set(), artwork: {} };
  }

  async add(garment: Garment, design?: GarmentDesign) {
    const item = await this.loadItem(garment);
    if (this.disposed) { this.releaseItem(item); return; }
    item.prepared=!design;item.root.visible=item.prepared;
    this.items.push(item); this.scene.add(item.root);
    try{
      if(design)await this.applyDesign(garment.id,design);
      item.prepared=true;item.root.visible=true;
      await this.renderer.compileAsync(this.scene, this.camera);
    }catch(error){this.remove(garment.id);throw error;}
    this.invalidate();
  }

  remove(id: string) {
    const item = this.items.find(i => i.garment.id === id);
    if (item) { this.scene.remove(item.root); this.releaseItem(item); }
    this.items = this.items.filter(i => i.garment.id !== id);
    this.invalidate();
  }

  setGarments(garments: Garment[]) {
    for (const item of this.items) {
      const garment=garments.find(g=>g.id===item.garment.id);
      if(garment)item.garment=garment;
    }
    let gap=Infinity;
    for(let i=1;i<this.items.length;i++)gap=Math.min(gap,(this.items[i].garment.pivot-this.items[i-1].garment.pivot)*W);
    this.rackSpread=Math.max(182,360-gap);
    this.invalidate();
  }

  async applyDesign(id: string, design: GarmentDesign) {
    const item=this.items.find(i=>i.garment.id===id);
    if(!item)return;
    const version=++item.designVersion;
    const uniforms=item.body.material.fabricUniforms;
    const cleanTextures=()=>{
      const keep=new Set<THREE.Texture>([item.backMap,item.body.material.map!,uniforms.fabricMap.value,uniforms.fabricBackMap.value,uniforms.printMask.value,uniforms.frontArtwork.value,uniforms.backArtwork.value]);
      for(const art of Object.values(item.artwork))if(art?.value)keep.add(art.value);
      for(const texture of item.designTextures)if(!keep.has(texture)){texture.dispose();item.designTextures.delete(texture);}
    };
    const customized=!!design.color||!!design.front||!!design.back||!design.originalPrint;
    if(!customized){
      uniforms.customized.value=0;
      for(const side of ['front','back'] as const){uniforms[`${side}Artwork`].value=item.body.material.map!;uniforms[`${side}Enabled`].value=0;delete item.artwork[side];}
      cleanTextures();this.invalidate();return;
    }
    const source=item.garment.sourceId??item.garment.id;
    const loadTexture=async(url:string,atlas=false,mask=false)=>{
      const texture=await this.textureLoader.loadAsync(url);
      texture.colorSpace=mask?THREE.NoColorSpace:THREE.SRGBColorSpace;
      texture.flipY=!atlas;
      texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate=true;
      if(item.released||this.disposed){texture.dispose();return texture;}
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
    if(item.released||this.disposed)return;
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
    uniforms.customized.value=1;cleanTextures();this.invalidate();
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
    if (s.reduced) this.expand.value = modal;
    else stepSpring(this.expand, modal, dt, 110, 22);
    const p = clamp(this.expand.value);
    if(s.mobile!==this.mobileProfile)this.resize();
    const active = s.mode === 'product' ? s.selected : s.active;
    let moving = Math.abs(this.expand.value-modal) > .0001 || Math.abs(this.expand.velocity) > .001;
    const spinTarget=s.mode==='product'?s.spin:0;
    if(this.spinSelected!==s.selected){this.spinSelected=s.selected;this.spin.value=spinTarget;this.spin.velocity=0;}
    if(s.reduced){this.spin.value=spinTarget;this.spin.velocity=0;}
    else stepSpring(this.spin,spinTarget,dt,s.dragging?420:125,s.dragging?38:21);
    if(Math.abs(this.spin.value-spinTarget)>.0001||Math.abs(this.spin.velocity)>.001)moving=true;
    this.items.forEach((item, i) => {
      const target = i === active ? 1 : 0;
      if (s.reduced) item.focus.value = target;
      else stepSpring(item.focus, target, dt, item.garment.turnStiffness??85, item.garment.turnDamping??18);
    });
    this.items.forEach((item, i) => {
      const g = item.garment;
      let x = g.pivot*W;
      this.items.forEach((other, j) => {
        if (i !== j) x += Math.sign(i-j)*this.rackSpread*Math.pow(.6, Math.abs(i-j)-1)*clamp(other.focus.value);
      });
      const selected = i === s.selected;
      const detail = selected ? p : 0;
      x += (W/2+(g.detailX||0)-x)*detail;
      const y = GARMENT_Y+((g.detailY??276)-GARMENT_Y)*detail;
      const scale = 1+((g.detailScale??1.36)-1)*detail;
      for (const [sp, value] of [[item.x,x],[item.y,y],[item.scale,scale]] as [Spring,number][]) {
        if (s.reduced || dt === 0) { sp.value=value; sp.velocity=0; }
        else stepSpring(sp,value,dt,180,27);
        if (Math.abs(sp.value-value) > .0001 || Math.abs(sp.velocity) > .001) moving=true;
      }
      const f = clamp(item.focus.value);
      item.root.rotation.y = g.restYaw*(1-f)+(selected ? this.spin.value*p : 0);
      const swayTarget=s.reduced?0:clamp(item.focus.velocity,-1.5,1.5)*-.014*(1-p)+(selected?clamp(this.spin.velocity,-3,3)*-.003*p:0);
      if(s.reduced){item.sway.value=0;item.sway.velocity=0;}
      else stepSpring(item.sway,swayTarget,dt,85,13);
      item.root.rotation.z=item.sway.value;
      if(Math.abs(item.sway.value-swayTarget)>.0001||Math.abs(item.sway.velocity)>.001)moving=true;
      item.root.position.set(item.x.value-W/2,H/2-item.y.value,selected ? p*120 : restingZ);
      item.root.scale.setScalar(item.scale.value);
      if (Math.abs(item.focus.value-(i===active?1:0)) > .0001 || Math.abs(item.focus.velocity) > .001) moving=true;
    });
    const view=s.mobile&&!s.demo?mobileRackView(this.items.map(item=>item.garment.pivot),s.rackPosition,this.cssWidth,this.cssHeight):{x:0,y:0,zoom:1};
    const selectedItem=this.items[s.selected];
    const height=-(selectedItem?.body.geometry.boundingBox?.min.y??-756);
    const detail=(s.mobile||s.studio)&&!s.demo&&selectedItem?mobileProductView(selectedItem.garment,this.cssWidth,this.cssHeight,height):{x:0,y:0,zoom:s.mobile?1.4:1};
    const targets:[[Spring,number],[Spring,number],[Spring,number]]=[[this.viewX,view.x*(1-p)],[this.viewY,view.y+(detail.y-view.y)*p],[this.viewZoom,view.zoom+(detail.zoom-view.zoom)*p]];
    for(const [sp,target] of targets){
      if(s.reduced||dt===0){sp.value=target;sp.velocity=0;}
      else stepSpring(sp,target,dt,180,27);
      if(Math.abs(sp.value-target)>.0001||Math.abs(sp.velocity)>.001)moving=true;
    }
    if(this.camera.zoom!==this.viewZoom.value){this.camera.zoom=this.viewZoom.value;this.camera.updateProjectionMatrix();}
    this.camera.position.x=this.viewX.value;this.camera.position.y=this.viewY.value;
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    return moving;
  }

  private draw() {
    const p = clamp(this.expand.value), s = this.state();
    const r = this.renderer;
    this.items.forEach(item=>{item.root.visible=item.prepared;});
    r.info.reset();
    r.setRenderTarget(null); r.autoClear=true;
    if (p < .003 || !this.items[s.selected]) { r.render(this.scene, this.camera); return; }
    // Blur only the small background framebuffer. The selected mesh stays crisp.
    const width=Math.ceil(this.canvas.width/2),height=Math.ceil(this.canvas.height/2);
    if(this.backBuffer.width!==width||this.backBuffer.height!==height){this.backBuffer.setSize(width,height);this.blurBuffer.setSize(width,height);}
    this.items[s.selected].root.visible=false;
    r.setRenderTarget(this.backBuffer); r.render(this.scene,this.camera);
    this.blur.uniforms.image.value=this.backBuffer.texture;
    this.blur.uniforms.direction.value.set(p*13/W,0);
    this.blur.uniforms.opacity.value=1;
    r.setRenderTarget(this.blurBuffer); r.render(this.postScene,this.postCamera);
    this.blur.uniforms.image.value=this.blurBuffer.texture;
    this.blur.uniforms.direction.value.set(0,p*13/H);
    this.blur.uniforms.opacity.value=1-.94*p;
    r.setRenderTarget(null); r.render(this.postScene,this.postCamera);
    this.items.forEach((item,i)=>{item.root.visible=item.prepared&&i===s.selected;}); this.rail.visible=false;
    r.autoClear=false; r.clearDepth(); r.render(this.scene,this.camera); r.autoClear=true;
    this.items.forEach(item=>{item.root.visible=item.prepared;}); this.rail.visible=true;
  }

  private frame = (now: number) => {
    this.raf=0;
    if (this.disposed || document.hidden) return;
    const delta=this.previous ? now-this.previous : 16.667;
    const continuous=!!this.previous;
    this.previous=now;
    this.onFrame(now);
    const moving=this.update(Math.min(delta/1000,.05));
    const state=this.state();
    const stamp=[state.mode,state.active,state.selected,state.spin,state.rackPosition,state.mobile,this.items.length,this.canvas.width,this.canvas.height].join(':');
    if(moving||this.dirty||stamp!==this.lastStamp){
      const start=performance.now(); this.draw(); const cost=performance.now()-start;
      this.drawn++;
      if(continuous){this.frames.push(delta);this.costs.push(cost);}
      this.slowFrames=continuous&&delta>24?this.slowFrames+1:Math.max(0,this.slowFrames-2);
      if(this.slowFrames>=18&&this.pixelBudget>450_000){
        this.resolution=Math.max(1,this.resolution-.25);
        this.pixelBudget=Math.max(450_000,Math.round(this.pixelBudget*.72));
        this.slowFrames=0;this.resize();
      }
      this.dirty=false;this.lastStamp=stamp;
    }
    if (this.frames.length > 600) { this.frames.shift(); this.costs.shift(); }
    if (now-this.reported > 500) { this.reported=now; this.report(); }
    if (moving || this.state().demo) this.raf=requestAnimationFrame(this.frame);
    else { this.previous=0; this.report(); }
  };

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
      garmentMeshes:this.items.length,mode:this.state().mode,mobile:this.mobileProfile,cameraZoom:Math.round(this.camera.zoom*100)/100 });
  }

  private releaseItem(item: Item) {
    item.released=true;item.designVersion++;
    item.designTextures.forEach(texture=>texture.dispose());item.designTextures.clear();
    const disposedTextures = new Set<THREE.Texture>();
    item.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.geometry.boundsTree) disposeBoundsTree.call(o.geometry);
      o.geometry.dispose();
      const mat=o.material as THREE.MeshBasicMaterial;
      if (mat.map && !disposedTextures.has(mat.map)) { mat.map.dispose(); disposedTextures.add(mat.map); }
      mat.dispose();
    });
    item.backMap.dispose();
  }

  dispose() {
    this.disposed=true; cancelAnimationFrame(this.raf); this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    this.items.forEach(item=>this.releaseItem(item));
    const railMaterials=new Set<THREE.Material>();
    this.rail.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();railMaterials.add(o.material);}});
    railMaterials.forEach(m=>m.dispose());
    this.environment.dispose(); this.backBuffer.dispose(); this.blurBuffer.dispose();
    this.postQuad.geometry.dispose(); this.blur.dispose(); this.renderer.dispose();
  }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, spring, stepSpring, type Spring } from './motion';

export type Garment = {
  id: string; name: string; type: string; pivot: number; mesh: string;
  sideTexture: string; restYaw: number; reference: boolean;
  detailScale?: number; detailY?: number; detailX?: number;
};
export type Mode = 'rack' | 'product' | 'about' | 'contact';
export type WardrobeState = {
  active: number; selected: number; mode: Mode; demo: boolean; demoStart: number;
  reduced: boolean; spin: number;
};
type Item = {
  garment: Garment; root: THREE.Group; focus: Spring;
  x: Spring; y: Spring; scale: Spring;
  sideBlend: THREE.IUniform<number>; sideMap: THREE.Texture;
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
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private loader = new GLTFLoader();
  private textures = new THREE.TextureLoader();
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
      this.renderer.initTexture(item.sideMap);
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
    const [gltf, sideMap] = await Promise.all([
      this.loader.loadAsync(garment.mesh), this.textures.loadAsync(garment.sideTexture),
    ]);
    sideMap.colorSpace = THREE.SRGBColorSpace; sideMap.flipY = false;
    sideMap.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const sideBlend = { value: 1 };
    const root = new THREE.Group(); root.add(gltf.scene);
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material as THREE.MeshStandardMaterial;
      const material = new THREE.MeshBasicMaterial({ map: original.map });
      if (material.map) material.map.anisotropy = sideMap.anisotropy;
      // Capture lighting is already in the albedo. Applying another strong light
      // would wash out the print. The rail/hook use physical reflective materials.
      if (original.name.startsWith('Cloth') && original.name !== 'ClothBack') {
        material.onBeforeCompile = shader => {
          shader.uniforms.sideMap = { value: sideMap };
          shader.uniforms.sideBlend = sideBlend;
          shader.uniforms.restProjection = { value: new THREE.Vector2(Math.cos(garment.restYaw), Math.sin(garment.restYaw)) };
          shader.vertexShader = `uniform vec2 restProjection; varying vec2 vSideUv;\n${shader.vertexShader}`
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              vSideUv=vec2((position.x*restProjection.x+position.z*restProjection.y+320.)/640.,-position.y/810.);`);
          shader.fragmentShader = `uniform sampler2D sideMap; uniform float sideBlend; varying vec2 vSideUv;\n${shader.fragmentShader}`
            .replace('#include <map_fragment>', `#ifdef USE_MAP
              vec4 face=texture2D(map,vMapUv);
              vec4 edge=texture2D(sideMap,vSideUv);
              diffuseColor*=mix(face,edge,sideBlend);
              #endif`);
        };
        material.customProgramCacheKey = () => 'wardrobe-photogrammetry-v1';
      }
      material.name = original.name;
      object.material = material; original.dispose();
      object.userData.garmentId = garment.id;
    });
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,-60,0),new THREE.Vector3(0,-34,0),new THREE.Vector3(0,-24,0),
      new THREE.Vector3(10,-21,0),new THREE.Vector3(14,-12,0),new THREE.Vector3(10,-3,0),
      new THREE.Vector3(1,0,0),new THREE.Vector3(-9,-5,0),new THREE.Vector3(-12,-13,0),
    ]);
    const hook = new THREE.Mesh(new THREE.TubeGeometry(path, 36, 1.45, 8, false),
      new THREE.MeshStandardMaterial({ color: 0xaaa79e, roughness: .24, metalness: 1 }));
    root.add(hook);
    const x = garment.pivot*W;
    root.position.set(x-W/2, H/2-GARMENT_Y, restingZ);
    return { garment, root, focus: spring(), x: spring(x), y: spring(GARMENT_Y),
      scale: spring(1), sideBlend, sideMap };
  }

  async add(garment: Garment) {
    const item = await this.loadItem(garment);
    if (this.disposed) { this.releaseItem(item); return; }
    this.items.push(item); this.scene.add(item.root);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.invalidate();
  }

  remove(id: string) {
    const item = this.items.find(i => i.garment.id === id);
    if (item) { this.scene.remove(item.root); this.releaseItem(item); }
    this.items = this.items.filter(i => i.garment.id !== id);
    this.invalidate();
  }

  hit(clientX: number, clientY: number, touch = false) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX-r.left)/r.width*2-1, -(clientY-r.top)/r.height*2+1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const result = this.raycaster.intersectObjects(this.items.map(i => i.root), true);
    for (const h of result) {
      if (!h.object.userData.garmentId) continue;
      const i = this.items.findIndex(item => item.garment.id === h.object.userData.garmentId);
      if (i >= 0) return i;
    }
    if (touch && this.pointer.y < .4 && this.pointer.y > -.6) {
      const x = (this.pointer.x+1)/2*W;
      let index = -1, distance = 140;
      this.items.forEach((item, i) => {
        if (Math.abs(x-item.x.value) < distance) { index=i; distance=Math.abs(x-item.x.value); }
      });
      return index;
    }
    return -1;
  }

  invalidate = () => {
    if (!this.raf && !this.disposed && !document.hidden) {
      this.previous = 0; this.raf = requestAnimationFrame(this.frame);
    }
  };

  private resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.cssWidth = bounds.width; this.cssHeight = bounds.height;
    const dpr = Math.min(devicePixelRatio || 1, this.resolution);
    const pixels = bounds.width*bounds.height*dpr*dpr;
    const cap = Math.min(1, Math.sqrt(2_000_000/Math.max(1, pixels)));
    const width = Math.max(1, Math.round(bounds.width*dpr*cap));
    const height = Math.max(1, Math.round(bounds.height*dpr*cap));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.renderer.setSize(width, height, false);
      this.backBuffer.setSize(Math.ceil(width/2), Math.ceil(height/2));
      this.blurBuffer.setSize(Math.ceil(width/2), Math.ceil(height/2));
    }
  }

  private update(dt: number) {
    const s = this.state();
    const modal = s.mode === 'product' ? 1 : 0;
    if (s.reduced) this.expand.value = modal;
    else stepSpring(this.expand, modal, dt, 110, 22);
    const p = clamp(this.expand.value);
    const active = s.mode === 'product' ? s.selected : s.active;
    let moving = Math.abs(this.expand.value-modal) > .0001 || Math.abs(this.expand.velocity) > .001;
    this.items.forEach((item, i) => {
      const target = i === active ? 1 : 0;
      if (s.reduced) item.focus.value = target;
      else stepSpring(item.focus, target, dt);
    });
    this.items.forEach((item, i) => {
      const g = item.garment;
      let x = g.pivot*W;
      this.items.forEach((other, j) => {
        if (i !== j) x += Math.sign(i-j)*182*Math.pow(.6, Math.abs(i-j)-1)*clamp(other.focus.value);
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
      item.root.rotation.y = g.restYaw*(1-f)+(selected ? s.spin*p : 0);
      item.root.rotation.z = s.reduced ? 0 : clamp(item.focus.velocity,-.8,.8)*-.012*(1-p);
      item.root.position.set(item.x.value-W/2,H/2-item.y.value,selected ? p*120 : restingZ);
      item.root.scale.setScalar(item.scale.value);
      const angle = Math.abs(item.root.rotation.y);
      // Two photographic projections are smoothly baked onto a real closed
      // volume; there is no array of angles or time-indexed image playback.
      item.sideBlend.value = clamp((Math.sin(angle)-.18)/(.98-.18));
      if (Math.abs(item.focus.value-(i===active?1:0)) > .0001 || Math.abs(item.focus.velocity) > .001) moving=true;
    });
    this.scene.updateMatrixWorld(true);
    return moving;
  }

  private draw() {
    const p = clamp(this.expand.value), s = this.state();
    const r = this.renderer;
    r.info.reset();
    r.setRenderTarget(null); r.autoClear=true;
    if (p < .003 || !this.items[s.selected]) { r.render(this.scene, this.camera); return; }
    // Blur only the small background framebuffer. The selected mesh stays crisp.
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
    this.items.forEach((item,i)=>{item.root.visible=i===s.selected;}); this.rail.visible=false;
    r.autoClear=false; r.clearDepth(); r.render(this.scene,this.camera); r.autoClear=true;
    this.items.forEach(item=>{item.root.visible=true;}); this.rail.visible=true;
  }

  private frame = (now: number) => {
    this.raf=0;
    if (this.disposed || document.hidden) return;
    const delta=this.previous ? now-this.previous : 16.667;
    const continuous=!!this.previous;
    this.previous=now;
    this.onFrame(now);
    const moving=this.update(Math.min(delta/1000,.05));
    const start=performance.now(); this.draw(); const cost=performance.now()-start;
    this.drawn++;
    if (continuous) { this.frames.push(delta); this.costs.push(cost); }
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
      garmentMeshes:this.items.length,mode:this.state().mode });
  }

  private releaseItem(item: Item) {
    const disposedTextures = new Set<THREE.Texture>();
    item.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      const mat=o.material as THREE.MeshBasicMaterial;
      if (mat.map && !disposedTextures.has(mat.map)) { mat.map.dispose(); disposedTextures.add(mat.map); }
      mat.dispose();
    });
    item.sideMap.dispose();
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

// Integration checks against the production design processor and renderer methods.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';

const root=path.resolve(import.meta.dirname,'..'),cache=new Map();
function moduleURL(file){
  if(cache.has(file))return cache.get(file);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const resolved=source.replace(/from (['"])([^'"]+)\1/g,(_,quote,specifier)=>{
    const target=specifier.startsWith('.')?moduleURL(path.resolve(path.dirname(file),specifier.endsWith('.ts')?specifier:specifier+'.ts')):import.meta.resolve(specifier);
    return `from ${quote}${target}${quote}`;
  });
  const url='data:text/javascript;base64,'+Buffer.from(resolved).toString('base64');cache.set(file,url);return url;
}
const {WardrobeRenderer}=await import(moduleURL(path.join(root,'lib/wardrobe-three.ts')));
const {garmentMaterial}=await import(moduleURL(path.join(root,'lib/garment-material.ts')));
const {prepareArtwork,sanitizeSavedWardrobe,blankDesign,defaultDesign,arrangeRack,fitArtwork,fitDesign,printArea,CLOTHING_TYPES}=await import(moduleURL(path.join(root,'lib/garment-design.ts')));
const source=JSON.parse(fs.readFileSync(path.join(root,'lib/garments.json'))).find(g=>g.id==='flowers');
const fixture={...source,id:'custom-fixture',sourceId:'flowers'};
function rig(){
  const front=new THREE.Texture(),back=new THREE.Texture(),material=garmentMaterial(front,back,source.fabricColor);
  const body=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),group=new THREE.Group();group.add(body);
  const item={garment:fixture,body,root:group,backMap:back,designTextures:new Set(),artwork:{},designVersion:0,released:false};
  const engine=Object.create(WardrobeRenderer.prototype),calls=[],pending=new Map(),disposed=new Set();
  engine.state=()=>({mode:'product',selected:0,active:-1});engine.items=[item];engine.scene=new THREE.Scene();engine.scene.add(group);engine.invalidate=()=>{};engine.disposed=false;
  engine.renderer={capabilities:{getMaxAnisotropy:()=>8},initTexture:()=>{}};
  const texture=url=>{const t=new THREE.Texture();t.name=url;t.addEventListener('dispose',()=>disposed.add(t));return t;};
  engine.textureLoader={loadAsync:url=>{
    calls.push(url);
    if(url.startsWith('data:'))return new Promise(resolve=>pending.set(url,()=>resolve(texture(url))));
    return Promise.resolve(texture(url));
  }};
  return {engine,item,calls,pending,disposed,uniforms:material.fabricUniforms};
}
const A='data:image/png;base64,QQ==',B='data:image/png;base64,Qg==',C='data:image/png;base64,Qw==';
const artwork=dataUrl=>({dataUrl,name:'test.png',aspect:2,width:240,x:15,y:330});
const {engine,item,calls,pending,disposed,uniforms}=rig();
await engine.applyDesign(fixture.id,defaultDesign());assert.equal(calls.length,0,'original pieces must not download neutral maps');
await engine.applyDesign(fixture.id,blankDesign('#f5f1e8'));
assert.equal(uniforms.customized.value,1);assert.equal(uniforms.fabricColor.value.getHexString(),'f5f1e8');
assert.equal(calls.length,3);assert(calls.every(url=>url.includes('/models/flowers-')),'custom instances must use their template UV maps');
assert.equal(uniforms.fabricMap.value.flipY,false,'GLB atlases use the GLTF UV orientation');
const pA=engine.applyDesign(fixture.id,{...blankDesign('#8b3437'),front:artwork(A)});
const pB=engine.applyDesign(fixture.id,{...blankDesign('#263e62'),front:artwork(B)});
pending.get(B)();await pB;const bTexture=uniforms.frontArtwork.value;
pending.get(A)();await pA;
assert.equal(uniforms.fabricColor.value.getHexString(),'263e62','a late upload must not replace the latest design');
assert.equal(uniforms.frontArtwork.value,bTexture);assert.equal(uniforms.frontEnabled.value,1);
assert.equal(bTexture.flipY,true,'artwork uses conventional image UVs');
assert([...disposed].some(t=>t.name===A),'superseded uploads must release their GPU texture');
const before=calls.length;
await engine.applyDesign(fixture.id,{...blankDesign('#263e62'),front:{...artwork(B),x:-25,y:400,width:180}});
assert.equal(calls.length,before,'moving a print must not reload or decode it');
assert.deepEqual(uniforms.frontPlacement.value.toArray(),[-25,-400,180,90]);
await engine.applyDesign(fixture.id,blankDesign('#263e62'));
assert.equal(uniforms.frontEnabled.value,0);assert.equal(uniforms.frontArtwork.value,item.body.material.map);
assert(disposed.has(bTexture),'removing artwork must free its texture');assert.equal(item.designTextures.size,3);
await engine.applyDesign(fixture.id,defaultDesign());assert.equal(uniforms.customized.value,0);
const late=engine.applyDesign(fixture.id,{...blankDesign(),back:artwork(C)});
engine.remove(fixture.id);pending.get(C)();await late;
assert.equal(engine.items.length,0);assert.equal(item.designTextures.size,0);
assert([...disposed].some(t=>t.name===C),'a late upload must be disposed after its garment is removed');

const added={...fixture,name:'My T-shirt'};
const saved=sanitizeSavedWardrobe({version:1,added:[added,added,{...added,id:'flowers'}],designs:{valid:{color:'#123456',originalPrint:false,front:artwork(B)},invalid:{color:'oops',front:{...artwork(A),dataUrl:'https://example.com/image.png'}}}});
assert.equal(saved.added.length,1);assert.equal(saved.designs.valid.color,'#123456');assert(!saved.designs.invalid.color&&!saved.designs.invalid.front);
assert.equal(sanitizeSavedWardrobe({version:99}),undefined);
const rack=arrangeRack(Array.from({length:20},(_,i)=>({...fixture,id:`custom-${i}`})));
assert(rack.every((g,i)=>i===0||Math.abs((g.pivot-rack[i-1].pivot)*2912-320)<1e-7),'adding pieces must extend the rail without squeezing slots');

// Eviction during an in-flight decode cannot resurrect an old GPU texture.
const residency=rig();residency.item.prepared=true;
residency.engine.sharedTextures=new Map();residency.engine.ownedTextures=new Set();
const decoding=residency.engine.applyDesign(fixture.id,{...blankDesign(),front:artwork(A)});
residency.engine.evictDesign(residency.item);residency.pending.get(A)();await decoding;
assert(!residency.item.prepared);assert.equal(residency.item.designTextures.size,0);
assert([...residency.disposed].some(t=>t.name===A));
const restored=residency.engine.applyDesign(fixture.id,{...blankDesign(),front:artwork(B)});
residency.pending.get(B)();await restored;
assert(residency.item.prepared);assert.equal(residency.uniforms.frontEnabled.value,1);
assert.equal(residency.calls.filter(url=>!url.startsWith('data:')).length,3,'shared fabric maps decode only once across residency changes');
const ownership=rig();let geometryDisposed=false,materialDisposed=false;
ownership.item.body.geometry.userData.sharedGarment=true;
ownership.item.body.material.map.userData.sharedGarment=true;ownership.item.backMap.userData.sharedGarment=true;
ownership.item.body.geometry.addEventListener('dispose',()=>geometryDisposed=true);
ownership.item.body.material.addEventListener('dispose',()=>materialDisposed=true);
ownership.engine.remove(fixture.id);assert(!geometryDisposed);assert(materialDisposed);assert.equal(ownership.disposed.size,0);
const hundredSaved=sanitizeSavedWardrobe({version:1,added:Array.from({length:110},(_,i)=>({...added,id:`custom-${i}`})),designs:{}});
assert.equal(hundredSaved.added.length,90,'restore preserves 100 total pieces within capacity');

let placementChecks=0;
for(const {type} of CLOTHING_TYPES)for(const side of ['front','back'])for(const aspect of [1/1536,.1,.5,1,2,10,1536])for(const x of [-100,100])for(const y of [100,650]){
 const a={...artwork(A),aspect,width:360,x,y},fit=fitArtwork(a,type,side),area=printArea(type,side),height=fit.width/fit.aspect;
 assert.equal(fit.dataUrl,A);assert.equal(fit.aspect,aspect);assert(fit.width>0);
 assert(fit.x-fit.width/2>=-area.width/2-1e-7&&fit.x+fit.width/2<=area.width/2+1e-7);
 assert(fit.y-height/2>=area.top-1e-7&&fit.y+height/2<=area.bottom+1e-7);placementChecks++;
}
const both=fitDesign({...blankDesign(),front:artwork(A),back:artwork(B)},'hoodie');
assert.equal(both.front.dataUrl,A);assert.equal(both.back.dataUrl,B);
function replacementRig(){
 const r=rig();Object.assign(r.item,{prepared:true,inDetail:true,focus:{value:1,velocity:0},x:{value:1500,velocity:2},y:{value:280,velocity:0},scale:{value:1.2,velocity:0},sway:{value:.01,velocity:.001},cloth:{bend:{value:2,velocity:1},twist:{value:.01,velocity:.01}}});
 r.engine.state=()=>({selected:0,mode:'product'});r.item.body.geometry.computeBoundingBox();r.engine.camera=new THREE.PerspectiveCamera();r.engine.renderer.compileAsync=async()=>{};
 r.engine.loadItem=async garment=>{
  const front=new THREE.Texture(),back=new THREE.Texture(),body=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),garmentMaterial(front,back,'#eee'));
  body.geometry.computeBoundingBox();const group=new THREE.Group();group.add(body);
  return {garment,root:group,body,backMap:back,designTextures:new Set(),artwork:{},designVersion:0,released:false,prepared:false};
 };
 return r;
}
const replacement=replacementRig(),target={...fixture,type:'hoodie',sourceId:'hoodie'};
const switching=replacement.engine.replace(fixture.id,target,{...blankDesign('#263e62'),front:artwork(A)});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(replacement.engine.items[0],replacement.item,'old mesh stays visible while assets prepare');
assert.equal(replacement.item.released,false);assert.equal(replacement.engine.scene.children.length,1);
replacement.pending.get(A)();await switching;
const swapped=replacement.engine.items[0];assert.notEqual(swapped,replacement.item);
assert.equal(swapped.garment.id,fixture.id);assert.equal(swapped.garment.type,'hoodie');
assert.equal(swapped.x.value,1500);assert.equal(swapped.x.velocity,2);assert.equal(swapped.cloth.twist.value,.01);
assert.equal(swapped.body.material.fabricUniforms.frontEnabled.value,1);assert.equal(swapped.body.material.fabricUniforms.fabricColor.value.getHexString(),'263e62');
assert(replacement.calls.some(url=>url.includes('/models/hoodie-fabric.jpg')));assert(replacement.item.released);assert.equal(replacement.engine.scene.children.length,1);
const resized=replacementRig(),originalLoader=resized.engine.loadItem;
resized.engine.loadItem=async garment=>{const item=await originalLoader(garment);item.body.geometry.dispose();item.body.geometry=new THREE.BoxGeometry(1,2,1);item.body.geometry.computeBoundingBox();return item;};
await resized.engine.replace(fixture.id,target,blankDesign());
assert.equal(resized.engine.items[0].scale.value,.6,'type changes preserve the initial visible height');
assert.equal(resized.engine.items[0].root.scale.y,.6);assert.equal(resized.engine.productReveal,0);
const failed=replacementRig();failed.engine.renderer.compileAsync=async()=>{throw new Error('shader failure');};
await assert.rejects(failed.engine.replace(fixture.id,target,blankDesign()),/shader failure/);
assert.equal(failed.engine.items[0],failed.item);assert.equal(failed.item.released,false);assert.equal(failed.engine.scene.children.length,1);
const removed=replacementRig(),pendingSwap=removed.engine.replace(fixture.id,target,{...blankDesign(),front:artwork(A)});
await new Promise(resolve=>setTimeout(resolve,0));removed.engine.remove(fixture.id);removed.pending.get(A)();
await assert.rejects(pendingSwap,/no longer/);assert.equal(removed.engine.items.length,0);assert.equal(removed.engine.scene.children.length,0);
// A failed export must restore live material/target state and release its FBO.
const photo=replacementRig();photo.engine.state=()=>({selected:0});photo.item.body.geometry.computeBoundingBox();photo.engine.clothPadding=()=>0;photo.item.body.material.opacity=.4;
let currentTarget=null,disposedTargets=0;
Object.assign(photo.engine.renderer,{autoClear:false,getRenderTarget:()=>null,setRenderTarget:target=>{currentTarget=target;if(target)target.addEventListener('dispose',()=>disposedTargets++);},render:()=>{throw new Error('export failure');}});
await assert.rejects(photo.engine.exportPng(),/export failure/);assert.equal(currentTarget,null);assert.equal(photo.engine.renderer.autoClear,false);assert.equal(photo.item.body.material.opacity,.4);assert.equal(disposedTargets,1);

let imageChecks=0;
const require=createRequire(import.meta.url);
let canvas;
try{canvas=require('@napi-rs/canvas');}catch{
  const primary=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if(primary)canvas=require(path.join(primary,'@napi-rs/canvas'));
}
if(canvas){
  let closed=0;
  globalThis.document={createElement:name=>{assert.equal(name,'canvas');return canvas.createCanvas(1,1);}};
  globalThis.createImageBitmap=async file=>{const image=await canvas.loadImage(Buffer.from(await file.arrayBuffer()));image.close=()=>closed++;return image;};
  const raw=canvas.createCanvas(420,300);raw.getContext('2d').fillStyle='#ff8800';raw.getContext('2d').fillRect(80,120,180,60);
  const prepared=await prepareArtwork(new File([raw.toBuffer('image/png')],'logo.png',{type:'image/png'}));
  const decoded=await canvas.loadImage(prepared.dataUrl);
  assert.equal(decoded.width,180);assert.equal(decoded.height,60);assert.equal(prepared.aspect,3);assert.equal(closed,1);imageChecks++;
  const large=canvas.createCanvas(2048,1024);large.getContext('2d').fillStyle='#334455';large.getContext('2d').fillRect(0,0,2048,1024);
  const resized=await prepareArtwork(new File([large.toBuffer('image/jpeg')],'photo.jpg',{type:'image/jpeg'}));
  const resizedImage=await canvas.loadImage(resized.dataUrl);assert.equal(resizedImage.width,1536);assert.equal(resizedImage.height,768);assert.equal(resized.aspect,2);imageChecks++;
  await assert.rejects(prepareArtwork(new File([raw.toBuffer('image/png')],'wrong.svg',{type:'image/svg+xml'})),/PNG, JPG, or WebP/);imageChecks++;
  await assert.rejects(prepareArtwork({type:'image/png',size:16*1024*1024}),/smaller than 15 MB/);imageChecks++;
  await assert.rejects(prepareArtwork(new File(['broken'],'broken.png',{type:'image/png'})),/could not be opened/);imageChecks++;
  const empty=canvas.createCanvas(20,20);
  await assert.rejects(prepareArtwork(new File([empty.toBuffer('image/png')],'empty.png',{type:'image/png'})),/completely transparent/);imageChecks++;
  assert.equal(closed,3,'decoded bitmaps must close even when processing fails');
}
const result={scope:'Production renderer/design integration and native-canvas image processor; no browser FPS claims',lazyFabricLoading:true,sharedMeshOwnership:true,inflightResidencyCancellation:true,sharedAtlasResidency:true,restoreCapacity100:true,blackToWhiteColours:true,latestUploadWins:true,placementWithoutDecode:true,removalAndLateUploadDisposal:true,savedStateValidation:true,dynamicRack20Pieces:true,imageProcessingChecks:imageChecks,placementChecks,atomicGarmentSwitch:true,replacementKeepsVisibleHeight:true,replacementFailureKeepsOriginal:true,removedReplacementDisposes:true,exportFailureRestoresRenderer:true};
const out=process.argv[2]||path.join(root,'docs/qa/three/design-state.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));

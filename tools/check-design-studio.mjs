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
const {prepareArtwork,sanitizeSavedWardrobe,blankDesign,defaultDesign,arrangeRack}=await import(moduleURL(path.join(root,'lib/garment-design.ts')));
const source=JSON.parse(fs.readFileSync(path.join(root,'lib/garments.json'))).find(g=>g.id==='flowers');
const fixture={...source,id:'custom-fixture',sourceId:'flowers'};
function rig(){
  const front=new THREE.Texture(),back=new THREE.Texture(),material=garmentMaterial(front,back,source.fabricColor);
  const body=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),group=new THREE.Group();group.add(body);
  const item={garment:fixture,body,root:group,backMap:back,designTextures:new Set(),artwork:{},designVersion:0,released:false};
  const engine=Object.create(WardrobeRenderer.prototype),calls=[],pending=new Map(),disposed=new Set();
  engine.items=[item];engine.scene=new THREE.Scene();engine.scene.add(group);engine.invalidate=()=>{};engine.disposed=false;
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
assert(rack.every((g,i)=>g.pivot>=.17-1e-10&&g.pivot<=.83+1e-10&&(i===0||g.pivot>rack[i-1].pivot)));

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
const result={scope:'Production renderer/design integration and native-canvas image processor; no browser FPS claims',lazyFabricLoading:true,blackToWhiteColours:true,latestUploadWins:true,placementWithoutDecode:true,removalAndLateUploadDisposal:true,savedStateValidation:true,dynamicRack20Pieces:true,imageProcessingChecks:imageChecks};
const out=process.argv[2]||path.join(root,'docs/qa/three/design-state.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));

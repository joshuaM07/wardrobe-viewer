// Exercise the actual renderer's transforms and projection without a GPU.
// This validates camera framing and springs, not hardware browser FPS.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';

const root=path.resolve(import.meta.dirname,'..');
const cache=new Map();
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
const {spring}=await import(moduleURL(path.join(root,'lib/motion.ts')));
const garments=[...JSON.parse(fs.readFileSync(path.join(root,'lib/garments.json'))),JSON.parse(fs.readFileSync(path.join(root,'public/garments/hoodie.json')))];
function geometry(g){
  const raw=fs.readFileSync(path.join(root,'public',g.mesh));
  const length=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+length)),binary=raw.subarray(28+length);
  const vertices=[];
  for(const primitive of doc.meshes[0].primitives){
    const a=doc.accessors[primitive.attributes.POSITION],v=doc.bufferViews[a.bufferView],offset=(v.byteOffset||0)+(a.byteOffset||0);
    const positions=new Float32Array(binary.buffer,binary.byteOffset+offset,a.count*3);vertices.push(...positions);
  }
  const buffer=new THREE.BufferGeometry();buffer.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));buffer.computeBoundingBox();return buffer;
}
const geometries=garments.map(geometry);
const material=new THREE.MeshBasicMaterial();
function rig(width,height,mobile=true){
  const state={active:6,selected:6,mode:'rack',demo:false,demoStart:0,reduced:false,spin:0,mobile,rackPosition:6};
  const renderer=Object.create(WardrobeRenderer.prototype);
  renderer.state=()=>state;renderer.cssWidth=width;renderer.cssHeight=height;renderer.mobileProfile=mobile;
  const worldHeight=2912*height/width;
  renderer.camera=new THREE.OrthographicCamera(-1456,1456,worldHeight/2,-worldHeight/2,.1,8000);
  renderer.camera.position.z=3000;renderer.scene=new THREE.Scene();
  renderer.expand=spring();renderer.viewX=spring();renderer.viewY=spring();renderer.viewZoom=spring(1);
  renderer.items=garments.map((garment,i)=>{
    const group=new THREE.Group(),body=new THREE.Mesh(geometries[i],material);group.add(body);renderer.scene.add(group);
    return {garment,root:group,body,focus:spring(),x:spring(garment.pivot*2912),y:spring(418),scale:spring(1)};
  });
  renderer.update(0);return {renderer,state};
}
function settle(renderer){let moving=true;for(let i=0;i<360;i++)moving=renderer.update(1/60);assert.equal(moving,false,'camera and garment motion must stop after settling');}
function projectedBounds(renderer,item){
  const box=item.body.geometry.boundingBox,points=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,0])for(const z of [box.min.z,box.max.z]){
    const p=new THREE.Vector3(x,y,z).applyMatrix4(item.root.matrixWorld).project(renderer.camera);
    points.push([(p.x+1)*renderer.cssWidth/2,(1-p.y)*renderer.cssHeight/2]);
  }
  return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
}
const viewports=[{screen:[320,568]},{screen:[360,760]},{screen:[390,844]},{screen:[700,900]},{screen:[844,390],landscape:true},{screen:[568,320],landscape:true}];
const checks=[],poses=[];
for(const viewport of viewports){
  const [screenWidth,screenHeight]=viewport.screen;
  const cardWidth=viewport.landscape?Math.min(screenWidth*.94,700):screenWidth*.94;
  const cardHeight=viewport.landscape?Math.max(300,screenHeight*.92):Math.max(480,Math.min(screenHeight*.86,700));
  const canvasWidth=cardWidth*(viewport.landscape?.65:1),canvasHeight=cardHeight*(viewport.landscape?.88:.6);
  const {renderer,state}=rig(canvasWidth,canvasHeight);
  for(const mode of ['rack','product']){
    for(let index=0;index<garments.length;index++){
      state.mode=mode;state.active=index;state.selected=index;state.rackPosition=index;settle(renderer);
      const item=renderer.items[index],bounds=projectedBounds(renderer,item);
      assert(bounds.top>=0&&bounds.bottom<=canvasHeight,`hem or hook clipped: ${viewport.screen}/${mode}/${item.garment.id}`);
      assert(bounds.left>=0&&bounds.right<=canvasWidth,`sleeve clipped: ${viewport.screen}/${mode}/${item.garment.id}`);
      const center=new THREE.Vector3().applyMatrix4(item.root.matrixWorld).project(renderer.camera).x;
      if(mode==='rack'&&index>0&&index<garments.length-1)assert(Math.abs(center)<.001,'interior garment must be centered');
      if(mode==='rack'&&index===0)assert(center<0&&center>-.25,'first garment must remain visible near the bounded left edge');
      if(mode==='rack'&&index===garments.length-1)assert(center>0&&center<.25,'last garment must remain visible near the bounded right edge');
      checks.push({screen:viewport.screen,canvas:[+canvasWidth.toFixed(2),+canvasHeight.toFixed(2)],mode,id:item.garment.id,zoom:+renderer.camera.zoom.toFixed(3),bounds:Object.fromEntries(Object.entries(bounds).map(([k,v])=>[k,+v.toFixed(2)])),centerNdc:+center.toFixed(4)});
      if(viewport.screen[0]===390&&((mode==='rack'&&[0,6,10].includes(index))||(mode==='product'&&index===6))){
        poses.push({name:`${mode}-${item.garment.id}`,width:canvasWidth,height:canvasHeight,projection:renderer.camera.projectionMatrix.toArray(),view:renderer.camera.matrixWorldInverse.toArray(),items:renderer.items.map(i=>({id:i.garment.id,matrix:i.root.matrixWorld.toArray()})),selected:item.garment.id});
      }
    }
  }
  const before=renderer.camera.zoom;state.reduced=true;state.mode='rack';state.active=2;state.selected=2;state.rackPosition=2;renderer.update(1/60);
  assert.equal(renderer.items[2].focus.value,1,'reduced motion must turn the active garment directly');
  assert(renderer.camera.zoom>0&&before>0);
}
const desktop=rig(1151,1151*1620/2912,false);
for(const mode of ['rack','product']){desktop.state.mode=mode;settle(desktop.renderer);assert.equal(desktop.renderer.camera.zoom,1);assert.equal(desktop.renderer.camera.position.x,0);assert.equal(desktop.renderer.camera.position.y,0);}
const output=process.argv[2]||path.join(root,'docs/qa/three/mobile-framing.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify({scope:'Production renderer CPU transforms and actual GLB bounding boxes; not browser FPS',garments:garments.length,framingChecks:checks.length,desktopCameraUnchanged:true,checks,poses},null,2)+'\n');
console.log(JSON.stringify({output,garments:garments.length,framingChecks:checks.length,desktopCameraUnchanged:true,allGarmentsFit:true}));

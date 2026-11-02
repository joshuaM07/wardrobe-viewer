// Production spring, gesture, renderer, and background-cache regressions.
// CPU timing/geometry checks do not establish hardware browser FPS.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
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
const {spring,stepSpring,dragMotion,sampleDrag,releaseVelocity,stepGlide}=await import(moduleURL(path.join(root,'lib/motion.ts')));
const {WardrobeRenderer}=await import(moduleURL(path.join(root,'lib/wardrobe-three.ts')));
const garments=JSON.parse(fs.readFileSync(path.join(root,'lib/garments.json')));
const rates=[30,60,90,120,144];
const close=(actual,expected,tolerance=1e-9)=>assert(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);
let springCases=0;
for(const [stiffness,damping] of [[85,14],[144,24],[75,24]]){
  for(const duration of [.2,.4,.6]){
    const expected=spring(-.4);expected.velocity=1.3;stepSpring(expected,1,duration,stiffness,damping);
    for(const hz of rates){
      const actual=spring(-.4);actual.velocity=1.3;
      for(let time=0;time<duration-1e-10;){const dt=Math.min(1/hz,duration-time);stepSpring(actual,1,dt,stiffness,damping);time+=dt;}
      close(actual.value,expected.value);close(actual.velocity,expected.velocity);springCases++;
    }
    const jitter=spring(-.4);jitter.velocity=1.3;
    const steps=[.006,.033,.009,.052,.014];
    for(let time=0,index=0;time<duration-1e-10;index++){const dt=Math.min(steps[index%steps.length],duration-time);stepSpring(jitter,1,dt,stiffness,damping);time+=dt;}
    close(jitter.value,expected.value);close(jitter.velocity,expected.velocity);springCases++;
  }
}
const gesture=dragMotion(0,0);
for(let t=10;t<=100;t+=10)sampleDrag(gesture,t*.006,t);
assert(releaseVelocity(gesture,110)>5,'quick release must preserve hand velocity');
assert.equal(releaseVelocity(gesture,200),0,'hold before release must cancel the fling');
sampleDrag(gesture,100,100);assert(Number.isFinite(gesture.velocity),'duplicate timestamps must not produce NaN');
const expectedGlide=stepGlide(8,.6);
for(const hz of rates){
  let velocity=8,distance=0;
  for(let t=0;t<.6-1e-10;){const dt=Math.min(1/hz,.6-t),next=stepGlide(velocity,dt);distance+=next.distance;velocity=next.velocity;t+=dt;}
  close(distance,expectedGlide.distance);close(velocity,expectedGlide.velocity);
}

function rig(){
  const state={active:-1,selected:6,mode:'rack',demo:false,reduced:false,spin:0,mobile:false,rackPosition:6,dragging:false};
  const renderer=Object.create(WardrobeRenderer.prototype);
  Object.assign(renderer,{state:()=>state,cssWidth:1151,cssHeight:640,mobileProfile:false,rackSpread:182,
    scene:new THREE.Scene(),camera:new THREE.OrthographicCamera(-1456,1456,810,-810,.1,8000),
    expand:spring(),viewX:spring(),viewY:spring(),viewZoom:spring(1),spin:spring(),spinSelected:-1,
    spinMomentum:0,spinFollowing:false,invalidate:()=>{},textureRevision:0,backgroundStamp:''});
  renderer.camera.position.z=3000;
  renderer.items=garments.map(garment=>{
    const group=new THREE.Group(),geometry=new THREE.BoxGeometry(600,750,90);geometry.computeBoundingBox();
    const body=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());group.add(body);renderer.scene.add(group);
    return {garment,root:group,body,prepared:true,focus:spring(),sway:spring(),x:spring(garment.pivot*2912),y:spring(418),scale:spring(1)};
  });
  renderer.update(0);return {renderer,state};
}
function advance(renderer,seconds,hz=120){for(let t=0;t<seconds-1e-10;){const dt=Math.min(1/hz,seconds-t);renderer.update(dt);t+=dt;}}
function settle(renderer){advance(renderer,6);assert.equal(renderer.update(1/60),false,'motion must sleep once settled');}
const response=[];
for(let index=0;index<garments.length;index++){
  const {renderer,state}=rig();state.active=index;
  let peak=0,settledAt=0;
  for(let frame=0;frame<180;frame++){
    renderer.update(1/120);const item=renderer.items[index];peak=Math.max(peak,item.focus.value);
    if(Math.abs(item.root.rotation.y)>.02||Math.abs(item.focus.velocity)>.15)settledAt=(frame+1)/120;
  }
  assert(peak>1,'turn must retain a small, continuous overshoot');
  assert(peak<1.015,'overshoot must remain subtle');
  assert(settledAt<.8,'turn should settle in the reference time range');
  state.active=-1;
  const before=renderer.items[index].root.rotation.y;renderer.update(0);close(renderer.items[index].root.rotation.y,before);
  settle(renderer);
  response.push({id:garments[index].id,settledSeconds:+settledAt.toFixed(3),overshootPercent:+((peak-1)*100).toFixed(3)});
}
const {renderer,state}=rig();state.active=6;advance(renderer,.25);
const neighbor=renderer.items[7],displacement=neighbor.x.value-neighbor.garment.pivot*2912;
assert(displacement>182*.75,'neighbors must make space promptly without cascaded lag');
assert(Math.abs(neighbor.sway.value)>.001,'rail displacement must create hanger sway');
for(const target of [1,8,2,9,0,6]){state.active=target;advance(renderer,.08);}
settle(renderer);assert(renderer.items.every(item=>Number.isFinite(item.root.rotation.z)));

state.mode='product';settle(renderer);
state.dragging=true;renderer.beginSpinDrag();state.spin=1.5;advance(renderer,.1);
const releaseAngle=renderer.spin.value;state.dragging=false;renderer.releaseSpin(6);
close(renderer.spin.value,releaseAngle);advance(renderer,.25);
assert(renderer.spin.value>releaseAngle+.7,'released piece must keep rotating');
const grabAngle=renderer.spin.value;close(renderer.beginSpinDrag(),grabAngle);close(state.spin,grabAngle);
assert.equal(renderer.spinMomentum,0,'re-grab must stop free motion without a jump');
state.dragging=true;advance(renderer,.1);close(renderer.spin.value,grabAngle);state.dragging=false;
renderer.releaseSpin(-6);advance(renderer,.1);assert(renderer.spin.value<grabAngle,'reverse fling must retain its direction');
state.selected=3;state.spin=0;renderer.update(1/60);assert.equal(renderer.spinMomentum,0,'momentum must not leak to the next garment');
renderer.releaseSpin(8);state.reduced=true;renderer.update(1/60);
assert.equal(renderer.spinMomentum,0);assert.equal(renderer.spin.velocity,0);
assert(renderer.items.every(item=>item.focus.velocity===0&&item.sway.velocity===0));
state.reduced=false;settle(renderer);

// Raster cache validity: selected-piece motion reuses the background, while
// rack, camera, texture, selection, and resolution changes invalidate it.
renderer.canvas={width:1200,height:668};renderer.rail=new THREE.Group();renderer.scene.add(renderer.rail);
renderer.postScene=new THREE.Scene();renderer.postCamera=new THREE.Camera();
renderer.backBuffer=new THREE.WebGLRenderTarget(1,1);renderer.blurBuffer=new THREE.WebGLRenderTarget(1,1);
renderer.blur={uniforms:{image:{value:null},direction:{value:new THREE.Vector2()},opacity:{value:1}}};
let calls=0;
renderer.renderer={info:{reset:()=>{}},setRenderTarget:()=>{},clearDepth:()=>{},render:()=>calls++};
renderer.draw();assert.equal(calls,4,'first product frame renders and blurs background');
calls=0;state.spin+=.3;advance(renderer,.1);renderer.draw();assert.equal(calls,2,'selected-piece rotation must reuse the cached background');
for(const mutate of [()=>{renderer.textureRevision++;},()=>{renderer.items[0].root.position.x+=1;renderer.scene.updateMatrixWorld(true);},()=>{renderer.camera.position.x+=1;renderer.camera.updateMatrixWorld();},()=>{renderer.canvas.width+=2;},()=>{state.selected=4;}]){
  calls=0;mutate();renderer.draw();assert.equal(calls,4,'background change must invalidate the cache');
}

// Compare turn width against the same 341 measured reference frames, retaining
// segmentation/occlusion uncertainty rather than treating it as a pixel match.
const reference=JSON.parse(fs.readFileSync(path.join(root,'docs/qa/three/motion-measurements.json')));
const referenceWidths=[];
for(const turn of reference.turns){
  const garment=garments.find(g=>g.id===turn.id),raw=fs.readFileSync(path.join(root,'public',garment.mesh));
  const length=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+length)),binary=raw.subarray(28+length),positions=[];
  for(const primitive of doc.meshes[0].primitives.slice(0,3)){
    const a=doc.accessors[primitive.attributes.POSITION],v=doc.bufferViews[a.bufferView];
    positions.push(new Float32Array(binary.buffer,binary.byteOffset+(v.byteOffset??0)+(a.byteOffset??0),a.count*3));
  }
  const {renderer,state}=rig(),index=garments.indexOf(garment);let error=0;
  for(let frame=0;frame<turn.widths.length;frame++){
    state.active=frame>=turn.calibrated.delayFrames?index:-1;renderer.update(1/60);
    const angle=renderer.items[index].root.rotation.y,c=Math.cos(angle),s=Math.sin(angle);let lo=Infinity,hi=-Infinity;
    for(const mesh of positions)for(let p=0;p<mesh.length;p+=3){const x=mesh[p]*c+mesh[p+2]*s;lo=Math.min(lo,x);hi=Math.max(hi,x);}
    error+=Math.abs(hi-lo-turn.widths[frame]);
  }
  referenceWidths.push({id:turn.id,frames:turn.widths.length,widthMaeSourcePixels:+(error/turn.widths.length).toFixed(2)});
  assert(error/turn.widths.length<40,'turn timing must remain close to the measured reference widths');
}
const result={scope:'Production CPU motion and cache regressions; reference width segmentation includes occlusions. No hardware FPS claim.',springCases,refreshRates:rates,jitteredFrames:true,gestureHoldCancelsFling:true,coastAndRegrab:true,rapidRetargets:true,reducedMotion:true,backgroundCacheInvalidation:true,neighborDisplacementAt250ms:+displacement.toFixed(2),response,referenceFrames:referenceWidths.reduce((n,t)=>n+t.frames,0),referenceWidths};
const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));

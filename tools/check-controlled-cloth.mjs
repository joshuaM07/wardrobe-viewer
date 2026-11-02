// Actual production transforms and GLBs, checked throughout interrupted motion.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { moduleURL } from './import-typescript.mjs';
const root=path.resolve(import.meta.dirname,'..');
const {WardrobeRenderer}=await import(moduleURL(path.join(root,'lib/wardrobe-three.ts')));
const {spring}=await import(moduleURL(path.join(root,'lib/motion.ts')));
const {clothMotion,clothPoint,stepCloth,solveRailContacts}=await import(moduleURL(path.join(root,'lib/garment-motion.ts')));
const {garmentMaterial}=await import(moduleURL(path.join(root,'lib/garment-material.ts')));
const {arrangeRack}=await import(moduleURL(path.join(root,'lib/garment-design.ts')));
const originals=[...JSON.parse(fs.readFileSync(path.join(root,'lib/garments.json'))),JSON.parse(fs.readFileSync(path.join(root,'public/garments/hoodie.json')))];
function load(g){
 const raw=fs.readFileSync(path.join(root,'public',g.mesh)),l=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+l)),bin=raw.subarray(28+l);
 const read=i=>{const a=doc.accessors[i],v=doc.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3}[a.type],Type=a.componentType===5125?Uint32Array:Float32Array;return new THREE.BufferAttribute(new Type(bin.buffer,bin.byteOffset+(v.byteOffset??0)+(a.byteOffset??0),a.count*size),size);};
 const parts=doc.meshes[0].primitives.map(p=>{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',read(p.attributes.POSITION));geometry.setAttribute('normal',read(p.attributes.NORMAL));geometry.setAttribute('uv',read(p.attributes.TEXCOORD_0));geometry.setAttribute('garmentSurface',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(p.material),1));geometry.setIndex(read(p.indices));return geometry;
 });
 const geometry=mergeGeometries(parts);geometry.computeBoundingBox();return geometry;
}
const geometries=new Map(originals.map(g=>[g.id,load(g)]));
function rig(collection){
 const state={active:-1,selected:6,mode:'rack',demo:false,reduced:false,spin:0,mobile:false,rackPosition:6,dragging:false};
 const engine=Object.create(WardrobeRenderer.prototype);
 Object.assign(engine,{state:()=>state,cssWidth:1151,cssHeight:640,mobileProfile:false,rackSpread:182,scene:new THREE.Scene(),camera:new THREE.OrthographicCamera(-1456,1456,810,-810,.1,8000),boundsMatrix:new THREE.Matrix4(),boundsBox:new THREE.Box3(),
  expand:spring(),viewX:spring(),viewY:spring(),viewZoom:spring(1),spin:spring(),spinSelected:-1,spinMomentum:0,spinFollowing:false,previousMode:'rack',productReveal:1,invalidate:()=>{}});
 engine.items=collection.map(garment=>{
  const body=new THREE.Mesh(geometries.get(garment.sourceId??garment.id),garmentMaterial(new THREE.Texture(),new THREE.Texture(),garment.fabricColor));const group=new THREE.Group();group.add(body);engine.scene.add(group);
  return {garment,body,root:group,prepared:true,focus:spring(),sway:spring(),cloth:clothMotion(),inDetail:false,x:spring(garment.pivot*2912),y:spring(418),scale:spring(1)};
 });engine.rail=new THREE.Group();engine.makeRail();engine.scene.add(engine.rail);engine.setGarments(collection);engine.update(0);return {engine,state};
}
const expanded=arrangeRack([...originals.slice(0,10),...Array.from({length:10},(_,i)=>({...originals[i%3===0?10:[6,4][i%2]],id:`extra-${i}`,sourceId:originals[i%3===0?10:[6,4][i%2]].id}))]);
let checkedFrames=0,checkedPairs=0,maxHangerRoll=0,maxHemTwist=0,maxBend=0,maxSleeves=0,maxHem=0;
const worst=[];const hangerSpan={10:[Infinity,-Infinity],11:[Infinity,-Infinity],20:[Infinity,-Infinity],100:[Infinity,-Infinity]};
function check(engine,label){
 for(const item of engine.items)if(!item.inDetail){const span=hangerSpan[engine.items.length];span[0]=Math.min(span[0],item.x.value);span[1]=Math.max(span[1],item.x.value);}
 const railBounds=new THREE.Box3().setFromObject(engine.rail);
 for(const item of engine.items)if(!item.inDetail)assert(item.root.position.x>railBounds.min.x&&item.root.position.x<railBounds.max.x,`hanger left rail: ${label}: ${item.garment.id} x=${item.root.position.x} rail=${railBounds.min.x},${railBounds.max.x} cloth=${JSON.stringify(item.cloth)}`);
 const boxes=engine.items.map(item=>{
  maxHangerRoll=Math.max(maxHangerRoll,Math.abs(item.sway.value));maxHemTwist=Math.max(maxHemTwist,Math.abs(item.cloth.twist.value));maxBend=Math.max(maxBend,Math.abs(item.cloth.bend.value));maxSleeves=Math.max(maxSleeves,Math.abs(item.cloth.left?.value??0),Math.abs(item.cloth.right?.value??0));maxHem=Math.max(maxHem,Math.abs(item.cloth.hem?.value??0));
  // Independent bound over transformed box corners, all intermediate twists,
  // and extremal cuff/hem offsets. It is intentionally separate from the
  // renderer's analytic projection. The interval error is bounded by 0.1 mm.
  const box=item.body.geometry.boundingBox,matrix=item.root.matrixWorld;
  const bounds=new THREE.Box3(),yaw=item.root.rotation.y,bend=item.cloth.bend.value;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])for(let n=0;n<=8;n++)for(const w of [0,1]){
    const a=item.cloth.twist.value*n/8,c=Math.cos(a),s=Math.sin(a);
    bounds.expandByPoint(new THREE.Vector3(c*x+s*z+Math.cos(yaw)*bend*w,y,-s*x+c*z+Math.sin(yaw)*bend*w).applyMatrix4(matrix));
  }
  const sleeves=Math.max(Math.abs(item.cloth.left?.value??0),Math.abs(item.cloth.right?.value??0)),hem=Math.abs(item.cloth.hem?.value??0);
  const dy=.1*sleeves+.08*hem,dz=sleeves+1.25*hem,e=matrix.elements;
  bounds.expandByVector(new THREE.Vector3(Math.abs(e[4])*dy+Math.abs(e[8])*dz+.1,Math.abs(e[5])*dy+Math.abs(e[9])*dz+.1,Math.abs(e[6])*dy+Math.abs(e[10])*dz+.1));
  return bounds;
 });
 if(engine.items.length===10)for(const box of boxes)assert(box.min.x>=-1456&&box.max.x<=1456,`catalogue clipped: ${label}`);
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  checkedPairs++;
  if(boxes[i].intersectsBox(boxes[j]))worst.push({label,i,j,depth:[engine.items[i].root.position.z,engine.items[j].root.position.z]});
 }
 checkedFrames++;
}
const sequence=[['rack',1,.14],['rack',2,.09],['rack',1,.11],['rack',8,.18],['rack',0,.1],['rack',9,.2],['product',2,.12],['rack',-1,.08],['product',8,.05],['product',4,.06],['product',0,.1],['product',9,.13],['rack',-1,.08],['rack',1,.18],['rack',8,.13],['rack',2,.2],['rack',-1,6]];
const hundred=arrangeRack([...originals.slice(0,10),...Array.from({length:90},(_,i)=>{const g=originals[[6,4,5,10][i%4]];return {...g,id:`personal-${i}`,sourceId:g.id};})]);
for(const collection of [originals.slice(0,10),originals,expanded,hundred])for(const hz of [30,60,120]){
 const {engine,state}=rig(collection);
 for(const [mode,index,seconds] of sequence){
  state.mode=mode;if(mode==='product'){state.selected=index;state.spin=0;}else state.active=index;
  for(let elapsed=0;elapsed<seconds-1e-9;){const dt=Math.min(1/hz,seconds-elapsed);engine.update(dt);check(engine,`${collection.length}/${hz}/${mode}/${index}`);elapsed+=dt;}
 }
 assert.equal(engine.update(1/60),false,'secondary motion and clearance must settle to sleep');
 if(collection.length===20){for(const i of [19,18,0,11,10]){state.active=i;for(let n=0;n<hz*.2;n++){engine.update(1/hz);check(engine,`20/${hz}/hoodie/${i}`);}}}
 if(collection.length===100){
  for(const index of [99,0,49,98,1,75,20])for(const mode of ['rack','product','rack']){
   state.mode=mode;state.active=index;state.selected=index;state.rackPosition=index;
   for(let n=0;n<hz*.35;n++){state.spin=n/hz*15;engine.update(1/hz);check(engine,`100/${hz}/${mode}/${index}`);}
  }
  state.mode='rack';state.active=-1;for(let n=0;n<hz*6;n++)engine.update(1/hz);
  assert.equal(engine.update(1/hz),false,'100-piece rack must settle');
 }
 state.reduced=true;state.mode='rack';state.active=3;engine.update(1/60);check(engine,'reduced');
 assert(engine.items.every(i=>i.cloth.bend.value===0&&i.cloth.twist.value===0));
}
const timeline=[[0,-1,'rack'],[.970017,1,'rack'],[2.5,2,'rack'],[3.583333,3,'rack'],[5.016667,4,'rack'],[6.366667,5,'rack'],[7.2,6,'rack'],[8.45,6,'product'],[10.1,5,'product'],[10.72,4,'product'],[11.29,3,'product'],[12.21,2,'product'],[13.55,-1,'rack'],[14.333333,8,'rack'],[15.02,5,'rack'],[15.34,2,'rack'],[16.81,1,'rack'],[17.95,-1,'rack']];
{
 const {engine,state}=rig(originals.slice(0,10));
 for(let frame=0;frame<1136;frame++){
  const entry=timeline.findLast(entry=>entry[0]<=frame/60);state.mode=entry[2];if(entry[2]==='product')state.selected=entry[1];else state.active=entry[1];
  engine.update(1/60);
  check(engine,`reference/${frame}`);
 }
}
assert.equal(worst.length,0,JSON.stringify(worst.slice(0,8)));
assert(maxHangerRoll<.025);assert(maxHemTwist<.14);assert(maxBend<30);assert(maxSleeves<42);assert(maxHem<27);
// The support is pinned; every material, original UV and rest-space print point
// uses the same warp, so there is no independent artwork animation.
for(const y of [0,-40,-100,-130])assert.deepEqual(clothPoint(280,y,30,24,15,.115,32,-32,20),[280,y,30]);
const light=clothMotion(),heavy=clothMotion();stepCloth(light,8,900,.18,'tee',false);stepCloth(heavy,8,900,.18,'hoodie',false);
assert(Math.abs(heavy.bend.value)<Math.abs(light.bend.value)*.6);assert(Math.abs(heavy.twist.value)<Math.abs(light.twist.value)*.6);
// Three non-collinear support points stay fixed while both cuffs and the hem
// move relative to them. This rules out a rigid-body rotation as the effect.
const flexible=clothMotion();for(let i=0;i<30;i++)stepCloth(flexible,6,0,1/60,'tee',false);
const deflect=(x,y)=>clothPoint(x,y,0,flexible.bend.value,0,flexible.twist.value,flexible.left.value,flexible.right.value,flexible.hem.value);
for(const [x,y] of [[-170,-120],[170,-120],[0,-60]])assert.deepEqual(deflect(x,y),[x,y,0]);
assert(Math.abs(deflect(-240,-300)[2])>4);assert(Math.abs(deflect(240,-300)[2])>4);assert(Math.abs(deflect(100,-700)[2])>5);
assert(Math.abs(flexible.left.value+flexible.right.value)>.05,'sleeves must have different response times');
for(let i=0;i<360;i++)stepCloth(flexible,0,0,1/60,'tee',false);
assert(Object.values(flexible).every(mode=>Math.abs(mode.value)<1e-6&&Math.abs(mode.velocity)<1e-6),'loose parts settle without idle noise');
// A collision transfers momentum according to mass and dissipates energy.
const pair=[{position:0,velocity:120,mass:1,envelope:{left:-30,right:30}},{position:50,velocity:-20,mass:2.1,envelope:{left:-30,right:30}}];
const momentum=pair.reduce((v,b)=>v+b.velocity*b.mass,0),energy=pair.reduce((v,b)=>v+b.mass*b.velocity**2/2,0);solveRailContacts(pair);
assert(Math.abs(pair.reduce((v,b)=>v+b.velocity*b.mass,0)-momentum)<1e-9);
assert(pair.reduce((v,b)=>v+b.mass*b.velocity**2/2,0)<energy);assert(pair[1].position-pair[0].position>=72-1e-7);
const result={scope:'Actual production GLBs and transforms at every simulation step; conservative 3D bounds include the controlled shader warp. No cloth simulation, no GPU frame-rate claim.',checkedFrames,checkedPairs,hangerSpan,intersections:worst.length,collections:[10,11,20,100],massWeightedMomentumTransfer:true,inelasticContacts:true,rates:[30,60,120],referenceReplayFrames:1136,rapidRetargets:true,interruptedDetailTransitions:true,pinnedShoulders:true,hangersRemainOnRail:true,catalogueInsideFrame:true,heavierHoodies:true,reducedMotion:true,maxHangerRollDegrees:maxHangerRoll*180/Math.PI,maxHemTwistDegrees:maxHemTwist*180/Math.PI,maxHemBendWorldUnits:maxBend,maxSleeveDeflectionWorldUnits:maxSleeves,maxHemRippleWorldUnits:maxHem,independentSleeveAndHemModes:true,nonRigidCuffAndHemMotion:true,loosePartsSettle:true};
const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
if(process.argv[3]){
 const samples=[];
 for(const geometry of geometries.values()){
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv,s=geometry.attributes.garmentSurface;
  for(let i=0;i<p.count;i+=23)samples.push([p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i),uv.getX(i),uv.getY(i),s.getX(i)]);
 }
 const expected=([bx,bz,twist,left=0,right=0,hem=0])=>samples.map(sample=>{
  const [x,y,z,nx,ny,nz,,,surface]=sample;
  const warp=(x,y,z)=>surface<2.5?clothPoint(x,y,z,bx,bz,twist,left,right,hem):[x,y,z];
  const p=warp(x,y,z),epsilon=.02,columns=[];
  for(let axis=0;axis<3;axis++){
   const a=[x,y,z],b=[x,y,z];a[axis]+=epsilon;b[axis]-=epsilon;
   const pa=warp(...a),pb=warp(...b);columns.push(pa.map((v,k)=>(v-pb[k])/(2*epsilon)));
  }
  const j=new THREE.Matrix3().set(columns[0][0],columns[1][0],columns[2][0],columns[0][1],columns[1][1],columns[2][1],columns[0][2],columns[1][2],columns[2][2]);
  const normal=new THREE.Vector3(nx,ny,nz).applyMatrix3(j.invert().transpose()).normalize();
  return [...p,1,x,y,...normal.toArray(),sample[6],sample[7]];
 });
 const states=[[0,0,0,0,0,0],[-24,15,.115,-32,32,20],[24,-15,-.115,32,-32,-20],[0,0,0,32,0,0],[0,0,0,0,-32,20]];
 fs.writeFileSync(process.argv[3],JSON.stringify({samples,states:states.map(state=>({state,expected:expected(state)}))}));
}

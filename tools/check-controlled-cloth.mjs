// Independent geometry clearance over interrupted native cloth motion.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {garments,rig,clothMotion,clothValues,stepCloth,solveRailContacts,arrangeRack} from './qa-cloth-fixture.mjs';
let checkedFrames=0,checkedPairs=0,exactVertexChecks=0,maxWeight=0,maxSum=0,intersections=0;
const vector=new THREE.Vector3();
function actualBox(item){
 const box=new THREE.Box3(),p=item.body.geometry.attributes.position;
 for(let i=0;i<p.count;i++){item.body.getVertexPosition(i,vector);box.expandByPoint(vector.applyMatrix4(item.root.matrixWorld));}
 exactVertexChecks+=p.count;return box;
}
function check(engine,label){
 const railBounds=new THREE.Box3().setFromObject(engine.rail);
 for(const item of engine.items){
  const values=clothValues(item.cloth);assert(values.every(v=>v>=0&&v<=1));maxWeight=Math.max(maxWeight,...values);maxSum=Math.max(maxSum,values.reduce((a,b)=>a+b,0));assert(maxSum<=1.25001);
  if(!item.inDetail)assert(item.root.position.x>railBounds.min.x&&item.root.position.x<railBounds.max.x,`hanger left rail ${label}`);
 }
 const broad=engine.items.map(item=>item.body.geometry.boundingBox.clone().applyMatrix4(item.root.matrixWorld).expandByScalar(engine.clothPadding(item)));
 const exact=new Map();
 const box=i=>{if(!exact.has(i))exact.set(i,actualBox(engine.items[i]));return exact.get(i);};
 for(let i=0;i<broad.length;i++)for(let j=i+1;j<broad.length;j++){
  checkedPairs++;
  if(broad[i].intersectsBox(broad[j])&&box(i).intersectsBox(box(j))){intersections++;assert.fail(`fabric bounds intersect ${label}: ${i}/${j}`);}
 }
 checkedFrames++;
}
for(const count of [10,11,20,100])for(const hz of [30,60,120]){
 const collection=count<=11?garments.slice(0,count):arrangeRack([...garments,...Array.from({length:count-11},(_,i)=>({...garments[[6,5,4,10][i%4]],id:`personal-${i}`,sourceId:garments[[6,5,4,10][i%4]].id}))]);
 const {engine,state}=rig(collection);
 for(const [mode,index,seconds] of [['rack',1,.14],['rack',8,.1],['rack',0,.15],['product',6,.3],['product',4,.15],['rack',-1,.13],['rack',count-1,.2],['rack',0,.2],['rack',count-2,.2],['rack',-1,4]]){
  state.mode=mode;state.active=index;state.selected=index<0?0:index;state.rackPosition=Math.max(0,index);
  for(let frame=0;frame<Math.ceil(seconds*hz);frame++){state.spin=mode==='product'?Math.sin(frame/hz*8)*4:0;engine.update(1/hz);check(engine,`${count}/${hz}/${mode}/${index}/${frame}`);}
 }
 for(let i=0;i<hz*4;i++)engine.update(1/hz);assert.equal(engine.update(1/hz),false,'cloth must stop rendering after settling');
 state.reduced=true;state.active=3;engine.update(1/hz);check(engine,'reduced');assert(engine.items.every(item=>clothValues(item.cloth).every(v=>v===0)));
}
// Bound each native response, including reversal and a long frame. No signed
// extrapolation of a pose is permitted: it used to throw cuffs upwards.
for(const type of ['tee','long-sleeve','crewneck','hoodie']){
 const motion=clothMotion();
 for(const [turn,rail,dt] of [[8,900,.18],[-12,-1400,.016],[0,0,.12],[12,0,.6],[0,0,.016]]){stepCloth(motion,turn,rail,dt,type,false);assert(clothValues(motion).every(v=>v>=0&&v<=1));}
 for(let i=0;i<600;i++)stepCloth(motion,0,0,1/60,type,false);
 assert(clothValues(motion).every(v=>v<1e-6));
}
const pair=[{position:0,velocity:120,mass:1,envelope:{left:-30,right:30}},{position:50,velocity:-20,mass:2.1,envelope:{left:-30,right:30}}];
const momentum=pair.reduce((v,b)=>v+b.velocity*b.mass,0),energy=pair.reduce((v,b)=>v+b.mass*b.velocity**2/2,0);solveRailContacts(pair);
assert(Math.abs(pair.reduce((v,b)=>v+b.velocity*b.mass,0)-momentum)<1e-9);assert(pair.reduce((v,b)=>v+b.mass*b.velocity**2/2,0)<energy);assert(pair[1].position-pair[0].position>=72-1e-7);
const result={scope:'Production native morph geometry, actual vertex bounds for every potential contact; CPU geometry checks, no hardware FPS claim.',checkedFrames,checkedPairs,exactVertexChecks,intersections,collections:[10,11,20,100],rates:[30,60,120],nativeMorphs:4,maxWeight,maxSum,interruptedTransitions:true,reversals:true,reducedMotion:true,settlesToSleep:true,massWeightedMomentum:true};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));

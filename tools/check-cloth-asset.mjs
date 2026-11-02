// GLTFLoader, production merge, and Three's actual native morph evaluation.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {garments,geometries} from './qa-cloth-fixture.mjs';
let checked=0;
for(const g of garments.filter(g=>!process.argv[2]||g.id===process.argv[2])){
 const geometry=geometries.get(g.id);
 assert.equal(geometry.morphTargetsRelative,true,'merged glTF poses must remain displacement targets');
 assert.equal(geometry.morphAttributes.position.length,4);assert.equal(geometry.morphAttributes.normal.length,4);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
 const p=geometry.getAttribute('position'),surface=geometry.getAttribute('garmentSurface'),test=new THREE.Vector3(),expected=new THREE.Vector3();
 for(const weights of [[0,0,0,0],[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[.3,.2,.4,.1]]){
  mesh.morphTargetInfluences=weights;
  for(let i=0;i<p.count;i+=7){
   expected.fromBufferAttribute(p,i);
   geometry.morphAttributes.position.forEach((delta,j)=>{
    const d=new THREE.Vector3().fromBufferAttribute(delta,i);
    assert(d.length()<=45.001&&d.y<=8.001,'admit only moderate physical poses');
    if(surface.getX(i)>=3)assert.equal(d.length(),0,'wood hanger must stay rigid');
    expected.addScaledVector(d,weights[j]);
   });
   mesh.getVertexPosition(i,test);assert(test.distanceTo(expected)<1e-4,'native positions must match physical displacement');assert(Number.isFinite(test.length()));checked++;
  }
 }
}
console.log(JSON.stringify({garments:garments.length,nativeMorphSamples:checked,relativeMorphs:true,boundedPhysicalPoses:4,rigidHanger:true}));

// Read production GLBs through the same loader/merge path as the browser.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {moduleURL} from './import-typescript.mjs';
export const root=path.resolve(import.meta.dirname,'..');
export const {WardrobeRenderer}=await import(moduleURL(path.join(root,'lib/wardrobe-three.ts')));
export const {spring}=await import(moduleURL(path.join(root,'lib/motion.ts')));
export const {clothMotion,clothValues,stepCloth,solveRailContacts}=await import(moduleURL(path.join(root,'lib/garment-motion.ts')));
export const {garmentMaterial}=await import(moduleURL(path.join(root,'lib/garment-material.ts')));
export const {arrangeRack}=await import(moduleURL(path.join(root,'lib/garment-design.ts')));
export const garments=[...JSON.parse(fs.readFileSync(path.join(root,'lib/garments.json'))),JSON.parse(fs.readFileSync(path.join(root,'public/garments/hoodie.json')))];
export async function loadGeometry(g){
 const loader=new GLTFLoader();loader.register(()=>({name:'QA_NO_IMAGE_IO',loadTexture:async()=>new THREE.Texture()}));
 const bytes=fs.readFileSync(path.join(root,'public',g.mesh));
 const engine=Object.create(WardrobeRenderer.prototype);
 Object.assign(engine,{meshAssets:new Map(),ownedGeometry:new Set(),ownedTextures:new Set(),disposed:false,
  renderer:{capabilities:{getMaxAnisotropy:()=>4}},loader:{loadAsync:()=>loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'https://qa.invalid/')}});
 return (await engine.loadMeshAsset(g)).geometry;
}
export const geometries=new Map(await Promise.all(garments.map(async g=>[g.id,await loadGeometry(g)])));
export function rig(collection){
 const state={active:-1,selected:6,mode:'rack',demo:false,reduced:false,spin:0,mobile:false,rackPosition:6,dragging:false};
 const engine=Object.create(WardrobeRenderer.prototype);
 Object.assign(engine,{state:()=>state,cssWidth:1151,cssHeight:640,mobileProfile:false,rackSpread:182,scene:new THREE.Scene(),camera:new THREE.OrthographicCamera(-1456,1456,810,-810,.1,8000),boundsMatrix:new THREE.Matrix4(),boundsBox:new THREE.Box3(),
  expand:spring(),viewX:spring(),viewY:spring(),viewZoom:spring(1),spin:spring(),spinSelected:-1,spinMomentum:0,spinFollowing:false,previousMode:'rack',productReveal:1,invalidate:()=>{}});
 engine.items=collection.map(garment=>{
  const body=new THREE.Mesh(geometries.get(garment.sourceId??garment.id),garmentMaterial(new THREE.Texture(),new THREE.Texture(),garment.fabricColor));const group=new THREE.Group();group.add(body);engine.scene.add(group);
  return {garment,body,root:group,prepared:true,focus:spring(),sway:spring(),cloth:clothMotion(),inDetail:false,x:spring(garment.pivot*2912),y:spring(418),scale:spring(1)};
 });engine.rail=new THREE.Group();engine.makeRail();engine.scene.add(engine.rail);engine.setGarments(collection);engine.update(0);return {engine,state};
}

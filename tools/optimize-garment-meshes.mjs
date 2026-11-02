// Offline topology reduction. Original surfaces are reproducible with build-garment-meshes.py.
// Usage: node tools/optimize-garment-meshes.mjs [SOURCE_MODELS_DIR] [OUTPUT_MODELS_DIR] [REPORT]
// Keep separate material boundaries and their exact border vertices; never move vertices or UVs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

await MeshoptSimplifier.ready;
const root=path.resolve(import.meta.dirname,'..');
const source=process.argv[2]??path.join(root,'public/models');
const destination=process.argv[3]??source;
const report=process.argv[4]??path.join(root,'docs/qa/three/mesh-optimization.json');
const maxError=.3;
const models=[];
fs.mkdirSync(destination,{recursive:true});
for(const file of fs.readdirSync(source).filter(f=>f.endsWith('.glb')).sort()){
  const raw=fs.readFileSync(path.join(source,file)),length=raw.readUInt32LE(12);
  const doc=JSON.parse(raw.subarray(20,20+length)),binary=raw.subarray(28+length);
  assert(!doc.asset.generator?.includes('meshoptimizer'),'Use original meshes from build-garment-meshes.py; do not simplify an already optimized mesh again');
  const read=index=>{
    const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3}[a.type];
    assert(!v.byteStride&&!a.sparse&&size,'Expected tightly packed static mesh');
    const Type={5125:Uint32Array,5126:Float32Array}[a.componentType];
    assert(Type,'Unexpected component type');
    return new Type(binary.buffer,binary.byteOffset+(v.byteOffset??0)+(a.byteOffset??0),a.count*size);
  };
  const payload=[],views=[],accessors=[];
  let byteOffset=0,trianglesBefore=0,trianglesAfter=0,verticesBefore=0,verticesAfter=0,largestError=0;
  const append=(values,type,componentType,original)=>{
    const index=accessors.length;
    views.push({buffer:0,byteOffset,byteLength:values.byteLength});
    const accessor={bufferView:views.length-1,componentType,count:values.length/{SCALAR:1,VEC2:2,VEC3:3}[type],type};
    if(original?.min){accessor.min=original.min;accessor.max=original.max;}
    else if(type==='VEC3'){
      accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<values.length;i++){const c=i%3;accessor.min[c]=Math.min(accessor.min[c],values[i]);accessor.max[c]=Math.max(accessor.max[c],values[i]);}
    }
    accessors.push(accessor);payload.push(Buffer.from(values.buffer,values.byteOffset,values.byteLength));byteOffset+=values.byteLength;
    return index;
  };
  for(const mesh of doc.meshes)for(const p of mesh.primitives){
    assert.deepEqual(Object.keys(p.attributes).sort(),['NORMAL','POSITION','TEXCOORD_0']);
    const pos=read(p.attributes.POSITION),normals=read(p.attributes.NORMAL),uv=read(p.attributes.TEXCOORD_0),indices=read(p.indices);
    const targets=(p.targets??[]).map(target=>Object.fromEntries(Object.entries(target).map(([name,index])=>[name,read(index)])));
    const fields=targets.flatMap(target=>[target.POSITION,target.NORMAL].filter(Boolean));
    const stride=5+fields.length*3,weights=[.05,.05,.05,1,1,...fields.flatMap((_,i)=>Array(3).fill(i%2===0?.1:.025))];
    const attrs=new Float32Array(pos.length/3*stride);
    for(let i=0;i<pos.length/3;i++){
      attrs.set(normals.subarray(i*3,i*3+3),i*stride);attrs.set(uv.subarray(i*2,i*2+2),i*stride+3);
      fields.forEach((field,j)=>attrs.set(field.subarray(i*3,i*3+3),i*stride+5+j*3));
    }
    const [simplified,error]=MeshoptSimplifier.simplifyWithAttributes(indices,pos,3,attrs,stride,weights,null,3,maxError,['LockBorder','ErrorAbsolute']);
    assert(error<=maxError+1e-5);
    const [remap,count]=MeshoptSimplifier.compactMesh(simplified);
    const compact=(values,size)=>{
      const result=new Float32Array(count*size);
      for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)result.set(values.subarray(i*size,i*size+size),remap[i]*size);
      return result;
    };
    const positionAccessor=doc.accessors[p.attributes.POSITION];
    p.attributes={POSITION:append(compact(pos,3),'VEC3',5126,positionAccessor),NORMAL:append(compact(normals,3),'VEC3',5126),TEXCOORD_0:append(compact(uv,2),'VEC2',5126)};
    p.indices=append(simplified,'SCALAR',5125);
    if(targets.length)p.targets=targets.map(target=>Object.fromEntries(Object.entries(target).map(([name,values])=>[name,append(compact(values,3),'VEC3',5126)])));
    trianglesBefore+=indices.length/3;trianglesAfter+=simplified.length/3;verticesBefore+=pos.length/3;verticesAfter+=count;largestError=Math.max(error,largestError);
  }
  doc.bufferViews=views;doc.accessors=accessors;doc.buffers=[{byteLength:byteOffset}];
  doc.asset.generator='wardrobe native cloth poses / meshoptimizer 1.1 / locked borders / 0.3-unit error';
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+byteOffset,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const chunk=Buffer.alloc(8);chunk.writeUInt32LE(byteOffset);chunk.writeUInt32LE(0x004e4942,4);
  fs.writeFileSync(path.join(destination,file),Buffer.concat([header,json,chunk,...payload]));
  models.push({file,trianglesBefore,trianglesAfter,verticesBefore,verticesAfter,maxSimplifierError:+largestError.toFixed(6),bytesBefore:raw.length,bytesAfter:28+json.length+byteOffset});
}
const result={scope:'Offline GLB optimization, all material borders locked; retained vertices, normals, UVs and native cloth targets copied exactly. Simplifier error is a metric, not a pixel-quality guarantee.',errorLimitWorldUnits:maxError,models};
if(path.resolve(destination)===path.join(root,'public/models')){
  const update=garment=>{
    const model=models.find(m=>m.file===path.basename(garment.mesh));
    return model?{...garment,meshTriangles:model.trianglesAfter,meshVertices:model.verticesAfter}:garment;
  };
  for(const file of ['lib/garments.json','public/garments/hoodie.json']){
    const location=path.join(root,file),data=JSON.parse(fs.readFileSync(location));
    fs.writeFileSync(location,JSON.stringify(Array.isArray(data)?data.map(update):update(data),null,2)+'\n');
  }
}
fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({models:models.length,trianglesBefore:models.reduce((s,m)=>s+m.trianglesBefore,0),trianglesAfter:models.reduce((s,m)=>s+m.trianglesAfter,0),report}));

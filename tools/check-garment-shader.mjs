import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { garmentMaterial } from '../lib/garment-material.ts';
import fs from 'node:fs';
import path from 'node:path';

const out=process.argv[2]||'/workspace/scratch/wardrobe-shaders.json';
const root=path.resolve(import.meta.dirname,'..');
const material=garmentMaterial(new THREE.Texture(),new THREE.Texture(),new THREE.Texture(),{value:0},1.4,'#e2dce5');
const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
material.onBeforeCompile(shader,null);
const expand=s=>s.replace(/#include <([\w\d_]+)>/g,(_,name)=>{
  if(!THREE.ShaderChunk[name])throw new Error(`Missing shader chunk ${name}`);
  return expand(THREE.ShaderChunk[name]);
});
const vertexPrefix=`#version 330\n#define attribute in\n#define varying out\n#define texture2D texture
#define highp\n#define mediump\n#define lowp
#define USE_MAP\n#define MAP_UV uv\n#define NUM_CLIPPING_PLANES 0
uniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;uniform mat3 normalMatrix;uniform vec3 cameraPosition;
in vec3 position;in vec3 normal;in vec2 uv;\n`;
const fragmentPrefix=`#version 330\n#define varying in\n#define texture2D texture\n#define gl_FragColor fragmentColor
#define highp\n#define mediump\n#define lowp\n#define USE_MAP\n#define NUM_CLIPPING_PLANES 0
out vec4 fragmentColor;\n${THREE.ShaderChunk.colorspace_pars_fragment}
vec4 linearToOutputTexel(vec4 value){return sRGBTransferOETF(value);}\n`;
const source=fs.readFileSync(path.join(root,'lib/wardrobe-three.ts'),'utf8');
const blurVertex=source.match(/const blurVertex = `([\s\S]*?)`;/)[1];
const blurFragment=source.match(/const blurFragment = `([\s\S]*?)`;/)[1];
const meshes=[];
for(const file of fs.readdirSync(path.join(root,'public/models')).filter(f=>f.endsWith('.glb'))){
  const raw=fs.readFileSync(path.join(root,'public/models',file));
  const length=raw.readUInt32LE(12),json=JSON.parse(raw.subarray(20,20+length));
  const binary=raw.subarray(28+length);
  const geometries=[];
  for(const primitive of json.meshes[0].primitives){
    const geom=new THREE.BufferGeometry();
    const read=i=>{
      const a=json.accessors[i],v=json.bufferViews[a.bufferView],offset=v.byteOffset+(a.byteOffset||0);
      const sizes={VEC3:3,VEC2:2,SCALAR:1},size=sizes[a.type];
      const bytes=binary.subarray(offset,offset+a.count*size*4);
      const array=a.componentType===5125?new Uint32Array(bytes.buffer,bytes.byteOffset,a.count*size):new Float32Array(bytes.buffer,bytes.byteOffset,a.count*size);
      return new THREE.BufferAttribute(array,size);
    };
    geom.setAttribute('position',read(primitive.attributes.POSITION));
    geom.setAttribute('normal',read(primitive.attributes.NORMAL));
    geom.setAttribute('uv',read(primitive.attributes.TEXCOORD_0));
    geom.setAttribute('garmentSurface',new THREE.Float32BufferAttribute(new Float32Array(geom.attributes.position.count).fill(primitive.material),1));
    geom.setIndex(read(primitive.indices));geometries.push(geom);
  }
  const merged=mergeGeometries(geometries,false);
  if(!merged||merged.groups.length||merged.attributes.position.count!==geometries.reduce((a,g)=>a+g.attributes.position.count,0))throw new Error(`Bad merged model ${file}`);
  meshes.push({file,vertices:merged.attributes.position.count,triangles:merged.index.count/3,bodyDrawCalls:1});
}
fs.writeFileSync(out,JSON.stringify({
  garment:{vertex:vertexPrefix+expand(shader.vertexShader),fragment:fragmentPrefix+expand(shader.fragmentShader)},
  blur:{vertex:vertexPrefix+blurVertex,fragment:fragmentPrefix+expand(blurFragment).replace(/precision\s+\w+\s+\w+\s*;/g,'')},meshes,
},null,2));
console.log(JSON.stringify({output:out,meshes:meshes.length,bodyDrawCalls:meshes.length}));

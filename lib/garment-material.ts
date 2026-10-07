import * as THREE from 'three';

export type FabricUniforms = {
  backMap: { value: THREE.Texture }; fabricMap: { value: THREE.Texture };
  fabricBackMap: { value: THREE.Texture }; printMask: { value: THREE.Texture };
  frontArtwork: { value: THREE.Texture }; backArtwork: { value: THREE.Texture };
  frontPlacement: { value: THREE.Vector4 }; backPlacement: { value: THREE.Vector4 };
  customized: { value: number }; keepOriginal: { value: number };
  frontEnabled: { value: number }; backEnabled: { value: number };
  fabricColor: { value: THREE.Color }; woodColor: { value: THREE.Color };
};
export type FabricMaterial = THREE.MeshBasicMaterial & { fabricUniforms: FabricUniforms };

export function garmentMaterial(frontMap: THREE.Texture, backMap: THREE.Texture, fabricColor: string) {
  const material = new THREE.MeshBasicMaterial({ map: frontMap }) as FabricMaterial;
  const uniforms: FabricUniforms = {
    backMap: {value: backMap}, fabricMap: {value: frontMap}, fabricBackMap: {value: backMap},
    printMask: {value: frontMap}, frontArtwork: {value: frontMap}, backArtwork: {value: frontMap},
    frontPlacement: {value: new THREE.Vector4(0,-300,240,240)}, backPlacement: {value: new THREE.Vector4(0,-300,240,240)},
    customized: {value: 0}, keepOriginal: {value: 1}, frontEnabled: {value: 0}, backEnabled: {value: 0},
    fabricColor: {value: new THREE.Color(fabricColor)}, woodColor: {value: new THREE.Color(0x563a2f)},
  };
  material.fabricUniforms=uniforms;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=`attribute float garmentSurface;
      varying float vSurface; varying vec3 vFabricNormal; varying vec2 vFabricPoint;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vSurface=garmentSurface;
        vFabricPoint=position.xy;
        vFabricNormal=normalize(mat3(modelMatrix)*normal);`);
    shader.fragmentShader=`uniform sampler2D backMap, fabricMap, fabricBackMap, printMask, frontArtwork, backArtwork;
      uniform vec3 fabricColor, woodColor;
      uniform vec4 frontPlacement, backPlacement;
      uniform float customized, keepOriginal, frontEnabled, backEnabled;
      varying float vSurface; varying vec3 vFabricNormal; varying vec2 vFabricPoint;
      vec4 placedArtwork(sampler2D artwork,vec4 placement,float back) {
        vec2 uv=(vFabricPoint-placement.xy)/placement.zw+.5;
        if(back>.5)uv.x=1.-uv.x;
        if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);
        return texture2D(artwork,uv);
      }\n${shader.fragmentShader}`
      .replace('#include <map_fragment>',`#ifdef USE_MAP
        vec4 garmentColor;
        if(vSurface<.5)garmentColor=texture2D(map,vMapUv);
        else if(vSurface<1.5)garmentColor=texture2D(backMap,vMapUv);
        else if(vSurface<2.5)garmentColor=texture2D(map,vMapUv);
        else if(vSurface<4.5)garmentColor=texture2D(map,vMapUv);
        else garmentColor=vec4(woodColor,1.);
        if(vSurface<2.5) {
          if(customized>.5) {
            vec3 neutral=vSurface>.5&&vSurface<1.5?texture2D(fabricBackMap,vMapUv).rgb:texture2D(fabricMap,vMapUv).rgb;
            float shade=clamp(neutral.r/.5149,.055,1.45);
            vec3 cloth=fabricColor*shade;
            if(vSurface<.5&&keepOriginal>.5)cloth=mix(cloth,garmentColor.rgb,texture2D(printMask,vMapUv).r);
            garmentColor.rgb=cloth;
            vec4 ink=vec4(0.);
            if(vSurface<.5&&frontEnabled>.5)ink=placedArtwork(frontArtwork,frontPlacement,0.);
            if(vSurface>.5&&vSurface<1.5&&backEnabled>.5)ink=placedArtwork(backArtwork,backPlacement,1.);
            garmentColor.rgb=mix(garmentColor.rgb,ink.rgb*clamp(shade,.45,1.1),ink.a);
          }
          vec3 n=normalize(vFabricNormal);
          float key=max(dot(n,normalize(vec3(-.45,.6,1.))),0.);
          float fill=max(dot(n,normalize(vec3(.8,.15,-.5))),0.);
          garmentColor.rgb*=.83+.19*key+.075*fill;
        }
        diffuseColor*=garmentColor;
        #endif`);
  };
  material.customProgramCacheKey=()=> 'wardrobe-dynamic-fabric-v9';
  return material;
}

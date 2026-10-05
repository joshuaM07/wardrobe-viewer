import * as THREE from 'three';

export function garmentMaterial(
  frontMap: THREE.Texture, backMap: THREE.Texture, sideMap: THREE.Texture,
  sideBlend: THREE.IUniform<number>, restYaw: number, fabricColor: string,
) {
  const material=new THREE.MeshBasicMaterial({map:frontMap});
  // All six static surfaces share one draw call. Texture projections retain the
  // original baked lighting; the separate chrome hook has a physical material.
  material.onBeforeCompile=shader=>{
    shader.uniforms.sideMap={value:sideMap};shader.uniforms.backMap={value:backMap};
    shader.uniforms.sideBlend=sideBlend;
    shader.uniforms.fabricColor={value:new THREE.Color(fabricColor)};
    shader.uniforms.woodColor={value:new THREE.Color(0x563a2f)};
    shader.uniforms.restProjection={value:new THREE.Vector2(Math.cos(restYaw),Math.sin(restYaw))};
    shader.vertexShader=`uniform vec2 restProjection; attribute float garmentSurface;
      varying float vSurface; varying vec2 vSideUv;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vSurface=garmentSurface;
        vSideUv=vec2((position.x*restProjection.x+position.z*restProjection.y+320.)/640.,-position.y/810.);`);
    shader.fragmentShader=`uniform sampler2D sideMap; uniform sampler2D backMap;
      uniform float sideBlend; uniform vec3 fabricColor; uniform vec3 woodColor;
      varying float vSurface; varying vec2 vSideUv;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>',`#ifdef USE_MAP
        vec4 garmentColor;
        if(vSurface<.5){
          if(sideBlend>.999)garmentColor=texture2D(sideMap,vSideUv);
          else if(sideBlend<.001)garmentColor=texture2D(map,vMapUv);
          else garmentColor=mix(texture2D(map,vMapUv),texture2D(sideMap,vSideUv),sideBlend);
        }else if(vSurface<1.5)garmentColor=texture2D(backMap,vMapUv);
        else if(vSurface<2.5)garmentColor=vec4(fabricColor,1.);
        else if(vSurface<4.5)garmentColor=texture2D(map,vMapUv);
        else garmentColor=vec4(woodColor,1.);
        diffuseColor*=garmentColor;
        #endif`);
  };
  material.customProgramCacheKey=()=> 'wardrobe-static-surfaces-v3';
  return material;
}

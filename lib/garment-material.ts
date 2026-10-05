import * as THREE from 'three';

export function garmentMaterial(
  frontMap: THREE.Texture, backMap: THREE.Texture, fabricColor: string,
) {
  const material=new THREE.MeshBasicMaterial({map:frontMap});
  // Artwork uses the mesh's fixed UV coordinates at every orientation. Only the
  // geometry turns; captured side views never replace or fade the front print.
  material.onBeforeCompile=shader=>{
    shader.uniforms.backMap={value:backMap};
    shader.uniforms.fabricColor={value:new THREE.Color(fabricColor)};
    shader.uniforms.woodColor={value:new THREE.Color(0x563a2f)};
    shader.vertexShader=`attribute float garmentSurface;
      varying float vSurface;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vSurface=garmentSurface;`);
    shader.fragmentShader=`uniform sampler2D backMap;
      uniform vec3 fabricColor; uniform vec3 woodColor;
      varying float vSurface;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>',`#ifdef USE_MAP
        vec4 garmentColor;
        if(vSurface<.5)garmentColor=texture2D(map,vMapUv);
        else if(vSurface<1.5)garmentColor=texture2D(backMap,vMapUv);
        else if(vSurface<2.5)garmentColor=vec4(fabricColor,1.);
        else if(vSurface<4.5)garmentColor=texture2D(map,vMapUv);
        else garmentColor=vec4(woodColor,1.);
        diffuseColor*=garmentColor;
        #endif`);
  };
  material.customProgramCacheKey=()=> 'wardrobe-fixed-uv-surfaces-v5';
  return material;
}

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
      varying float vSurface; varying vec2 vSideUv; varying float vSideWeight;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vSurface=garmentSurface;
        // Immutable object-space UVs and normals. Rotation/camera position never
        // changes this texture stitch; the printed chest retains its front UVs.
        vSideUv=vec2((960.+position.z)/1280.,-position.y/810.);
        vSideWeight=smoothstep(.15,.8,abs(normal.x));`);
    shader.fragmentShader=`uniform sampler2D backMap;
      uniform vec3 fabricColor; uniform vec3 woodColor;
      varying float vSurface; varying vec2 vSideUv; varying float vSideWeight;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>',`#ifdef USE_MAP
        vec4 garmentColor;
        if(vSurface<.5)garmentColor=texture2D(map,vMapUv);
        else if(vSurface<1.5)garmentColor=texture2D(backMap,vMapUv);
        else if(vSurface<2.5)garmentColor=vec4(mix(texture2D(map,vMapUv).rgb,fabricColor,.015),1.);
        else if(vSurface<4.5)garmentColor=texture2D(map,vMapUv);
        else garmentColor=vec4(woodColor,1.);
        if(vSurface<1.5 && vSideWeight>.001){
          garmentColor=mix(garmentColor,texture2D(map,vSideUv),vSideWeight);
        }
        diffuseColor*=garmentColor;
        #endif`);
  };
  material.customProgramCacheKey=()=> 'wardrobe-fixed-uv-panels-v6';
  return material;
}

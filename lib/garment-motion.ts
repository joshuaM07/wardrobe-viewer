import { clamp, spring, stepSpring, type Spring } from './motion';

/** Two bounded artistic follow-through controls. No particles, cloth solver or idle noise. */
export type ClothMotion = { bend: Spring; twist: Spring };
export const clothMotion = (): ClothMotion => ({ bend: spring(), twist: spring() });
export function stepCloth(motion: ClothMotion, turnVelocity: number, railVelocity: number, dt: number, type: string, reduced: boolean) {
  const weight=type==='hoodie'?.5:type==='long-sleeve'?.75:1;
  const bend=reduced?0:clamp(-railVelocity*.01,-10,10)*weight;
  const twist=reduced?0:clamp(-turnVelocity*.012,-.055,.055)*weight;
  if(reduced){motion.bend.value=motion.twist.value=0;motion.bend.velocity=motion.twist.velocity=0;}
  else {stepSpring(motion.bend,bend,dt,80,15);stepSpring(motion.twist,twist,dt,64,13);}
  return Math.abs(motion.bend.value-bend)>.0001||Math.abs(motion.bend.velocity)>.001||
    Math.abs(motion.twist.value-twist)>.00001||Math.abs(motion.twist.velocity)>.0001;
}

/** Same rest-space warp as the vertex shader; shoulders and hanger stay pinned. */
export function clothPoint(x:number,y:number,z:number,bendX:number,bendZ:number,twist:number) {
  const t=clamp((-y-130)/600),w=t*t*(3-2*t),angle=twist*w,c=Math.cos(angle),s=Math.sin(angle);
  return [c*x+s*z+bendX*w,y,-s*x+c*z+bendZ*w] as const;
}
export const clothVertex = `
uniform vec2 clothBend;
uniform float clothTwist;
void clothWarp(inout vec3 p,inout vec3 n) {
  float t=clamp((-p.y-130.)/600.,0.,1.);
  float w=t*t*(3.-2.*t),dw=-6.*t*(1.-t)/600.;
  float a=clothTwist*w,c=cos(a),s=sin(a);
  vec3 q=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
  vec3 rotatedNormal=vec3(c*n.x+s*n.z,n.y,-s*n.x+c*n.z);
  vec2 dy=vec2(-s*p.x+c*p.z,-c*p.x-s*p.z)*clothTwist*dw+clothBend*dw;
  n=normalize(vec3(rotatedNormal.x,rotatedNormal.y-dot(dy,rotatedNormal.xz),rotatedNormal.z));
  p=q+vec3(clothBend.x*w,0.,clothBend.y*w);
}`;

export type Envelope = { left:number;right:number };
/** Ordered, one-dimensional clearance projection. Keeps the active hanger's anchor. */
export function separateRack(positions: number[], envelopes: Envelope[], anchor: number, gutter=10) {
  const result=positions.slice();
  if(!result.length)return result;
  anchor=clamp(anchor<0?Math.floor(result.length/2):anchor,0,result.length-1);
  for(let i=anchor-1;i>=0;i--)result[i]=Math.min(result[i],result[i+1]+envelopes[i+1].left-envelopes[i].right-gutter);
  for(let i=anchor+1;i<result.length;i++)result[i]=Math.max(result[i],result[i-1]+envelopes[i-1].right-envelopes[i].left+gutter);
  return result;
}

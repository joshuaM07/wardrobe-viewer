import { clamp, spring, stepSpring, type Spring } from './motion';

/** Driven fabric modes: pinned shoulders, loose sleeves and a delayed lower hem. */
export type ClothMotion = { bend: Spring; twist: Spring; left?: Spring; right?: Spring; hem?: Spring };
export const clothMotion = (): ClothMotion => ({bend:spring(),twist:spring(),left:spring(),right:spring(),hem:spring()});
export function stepCloth(motion:ClothMotion,turnVelocity:number,railVelocity:number,dt:number,type:string,reduced:boolean){
  const weight=type==='hoodie'?.52:type==='crewneck'?.65:type==='long-sleeve'?.8:1;
  motion.left??=spring();motion.right??=spring();motion.hem??=spring();
  const modes:[Spring,number,number,number][]=[
    [motion.bend,clamp(-railVelocity*.025,-24,24)*weight,65,12],
    [motion.twist,clamp(-turnVelocity*.024,-.115,.115)*weight,48,10],
    [motion.left,clamp(-turnVelocity*8-railVelocity*.01,-32,32)*weight,54,10],
    [motion.right,clamp(turnVelocity*8-railVelocity*.01,-32,32)*weight,42,9],
    [motion.hem,clamp(-turnVelocity*4-railVelocity*.008,-20,20)*weight,35,8],
  ];
  let moving=false;
  for(const [mode,target,k,damping] of modes){
    if(reduced){mode.value=mode.velocity=0;continue;}
    stepSpring(mode,target,dt,k,damping);
    if(Math.abs(mode.value-target)>.00001||Math.abs(mode.velocity)>.0001)moving=true;
  }
  return moving;
}
const smooth=(a:number,b:number,v:number)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
/** Same smooth, rest-space deformation as the shader, including loose cuffs. */
export function clothPoint(x:number,y:number,z:number,bendX:number,bendZ:number,twist:number,left=0,right=0,hem=0){
  const w=smooth(130,730,-y),angle=twist*w,c=Math.cos(angle),s=Math.sin(angle);
  const sleeve=smooth(120,260,Math.abs(x))*smooth(130,260,-y)*(x<0?left:right);
  const lower=smooth(310,735,-y)*hem;
  return [c*x+s*z+bendX*w,y+sleeve*.1+lower*.08*Math.cos(x*.012),
    -s*x+c*z+bendZ*w+sleeve+lower*(Math.sin(x*.014+.6)+.25*Math.sin(x*.031-.7))] as const;
}
export const clothVertex = `
uniform vec2 clothBend,clothSleeves;
uniform float clothTwist,clothHem;
vec2 clothWeight(float a,float b,float v){
  float t=clamp((v-a)/(b-a),0.,1.);
  return vec2(t*t*(3.-2.*t),6.*t*(1.-t)/(b-a));
}
void clothWarp(inout vec3 p,inout vec3 n){
  vec2 body=clothWeight(130.,730.,-p.y),sx=clothWeight(120.,260.,abs(p.x)),sy=clothWeight(130.,260.,-p.y),hem=clothWeight(310.,735.,-p.y);
  float w=body.x,dw=-body.y,a=clothTwist*w,c=cos(a),s=sin(a);
  float arm=p.x<0.?clothSleeves.x:clothSleeves.y;
  float cuff=arm*sx.x*sy.x,cuffX=arm*sx.y*sign(p.x)*sy.x,cuffY=-arm*sx.x*sy.y;
  float wave=sin(p.x*.014+.6)+.25*sin(p.x*.031-.7);
  float waveX=.014*cos(p.x*.014+.6)+.00775*cos(p.x*.031-.7);
  float lower=clothHem*hem.x,lowerY=-clothHem*hem.y;
  float cy=cos(p.x*.012),cyX=-.012*sin(p.x*.012);
  vec3 jx=vec3(c,cuffX*.1+lower*.08*cyX,-s+cuffX+lower*waveX);
  vec3 jy=vec3((-s*p.x+c*p.z)*clothTwist*dw+clothBend.x*dw,
    1.+cuffY*.1+lowerY*.08*cy,(-c*p.x-s*p.z)*clothTwist*dw+clothBend.y*dw+cuffY+lowerY*wave);
  vec3 jz=vec3(s,0.,c);
  n=normalize(n.x*cross(jy,jz)+n.y*cross(jz,jx)+n.z*cross(jx,jy));
  p=vec3(c*p.x+s*p.z+clothBend.x*w,p.y+cuff*.1+lower*.08*cy,
    -s*p.x+c*p.z+clothBend.y*w+cuff+lower*wave);
}`;

export type Envelope = { left:number;right:number };
export const garmentMass = (type:string) => type==='hoodie'?2.1:type==='crewneck'?1.65:type==='long-sleeve'?1.25:1;

/** Inelastic, mass-weighted rail contacts. Units are kg relative to a tee and mm. */
export function solveRailContacts(bodies: {position:number;velocity:number;mass:number;envelope:Envelope}[],gutter=12) {
  // Local projection shares the contact correction by inverse mass. The final
  // ordered sweep eliminates even residual chain penetration at large dt.
  for(let iteration=0;iteration<16;iteration++){
    let contacting=false;
    for(let i=0;i<bodies.length-1;i++){
      const a=bodies[i],b=bodies[i+1],penetration=a.position+a.envelope.right+gutter-(b.position+b.envelope.left);
      if(penetration<=1e-7)continue;
      contacting=true;const wa=1/a.mass,wb=1/b.mass,total=wa+wb;
      a.position-=penetration*wa/total;b.position+=penetration*wb/total;
      const relative=b.velocity-a.velocity;
      if(relative<0){const impulse=-relative/total;a.velocity-=impulse*wa;b.velocity+=impulse*wb;}
    }
    if(!contacting)break;
  }
  for(let i=1;i<bodies.length;i++){
    const a=bodies[i-1],b=bodies[i],min=a.position+a.envelope.right+gutter-b.envelope.left;
    if(b.position<min){
      b.position=min;
      const relative=b.velocity-a.velocity;
      if(relative<0){const impulse=-relative/(1/a.mass+1/b.mass);a.velocity-=impulse/a.mass;b.velocity+=impulse/b.mass;}
    }
  }
  return bodies;
}
/** Ordered, one-dimensional clearance projection. Keeps the active hanger's anchor. */
export function separateRack(positions: number[], envelopes: Envelope[], anchor: number, gutter=10) {
  const result=positions.slice();
  if(!result.length)return result;
  anchor=clamp(anchor<0?Math.floor(result.length/2):anchor,0,result.length-1);
  for(let i=anchor-1;i>=0;i--)result[i]=Math.min(result[i],result[i+1]+envelopes[i+1].left-envelopes[i].right-gutter);
  for(let i=anchor+1;i<result.length;i++)result[i]=Math.max(result[i],result[i-1]+envelopes[i-1].right-envelopes[i].left+gutter);
  return result;
}

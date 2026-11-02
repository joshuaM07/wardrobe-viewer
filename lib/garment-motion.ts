import { clamp, spring, stepSpring, type Spring } from './motion';

/** Reduced cloth response; vertex poses are baked offline with a cloth solver. */
export type ClothMotion = {
  positive:Spring;negative:Spring;railPositive:Spring;railNegative:Spring;
  turnVelocity?:number;railVelocity?:number;turnAcceleration:number;railAcceleration:number;
};
export const clothMotion=():ClothMotion=>({positive:spring(),negative:spring(),railPositive:spring(),railNegative:spring(),turnAcceleration:0,railAcceleration:0});
export function clothValues(motion:ClothMotion){
  const values=[motion.positive?.value??0,motion.negative?.value??0,motion.railPositive?.value??0,motion.railNegative?.value??0];
  const total=values.reduce((a,b)=>a+b,0),scale=Math.min(1,1.25/Math.max(total,1e-6));
  return values.map(v=>clamp(v)*scale);
}
export function stepCloth(motion:ClothMotion,turnVelocity:number,railVelocity:number,dt:number,type:string,reduced:boolean){
  motion.positive??=spring();motion.negative??=spring();motion.railPositive??=spring();motion.railNegative??=spring();
  // Material stiffness already lives in each baked surface. Keep its response
  // visible rather than damping heavy garments twice.
  const weight=type==='hoodie'?.85:type==='crewneck'?.9:type==='long-sleeve'?.95:1;
  const blend=1-Math.exp(-dt/.07);
  const turnA=dt>0&&motion.turnVelocity!==undefined?clamp((turnVelocity-motion.turnVelocity)/dt,-40,40):0;
  const railA=dt>0&&motion.railVelocity!==undefined?clamp((railVelocity-motion.railVelocity)/dt,-4000,4000):0;
  motion.turnAcceleration=(motion.turnAcceleration??0)+(turnA-(motion.turnAcceleration??0))*blend;
  motion.railAcceleration=(motion.railAcceleration??0)+(railA-(motion.railAcceleration??0))*blend;
  motion.turnVelocity=turnVelocity;motion.railVelocity=railVelocity;
  const turn=clamp(turnVelocity*.27+motion.turnAcceleration*.008,-1,1)*weight;
  const rail=clamp(railVelocity*.0008+motion.railAcceleration*.00003,-1,1)*weight;
  const modes:[Spring,number][]=[[motion.positive,Math.max(0,turn)],[motion.negative,Math.max(0,-turn)],[motion.railPositive,Math.max(0,rail)],[motion.railNegative,Math.max(0,-rail)]];
  let moving=false;
  for(const [mode,target] of modes){
    if(reduced){mode.value=mode.velocity=0;continue;}
    stepSpring(mode,target,dt,75,18);
    if(mode.value<0||mode.value>1){mode.value=clamp(mode.value);mode.velocity=0;}
    if(Math.abs(mode.value-target)>.00001||Math.abs(mode.velocity)>.0001)moving=true;
  }
  return moving;
}

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

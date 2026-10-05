import { clamp } from './motion';

export const MOBILE_RACK_QUERY = '(max-width:700px), (max-width:950px) and (max-height:500px)';
export const RACK_WIDTH = 2912;
const RACK_HEIGHT = 756;
const HANGER_Y = 1620 / 2 - 418;
export type RackView = { x: number; y: number; zoom: number };

/** Fit a complete garment, including the hook and a little breathing room. */
export function garmentZoom(width: number, height: number, garmentHeight = RACK_HEIGHT) {
  if(width<=0||height<=0)return 1;
  return clamp(RACK_WIDTH * height / (width * (garmentHeight + 114)), .5, 3.5);
}

/** Center the current rack position, bounded by the first and last garments. */
export function mobileRackView(pivots: number[], position: number, width: number, height: number): RackView {
  const zoom=garmentZoom(width,height);
  if(!pivots.length)return {x:0,y:0,zoom};
  const index=clamp(position,0,pivots.length-1),left=Math.floor(index),right=Math.min(left+1,pivots.length-1);
  const center=(pivots[left]+(pivots[right]-pivots[left])*(index-left))*RACK_WIDTH;
  const half=RACK_WIDTH/(2*zoom);
  const gap=pivots.length>1?Math.min(...pivots.slice(1).map((p,i)=>(p-pivots[i])*RACK_WIDTH)):0;
  const edge=clamp(half-330,0,gap*.45);
  const start=pivots[0]*RACK_WIDTH+edge,end=pivots.at(-1)!*RACK_WIDTH-edge;
  const bounded=clamp(center,start,end);
  return {x:bounded-RACK_WIDTH/2,y:HANGER_Y-RACK_HEIGHT/2,zoom};
}

export function mobileProductView(garment: {detailScale?: number;detailY?: number}, width: number, height: number, garmentHeight=RACK_HEIGHT): RackView {
  const scale=garment.detailScale??1.36;
  return {x:0,y:1620/2-(garment.detailY??276)-garmentHeight*scale/2,zoom:garmentZoom(width,height,garmentHeight*scale)};
}

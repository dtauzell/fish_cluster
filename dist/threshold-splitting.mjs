import {connectedRegions} from './connected-regions.mjs';

// TRex-inspired threshold sweep, restricted to the original blob.
// Threshold and size criteria are fixed before evaluating annotated frames.
export function thresholdSplit(blob, frame, background, width, {
 start=26, end=128, step=2, minArea=45, minSizeRatio=.3, minRetainedFraction=.25, darkZones=null
}={}) {
 let left=width,top=Infinity,right=0,bottom=0;
 for(const i of blob.pixels){const x=i%width,y=Math.floor(i/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 const w=right-left+1,h=bottom-top+1;
 for(let threshold=start;threshold<=end;threshold+=step){
  const mask=new Uint8Array(w*h);
  for(const i of blob.pixels)if((darkZones?.[i]?Math.abs(background[i]-frame[i]):background[i]-frame[i])>=threshold)mask[(Math.floor(i/width)-top)*w+i%width-left]=1;
  const parts=connectedRegions(mask,w,h,{minArea,minLength:10}).sort((a,b)=>b.area-a.area);
  if(parts.length!==2)continue;
  if(parts[1].area/parts[0].area<minSizeRatio||(parts[0].area+parts[1].area)/blob.area<minRetainedFraction)continue;
  return {threshold,parts:parts.map(({pixels,...p})=>({...p,x:p.x+left,y:p.y+top,source:'threshold-split-estimate'}))};
 }
 return null;
}

// Maximum-cardinality matching: each fish and detection may be used once.
function match(detections,boxes){
 const owners=new Map();
 function visit(i,seen){for(let j=0;j<boxes.length;j++){
  const b=boxes[j],d=detections[i];
  if(seen.has(j)||d.x<b.x||d.x>b.x+b.w||d.y<b.y||d.y>b.y+b.h)continue;
  seen.add(j);if(!owners.has(j)||visit(owners.get(j),seen)){owners.set(j,i);return true;}
 }return false;}
 detections.forEach((_,i)=>visit(i,new Set()));return owners;
}

export function score(detections, labels) {
 const visible=labels.filter(b=>!b.occluded), occluded=labels.filter(b=>b.occluded);
 const observed=match(detections,visible), used=new Set(observed.values());
 const remaining=detections.filter((_,i)=>!used.has(i));
 const hidden=match(remaining,occluded);
 return {visible:visible.length,occluded:occluded.length,tp:observed.size,
  fn:visible.length-observed.size,occludedTp:hidden.size,
  occludedFn:occluded.length-hidden.size,fp:remaining.length-hidden.size};
}

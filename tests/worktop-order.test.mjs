import assert from 'node:assert/strict';
import { calculateWorktopOrder as plan, layoutWorktopRuns, WORKTOP_KERF_MM } from '../public/src/worktop-order.js';
const r=(length,joints=[],wallId='north')=>({length,joints,wallId,level:820});
let checks=0;
function validate(runs,order){
  const map=new Map();
  for(const b of order.blanks){
    assert.ok(b.waste>=0); assert.ok(b.kerf>=0);
    assert.equal(b.parts.reduce((s,p)=>s+p.length,0)+b.kerf+b.waste,b.length);
    assert.ok(b.parts.reduce((s,p)=>s+p.length,0)+WORKTOP_KERF_MM*Math.max(0,b.parts.length-1)<=b.length);
    assert.equal(b.cuts,b.parts.length-(b.parts.reduce((s,p)=>s+p.length,0)+4*(b.parts.length-1)===b.length?1:0));
    for(const p of b.parts){assert.equal(p.end-p.start,p.length);if(!map.has(p.runId))map.set(p.runId,[]);map.get(p.runId).push(p);}
  }
  for(const [i,run] of runs.entries()){
    if(!run.length)continue;
    const parts=map.get(i+1).sort((a,b)=>a.start-b.start);let end=0;
    for(const p of parts){assert.equal(p.start,end);end=p.end;}
    assert.equal(end,run.length);
    if(run.length<=1500)assert.equal(parts.length,1);
    else for(const p of parts.slice(0,-1))assert.equal(p.nonStandardJoint,!(run.joints||[]).includes(p.end));
  }
  assert.equal(order.cost,order.blanks.reduce((s,b)=>s+b.price,0));
  assert.equal(order.cost,order.lines.reduce((s,b)=>s+b.cost,0));
  assert.equal(order.length+order.kerf+order.waste,order.stockLength);
  checks++;
}
for(const [runs,cost] of [
  [[],0],[[r(618)],3000],[[r(618),r(618,[],'east')],4500],[[r(418),r(418),r(418)],4500],[[r(818),r(818)],6000],[[r(1218,[609])],4500],[[r(1818,[609,1209])],6000],[[r(2418,[609,1209,1809])],7500],[[r(1000)],3000],[[r(1499)],4500],[[r(498),r(498)],3000],[[r(500),r(500)],4500],[[r(1500),r(300)],7500],[[r(1818,[609,1209]),r(378)],7500]
]){
  const result=plan(runs);validate(runs,result);assert.equal(result.cost,cost,JSON.stringify({runs,result}));
}
// Independent exhaustive oracle for intact separate pieces (small projects).
function oracle(parts){let best=Infinity;const bins=[];function visit(i,cost){if(cost>=best)return;if(i===parts.length){best=cost;return;}let p=parts[i];for(const b of bins){const next=b.used+4+p;if(next<=b.length){const old=b.used;b.used=next;visit(i+1,cost);b.used=old;}}for(const [length,price] of [[1000,3000],[1500,4500]])if(p<=length){bins.push({length,used:p});visit(i+1,cost+price);bins.pop();}}visit(0,0);return best;}
let seed=791;function rnd(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;}
for(let t=0;t<500;t++){
  const lens=Array.from({length:1+rnd(7)},()=>100+rnd(1401));const runs=lens.map(l=>r(l));const result=plan(runs);validate(runs,result);assert.equal(result.cost,oracle(lens));
}
for(let t=0;t<100;t++){
  const runs=Array.from({length:1+rnd(5)},()=>{const widths=Array.from({length:1+rnd(10)},()=>300+rnd(4)*100);let length=9;const joints=[];for(const w of widths){length+=w;joints.push(length);}joints.pop();return r(length+9,joints);});validate(runs,plan(runs));
}
// Layout across the four walls: two separated modules share one blank;
// two adjacent modules have one run, including their real external overhangs.
for(const wallId of ['north','south','east','west']){
  const room={width:4000,depth:4000};const get=()=>({category:'lower',width:600,height:820,worktop:true});
  const mk=(coords)=>coords.map((coord,i)=>({uid:String(i),moduleId:'m',wallId,coord}));
  const runs=layoutWorktopRuns(mk([-1,1]),room,get,()=>({width:.618,offsetX:0}));assert.equal(runs.length,2);assert.equal(plan(runs).cost,4500);validate(runs,plan(runs));
  const sign=['south','west'].includes(wallId)?-1:1;
  const row=layoutWorktopRuns(mk([-.3,.3]),room,get,(item)=>({width:.609,offsetX:sign*(item.coord<0?-.0045:.0045)}));assert.equal(row.length,1);assert.equal(row[0].length,1218);assert.deepEqual(row[0].joints,[609]);validate(row,plan(row));
}
console.log(`Passed ${checks} plan/layout checks`);

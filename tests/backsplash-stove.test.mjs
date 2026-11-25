import assert from 'node:assert/strict';
import {layoutBacksplash, panelTextureTransform} from '../public/src/backsplash.js';
import {APPLIANCES,normalizeAppliance} from '../public/src/appliances.js';
import {CATALOG} from '../public/data/catalog.js';
const room={width:3200,depth:3000,height:2600};
const lower=CATALOG.find(m=>m.category==='lower'&&m.width===600);
const get=(id,i)=>{const a=APPLIANCES.find(m=>m.id===id);return a?{...a,...normalizeAppliance(a,i.appliance)}:CATALOG.find(m=>m.id===id)};
const span=(i,m)=>({width:m.width/1000,offsetX:0});
const mk=(moduleId,coord,wallId='north',appliance)=>({moduleId,coord,wallId,elevation:0,appliance});
const layout=(items,enabled=true,h=600,r=room)=>layoutBacksplash(items,r,get,span,h,38,enabled);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let checks=0;
for(const wall of ['north','south','west','east']){
 for(const height of [650,850,858,1000,1200]){
  const items=[mk(lower.id,-.6,wall),mk('appliance-stove',0,wall,{height}),mk(lower.id,.6,wall)];
  const off=layout(items,false);assert.equal(off.length,2);near(off.reduce((s,r)=>s+r.width,0),1.2);
  const on=layout(items);near(on.reduce((s,r)=>s+r.width,0),1.8);
  near(Math.min(...on.map(r=>r.bottom)),Math.min(.858,height/1000));
  for(const r of on)near(r.top,1.458);
  if(height===858)assert.equal(on.length,1);else assert.equal(on.length,3);
  // Adjacent vertical edges must use matching physical texture UVs at the same world height.
  const ordered=[...on].sort((a,b)=>a.left-b.left);
  for(const rotated of [false,true])for(let j=1;j<ordered.length;j++){
    const a=ordered[j-1],b=ordered[j],rev=wall==='south'||wall==='west';
    const uv=(r,worldX,worldY)=>{const t=panelTextureTransform(r.width,r.height,1200,600,1,rotated,[.08,.05],r.textureAnchor);const u=rev?(r.right-worldX)/r.width:(worldX-r.left)/r.width,v=(worldY-r.bottom)/r.height;return rotated?[t.sx*v+t.ox,-t.sy*u+t.oy]:[t.sx*u+t.ox,t.sy*v+t.oy];};
    const ua=uv(a,a.right,1.3),ub=uv(b,b.left,1.3);near(ua[0],ub[0]);near(ua[1],ub[1]);
  }
  checks++;
 }
 for(const width of [300,600,1200]){
  const stove=mk('appliance-stove',0,wall,{width,sideGap:20,height:900});
  assert.equal(layout([stove],false).length,0);
  const r=layout([stove])[0];near(r.width,(width+40)/1000);near(r.bottom,.9);near(r.top,1.5);
  const short=layout([stove],true,250)[0];near(short.height,.25);
  const clipped=layout([stove],true,1200,{...room,height:1500})[0];near(clipped.top,1.5);
  assert.equal(layout([mk('appliance-fridge',0,wall)]).length,0);
  checks++;
 }
 // Rebuild on relocation; old wall must not keep a stove panel.
 const moved=layout([mk(lower.id,-.6,wall),mk('appliance-stove',0,wall==='north'?'south':'north')]);assert.equal(moved.length,2);assert.notEqual(moved[0].wallId,moved[1].wallId);checks++;
}
const overlap=layout([mk(lower.id,0),mk('appliance-stove',0)]);assert.equal(overlap.length,1);near(overlap[0].width,.6);checks++;
assert.deepEqual(layout([mk(lower.id,0)],false),layout([mk(lower.id,0)],true));checks++;
console.log(`Passed ${checks} backsplash stove scenarios (geometry and UV, no browser)`);

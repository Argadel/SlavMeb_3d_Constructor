import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as appliances from '../public/src/appliances.js';
import * as depth from '../public/src/module-depth.js';
import * as dimensions from '../public/src/dimensions.js';
import * as backsplash from '../public/src/backsplash.js';
import * as worktops from '../public/src/worktop-order.js';
import * as catalog from '../public/data/catalog.js';
import * as prices from '../public/data/worktop-prices.js';
import * as pricing from '../public/src/pricing.js';
// Execute the actual planner functions with minimal Three/DOM test doubles.
// This is a logic/geometry test, not a WebGL or browser test.
class V {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})} set(x,y,z){Object.assign(this,{x,y,z});return this}}
class B {setFromCenterAndSize(c,s){this.min=new V(c.x-s.x/2,c.y-s.y/2,c.z-s.z/2);this.max=new V(c.x+s.x/2,c.y+s.y/2,c.z+s.z/2);return this}expandByScalar(v){for(const k of ['x','y','z']){this.min[k]-=v;this.max[k]+=v}return this}intersectsBox(b){return ['x','y','z'].every(k=>this.max[k]>=b.min[k]&&this.min[k]<=b.max[k])}}
class Group{constructor(){this.children=[];this.userData={};this.position=new V();this.rotation={y:0}}add(o){this.children.push(o)}traverse(fn){fn(this);for(const o of this.children)o.traverse(fn)}}
class Mesh extends Group{constructor(geometry,material){super();Object.assign(this,{geometry,material,isMesh:true})}}
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},options:[],style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},replaceChildren(){}});return nodes.get(id)};
const storage=new Map();
const THREE={Vector2:V,Vector3:V,Raycaster:class{},Plane:class{},Box3:B,Group,Mesh,BoxGeometry:class{constructor(w,h,d){this.parameters={width:w,height:h,depth:d}}},CylinderGeometry:class{constructor(r,_,h){this.parameters={width:2*r,height:h,depth:2*r}}},MeshStandardMaterial:class{constructor(a){Object.assign(this,a)}}};
const ctx=vm.createContext({...appliances,...depth,...dimensions,...backsplash,...worktops,...catalog,...prices,...pricing,THREE,document:{getElementById:node,querySelector:node},localStorage:{setItem(k,v){storage.set(k,v)},getItem(k){return storage.get(k)}},console});
let source=fs.readFileSync(new URL('../public/src/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
source=source.replace(/initUI\(\);\s*init2DPlan\(\);\s*try \{[\s\S]*?\n\}\nrefreshPricing\(\);[^\n]*\n\nfunction initUI\(/,'function initUI(');
vm.runInContext(source,ctx);
const run=js=>vm.runInContext(js,ctx);
run(`showToast=(...a)=>{globalThis.lastToast=a};rebuildModules=()=>{};syncCountertopUI=()=>{};syncWorktopOrderUI=()=>{};syncSelectedMaterialUI=()=>{};syncRoomFields=()=>{};renderModuleTabs=()=>{};renderCatalog=()=>{};renderFacadeOptions=()=>{};renderCountertopOptions=()=>{};syncViewToggles=()=>{};`);
let checks=0;const check=(fn)=>{fn();checks++};
const lower=catalog.CATALOG.find(m=>m.category==='lower'&&m.width===600);const upper=catalog.CATALOG.find(m=>m.category==='upper720'&&m.width===600);
const mk=(uid,moduleId,coord,wallId='north',appliance)=>({uid,moduleId,coord,wallId,elevation:0,appliance});
const set=(items)=>{ctx.testItems=items;run('state.items=testItems;state.selectedId=null;state.room={width:3200,depth:3000,height:2600};state.orderWorktop=true;')};
for(const a of appliances.APPLIANCES){
 for(const width of [300,600,1000])for(const wall of ['north','east','south','west']){
  const spec={width,depth:700,height:a.height,sideGap:20,backGap:30,topGap:50};const item=mk('a',a.id,0,wall,spec);set([item]);
  check(()=>assert.equal(run('getModule(state.items[0].moduleId,state.items[0]).width'),width));
  check(()=>assert.equal(run('hasCollision("a")'),false));
  const bounds=run('logicalCollisionBoxes(state.items[0])[0]');
  check(()=>assert.ok(Math.abs((bounds.max.y-bounds.min.y)-(a.height+50)/1000)<.001));
  const model=run('buildModule(state.items[0],{preview:true})');
  check(()=>{for(const m of model.children){const d=m.geometry.parameters,p=m.position;assert.ok(Math.abs(p.x)+d.width/2<=width/2000+1e-8);assert.ok(p.y-d.height/2>=-1e-8&&p.y+d.height/2<=a.height/1000+1e-8);assert.ok(p.z-d.depth/2>=-1e-8&&p.z+d.depth/2<=.7+1e-8);assert.equal(m.userData.part,'appliance');}});
  check(()=>{const ds=run('layoutModuleDimensions(state.items,state.room,getModule)');assert.equal(ds.find(d=>d.kind==='width').value,width);assert.equal(ds.find(d=>d.kind==='height').value,a.height);});
 }
}
set([mk('a','appliance-fridge',0,'north',{width:600,sideGap:20,topGap:50}),mk('b',lower.id,.62)]);
check(()=>assert.equal(run('hasCollision("a")'),false)); // .32+.30=.62; touching reserved side boundary
check(()=>{run('state.items[1].coord=.61');assert.equal(run('hasCollision("a")'),true);});
check(()=>{run('state.items[1].coord=.65');assert.ok(Math.abs(run('snapCoord(state.items[1],getModule(state.items[1].moduleId,state.items[1]))')-.62)<1e-7);});
set([mk('a','appliance-fridge',0,'north',{height:1850,topGap:50}),{...mk('b',upper.id,0),elevation:1890}]);
check(()=>assert.equal(run('hasCollision("a")'),true));
check(()=>{run('state.items[1].elevation=1900');assert.equal(run('hasCollision("a")'),false);});
set([mk('a','appliance-stove',0),mk('b',lower.id,-.6),mk('c',lower.id,.6)]);
check(()=>assert.equal(run('getWorktopOrder().runs.length'),2));
check(()=>assert.equal(run('getWorktopOrder().cost'),4500));
check(()=>{run('updateSidebar()');assert.equal(node('module-count').textContent,2);assert.ok(!node('spec').innerHTML.includes('Кухонная плита'));assert.ok(!node('spec').innerHTML.includes('appliance-'));assert.equal(node('total-price').textContent,new Intl.NumberFormat('ru-RU').format(lower.price*2+4500)+' ₽');});
check(()=>assert.equal(run('layoutBacksplash(state.items,state.room,getModule,getLowerWorktopSpan).length'),2));
set([mk('a','appliance-fridge',0)]);
check(()=>{run('updateSidebar()');assert.equal(node('module-count').textContent,0);assert.equal(node('total-price').textContent,'0 ₽');assert.ok(node('spec').innerHTML.includes('Смета пока пуста'));});
check(()=>{run('state.selectedId="a";updateSidebar()');for(const [k,v] of Object.entries({width:750,depth:720,height:2000,sideGap:20,backGap:30,topGap:50}))node('appliance-'+k).value=String(v);run('applyApplianceFields()');assert.equal(run('state.items[0].appliance.width'),750);assert.equal(run('installedFrontMM(getModule(state.items[0].moduleId,state.items[0]))'),750);});
check(()=>{run('saveLocal();state.items=[];restoreLocal()');assert.equal(run('state.items[0].appliance.width'),750);assert.equal(run('state.items[0].appliance.topGap'),50);});
check(()=>{run('state.selectedId="a";deleteSelected()');assert.equal(run('state.items.length'),0);});
set([]);check(()=>{run('addModule("appliance-fridge");addModule("appliance-stove")');assert.equal(run('state.items.length'),2);assert.equal(run('state.items.some(i=>hasCollision(i.uid))'),false);});
check(()=>{run('state.items[0].appliance.width=800');assert.equal(run('getModule(state.items[1].moduleId,state.items[1]).width'),600);});
check(()=>{run('state.items[0].appliance.height=2500;state.items[0].appliance.topGap=150');assert.equal(run('hasCollision(state.items[0].uid)'),true);});
set([mk('m',lower.id,0)]);
check(()=>{run('CATALOG.find(m=>m.id==="1.1.4").price=3000;currentPromo={active:true,name:"Тест",target:"furniture",percent:10};currentStockPrices=[{length:1000,price:3500},{length:1500,price:5000}];worktopPlanCache.clear();updateSidebar()');assert.equal(node('total-price').textContent,new Intl.NumberFormat('ru-RU').format(6200)+' ₽');assert.ok(node('spec').innerHTML.includes('Скидка 10%'));});
check(()=>{run('state.orderWorktop=false;updateSidebar()');assert.equal(node('total-price').textContent,new Intl.NumberFormat('ru-RU').format(2700)+' ₽');});
console.log(`Passed ${checks} appliance logic/geometry scenarios (no browser)`);

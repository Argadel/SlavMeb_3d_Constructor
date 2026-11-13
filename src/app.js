import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, FACADE_MATERIALS, COUNTERTOP_MATERIALS } from '../data/catalog.js';

const MM = 0.001;
const fmt = new Intl.NumberFormat('ru-RU');
const WALL_NAMES = { north:'Северная', east:'Правая', south:'Южная', west:'Левая' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_UPPER_ELEVATION = 1450;

const MODULE_CATEGORIES = [
  {id:'lower', label:'Нижние'},
  {id:'upper720', label:'Верхние 720'},
  {id:'upper900', label:'Верхние 900'},
  {id:'antresol', label:'Антресоли'},
  {id:'pantry', label:'Пеналы'},
];

const state = {
  room: { width: 3200, depth: 3000, height: 2600 },
  materialId: FACADE_MATERIALS[0].id, // fallback/default for first module
  countertopMaterialId: COUNTERTOP_MATERIALS[0].id,
  countertopThickness: 38,
  items: [],
  selectedId: null,
  nextId: 1,
  mode: 'room',
  moduleTab: 'lower',
};

const viewport = document.getElementById('viewport');
const room2d = document.getElementById('room-2d');
const planSvg = document.getElementById('room-plan-svg');
const planGroup = document.getElementById('plan-room-group');
const planStage = document.getElementById('plan-stage');
const loading = document.getElementById('loading');
const dragStatus = document.getElementById('drag-status');

let scene, camera, renderer, controls, roomGroup, modulesGroup, directionArrowsGroup, selectionBox;
let walls = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
let drag = null;
let planDrag = null;
let planPan = null;
let planView = null;
let planCamera = null;
let toastTimer = null;
let floorTexture = null;
let materialModalType = null;
let materialModalCategory = 'all';
let materialModalSearch = '';


initUI();
init2DPlan();
try {
  init3D();
  restoreLocal();
  rebuildAll();
  render2DPlan({fit:true});
  setWorkspaceMode(state.mode || 'room');
  loading.classList.add('hidden');
} catch (e) {
  console.error(e);
  loading.classList.add('hidden');
  document.getElementById('webgl-error').classList.remove('hidden');
}

function initUI(){
  document.querySelectorAll('.workspace-tab').forEach(btn => {
    btn.onclick = () => setWorkspaceMode(btn.dataset.mode);
  });
  document.getElementById('go-modules').onclick = () => setWorkspaceMode('modules');

  renderModuleTabs();
  renderCatalog();

  document.getElementById('facade-category').onchange = renderFacadeOptions;
  document.getElementById('facade-select').onchange = () => {
    const item=findItem(state.selectedId);
    if(!item) return;
    item.materialId=document.getElementById('facade-select').value;
    state.materialId=item.materialId;
    syncSelectedMaterialUI(); rebuildModules(); saveLocal();
  };
  document.getElementById('facade-open').onclick = () => openMaterialModal('facade');
  document.getElementById('countertop-open').onclick = () => openMaterialModal('countertop');
  document.getElementById('material-modal-close').onclick = closeMaterialModal;
  document.querySelectorAll('[data-material-close]').forEach(el => el.onclick = closeMaterialModal);
  document.getElementById('material-search').oninput = e => { materialModalSearch=e.target.value.trim().toLowerCase(); renderMaterialModal(); };
  document.addEventListener('keydown', e => { if(e.key==='Escape' && !document.getElementById('material-modal').classList.contains('hidden')) closeMaterialModal(); });
  document.getElementById('apply-facade-all').onclick = () => {
    const item=findItem(state.selectedId); if(!item) return;
    state.items.forEach(i=>i.materialId=item.materialId);
    state.materialId=item.materialId; rebuildModules(); saveLocal(); syncSelectedMaterialUI();
    showToast('Фасад применён','Выбранный декор установлен на все модули кухни.');
  };
  document.getElementById('countertop-thickness').onchange = () => {
    state.countertopThickness=+document.getElementById('countertop-thickness').value;
    renderCountertopOptions(true); rebuildModules(); saveLocal();
  };
  document.getElementById('countertop-category').onchange = () => renderCountertopOptions(false);
  document.getElementById('countertop-select').onchange = () => {
    state.countertopMaterialId=document.getElementById('countertop-select').value;
    syncCountertopUI(); rebuildModules(); saveLocal();
  };
  renderFacadeOptions();
  renderCountertopOptions(true);
  syncSelectedMaterialUI();
  syncCountertopUI();

  const applyRoomFromFields = ({notify=true}={}) => {
    const w = clamp(+document.getElementById('room-width').value || 3200, 1800, 8000);
    const d = clamp(+document.getElementById('room-depth').value || 3000, 1800, 8000);
    const h = clamp(+document.getElementById('room-height').value || 2600, 2200, 4200);
    setRoomDimensions(w,d,h,{resetCamera: state.mode === 'modules', fitPlan:true});
    if(notify) showToast('Изменения применены', `Размеры помещения: ${Math.round(w)} × ${Math.round(d)} × ${Math.round(h)} мм.`);
  };
  document.getElementById('apply-room').onclick = () => applyRoomFromFields({notify:true});
  document.getElementById('plan-fit').onclick = () => resetPlanViewport();
  ['room-width','room-depth','room-height'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if(e.key === 'Enter') applyRoomFromFields({notify:true});
    });
  });

  document.getElementById('reset-view').onclick = resetView;
  document.getElementById('delete-selected').onclick = deleteSelected;
  document.getElementById('apply-selection-height').onclick = applySelectedHeightFromField;
  document.getElementById('selection-height').addEventListener('keydown', e => {
    if(e.key === 'Enter') applySelectedHeightFromField();
  });

  document.getElementById('toast-close').onclick = hideToast;
  document.getElementById('clear-project').onclick = () => {
    if (!state.items.length || confirm('Очистить тестовый проект?')) {
      state.items = []; state.selectedId = null; rebuildModules(); saveLocal();
    }
  };
  document.getElementById('save-project').onclick = () => {
    saveLocal();
    const b = document.getElementById('save-project');
    const old = b.textContent; b.textContent = 'Сохранено ✓';
    setTimeout(()=>b.textContent=old,1200);
  };
}

function showToast(title, text, timeout=3200){
  const toast=document.getElementById('toast');
  document.getElementById('toast-title').textContent=title;
  document.getElementById('toast-text').textContent=text;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(hideToast,timeout);
}
function hideToast(){
  clearTimeout(toastTimer);
  document.getElementById('toast').classList.add('hidden');
}

function renderModuleTabs(){
  const root=document.getElementById('module-tabs');
  root.innerHTML='';
  MODULE_CATEGORIES.forEach(cat=>{
    const count=CATALOG.filter(m=>m.category===cat.id).length;
    const b=document.createElement('button');
    b.type='button';
    b.className='module-tab'+(state.moduleTab===cat.id?' active':'');
    b.innerHTML=`${cat.label}<span class="module-tab-count">${count}</span>`;
    b.onclick=()=>{state.moduleTab=cat.id;renderModuleTabs();renderCatalog();};
    root.appendChild(b);
  });
}

function renderCatalog(){
  const catalog=document.getElementById('catalog');
  catalog.innerHTML='';
  const modules=CATALOG.filter(m=>m.category===state.moduleTab);
  if(!modules.length){
    const cat=MODULE_CATEGORIES.find(c=>c.id===state.moduleTab);
    catalog.innerHTML=`<div class="catalog-empty">В категории «${cat?.label||''}» пока нет тестовых моделей.<br>Добавим их после проверки механики.</div>`;
    return;
  }
  modules.forEach(m => {
    const card = document.createElement('div');
    card.className = 'catalog-card';
    const extra = m.wallMount==='wall' ? `<div class="catalog-extra">Стандартная высота низа: ${m.defaultElevation || DEFAULT_UPPER_ELEVATION} мм</div>` : '';
    card.innerHTML = `
      <div class="catalog-head">
        <div><div class="catalog-name">${m.name}</div><div class="catalog-sku">${m.sku} · арт. ${m.id}</div></div>
        <div class="catalog-price">${fmt.format(m.price)} ₽</div>
      </div>
      <div class="catalog-dims">Ш${m.width} × Г${m.depth} × В${m.height} мм</div>
      ${extra}
      <button class="btn btn-primary btn-full">Добавить модуль</button>`;
    card.querySelector('button').onclick = () => addModule(m.id);
    catalog.appendChild(card);
  });
}

function setWorkspaceMode(mode){
  state.mode = mode === 'modules' ? 'modules' : 'room';
  document.querySelectorAll('.workspace-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mode===state.mode));
  document.getElementById('room-panel').classList.toggle('hidden', state.mode!=='room');
  document.getElementById('modules-panel').classList.toggle('hidden', state.mode!=='modules');
  document.getElementById('room-right-panel').classList.toggle('hidden', state.mode!=='room');
  document.getElementById('modules-right-panel').classList.toggle('hidden', state.mode!=='modules');
  room2d.classList.toggle('hidden', state.mode!=='room');
  viewport.classList.toggle('hidden', state.mode!=='modules');
  document.getElementById('reset-view').classList.toggle('hidden', state.mode!=='modules');
  if(state.mode==='room'){
    render2DPlan();
  }else{
    requestAnimationFrame(()=>{ onResize(); rebuildAll(); resetView(); });
  }
  saveLocal();
}

function setRoomDimensions(w,d,h,{resetCamera=false,fitPlan=false}={}){
  state.room.width=Math.round(clamp(w,1800,8000));
  state.room.depth=Math.round(clamp(d,1800,8000));
  state.room.height=Math.round(clamp(h,2200,4200));
  syncRoomFields();
  state.items.forEach(item=>clampItemToWall(item));
  rebuildAll();
  if(fitPlan) planView=null;
  render2DPlan({fit:fitPlan});
  saveLocal();
  if(resetCamera && camera) resetView();
}

function syncRoomFields(){
  document.getElementById('room-width').value=state.room.width;
  document.getElementById('room-depth').value=state.room.depth;
  document.getElementById('room-height').value=state.room.height;
  document.getElementById('room-summary-width').textContent=state.room.width+' мм';
  document.getElementById('room-summary-depth').textContent=state.room.depth+' мм';
  document.getElementById('room-summary-height').textContent=state.room.height+' мм';
}

/* ================= 2D ROOM EDITOR ================= */
function init2DPlan(){
  resetPlanViewport();
  planSvg.addEventListener('pointerdown', onPlanCanvasPointerDown);
  planSvg.addEventListener('pointermove', onPlanPointerMove);
  planSvg.addEventListener('pointerup', onPlanPointerUp);
  planSvg.addEventListener('pointerleave', onPlanPointerUp);
  planSvg.addEventListener('pointercancel', onPlanPointerUp);
  planSvg.addEventListener('wheel', onPlanWheel, {passive:false});
  planSvg.addEventListener('contextmenu', e=>e.preventDefault());
  window.addEventListener('resize', ()=>{ if(state.mode==='room') { render2DPlan(); applyPlanViewport(); } });
}

function fitPlanView(){
  const W=state.room.width,D=state.room.depth;
  const scale=Math.min(720/W, 470/D);
  const rw=W*scale,rh=D*scale;
  planView={left:500-rw/2,right:500+rw/2,top:350-rh/2,bottom:350+rh/2,scale};
}

function ensurePlanCamera(){
  if(!planCamera) planCamera={cx:500,cy:350,zoom:1};
}
function applyPlanViewport(){
  ensurePlanCamera();
  planCamera.zoom=clamp(planCamera.zoom,0.35,4.0);
  const vw=1000/planCamera.zoom,vh=700/planCamera.zoom;
  // Сетка большая и не привязана к размеру комнаты. Ограничение только защитное,
  // чтобы пользователь не ушёл на десятки экранов от проекта.
  planCamera.cx=clamp(planCamera.cx,-9000+vw/2,9000-vw/2);
  planCamera.cy=clamp(planCamera.cy,-9000+vh/2,9000-vh/2);
  planSvg.setAttribute('viewBox',`${planCamera.cx-vw/2} ${planCamera.cy-vh/2} ${vw} ${vh}`);
}
function resetPlanViewport(){
  planCamera={cx:500,cy:350,zoom:1};
  applyPlanViewport();
}

function render2DPlan({fit=false}={}){
  if(!planGroup)return;
  if(fit || !planView) fitPlanView();
  planGroup.innerHTML='';
  const W=state.room.width,D=state.room.depth;
  const {left:x,right,top:y,bottom,scale}=planView;
  const rw=right-x,rh=bottom-y;

  svgEl('rect',{x,y,width:rw,height:rh,class:'plan-room-fill'});
  svgEl('text',{x:x+rw/2,y:y+rh/2,class:'plan-room-label'},`Комната ${W} × ${D} мм · высота ${state.room.height} мм`);

  const walls={
    north:{x1:x,y1:y,x2:right,y2:y,hx:x+rw/2,hy:y},
    south:{x1:x,y1:bottom,x2:right,y2:bottom,hx:x+rw/2,hy:bottom},
    west:{x1:x,y1:y,x2:x,y2:bottom,hx:x,hy:y+rh/2},
    east:{x1:right,y1:y,x2:right,y2:bottom,hx:right,hy:y+rh/2},
  };
  Object.entries(walls).forEach(([id,g])=>{
    const line=svgEl('line',{x1:g.x1,y1:g.y1,x2:g.x2,y2:g.y2,class:'plan-wall','data-wall':id});
    const handle=svgEl('circle',{cx:g.hx,cy:g.hy,r:9,class:'plan-handle','data-wall':id});
    [line,handle].forEach(el=>el.addEventListener('pointerdown',e=>onPlanPointerDown(e,id,scale)));
  });
  drawHorizontalDimension(x,y-32,rw,W);
  drawHorizontalDimension(x,bottom+32,rw,W);
  drawVerticalDimension(x-66,y,rh,D);
  drawVerticalDimension(right+66,y,rh,D);
  applyPlanViewport();
}

function drawHorizontalDimension(x,y,w,value){
  svgEl('line',{x1:x,y1:y,x2:x+w,y2:y,class:'plan-dim-line'});
  svgEl('line',{x1:x,y1:y-6,x2:x,y2:y+6,class:'plan-dim-tick'});
  svgEl('line',{x1:x+w,y1:y-6,x2:x+w,y2:y+6,class:'plan-dim-tick'});
  const bw=76,bh=27;
  svgEl('rect',{x:x+w/2-bw/2,y:y-bh/2,width:bw,height:bh,rx:6,class:'plan-dim-bg'});
  svgEl('text',{x:x+w/2,y,class:'plan-dim-text'},String(value));
}
function drawVerticalDimension(x,y,h,value){
  svgEl('line',{x1:x,y1:y,x2:x,y2:y+h,class:'plan-dim-line'});
  svgEl('line',{x1:x-6,y1:y,x2:x+6,y2:y,class:'plan-dim-tick'});
  svgEl('line',{x1:x-6,y1:y+h,x2:x+6,y2:y+h,class:'plan-dim-tick'});
  const bw=76,bh=27;
  svgEl('rect',{x:x-bw/2,y:y+h/2-bh/2,width:bw,height:bh,rx:6,class:'plan-dim-bg'});
  svgEl('text',{x,y:y+h/2,class:'plan-dim-text'},String(value));
}
function svgEl(tag,attrs={},text=''){
  const el=document.createElementNS(SVG_NS,tag);
  Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));
  if(text)el.textContent=text;
  planGroup.appendChild(el);
  return el;
}
function planPoint(e){
  const r=planSvg.getBoundingClientRect();
  const viewBox=planSvg.viewBox.baseVal;
  const vx=viewBox && viewBox.width ? viewBox.x : 0;
  const vy=viewBox && viewBox.height ? viewBox.y : 0;
  const vw=viewBox && viewBox.width ? viewBox.width : 1000;
  const vh=viewBox && viewBox.height ? viewBox.height : 700;
  return {x:vx+((e.clientX-r.left)/r.width)*vw,y:vy+((e.clientY-r.top)/r.height)*vh};
}
function onPlanCanvasPointerDown(e){
  // Навигация по плану — ПКМ, как в 3D. ЛКМ остаётся для изменения стен.
  if(e.button!==2) return;
  e.preventDefault();
  ensurePlanCamera();
  const r=planSvg.getBoundingClientRect();
  const viewBox=planSvg.viewBox.baseVal;
  planPan={
    pointerId:e.pointerId,
    startClientX:e.clientX,
    startClientY:e.clientY,
    startCamera:{...planCamera},
    worldPerPxX:viewBox.width/Math.max(r.width,1),
    worldPerPxY:viewBox.height/Math.max(r.height,1)
  };
  planSvg.setPointerCapture?.(e.pointerId);
  planStage.classList.add('panning');
}
function onPlanWheel(e){
  if(state.mode!=='room') return;
  e.preventDefault();
  ensurePlanCamera();
  const before=planPoint(e);
  const factor=e.deltaY>0?0.92:1.08;
  const nextZoom=clamp(planCamera.zoom*factor,0.35,4.0);
  const prevZoom=planCamera.zoom;
  if(nextZoom===prevZoom) return;
  planCamera.zoom=nextZoom;
  const nextVw=1000/planCamera.zoom, nextVh=700/planCamera.zoom;
  const rx=(before.x-(planCamera.cx-(1000/prevZoom)/2))/((1000/prevZoom));
  const ry=(before.y-(planCamera.cy-(700/prevZoom)/2))/((700/prevZoom));
  planCamera.cx=before.x-(rx*nextVw-nextVw/2);
  planCamera.cy=before.y-(ry*nextVh-nextVh/2);
  applyPlanViewport();
}
function onPlanPointerDown(e,wall,scale){
  if(e.button!==0) return;
  e.preventDefault(); e.stopPropagation();
  const p=planPoint(e);
  planDrag={wall,startX:p.x,startY:p.y,scale,startView:{...planView}};
  planSvg.setPointerCapture?.(e.pointerId);
  document.querySelectorAll(`[data-wall="${wall}"]`).forEach(el=>el.classList.add('dragging'));
}
function onPlanPointerMove(e){
  if(planPan){
    const dx=e.clientX-planPan.startClientX;
    const dy=e.clientY-planPan.startClientY;
    planCamera.cx=planPan.startCamera.cx-dx*planPan.worldPerPxX;
    planCamera.cy=planPan.startCamera.cy-dy*planPan.worldPerPxY;
    applyPlanViewport();
    return;
  }
  if(!planDrag)return;
  const p=planPoint(e);
  const v={...planDrag.startView};
  const scale=planDrag.scale;

  if(planDrag.wall==='east'){
    const width=Math.round(clamp((p.x-v.left)/scale,1800,8000)/10)*10;
    v.right=v.left+width*scale;
    state.room.width=width;
  }
  if(planDrag.wall==='west'){
    const width=Math.round(clamp((v.right-p.x)/scale,1800,8000)/10)*10;
    v.left=v.right-width*scale;
    state.room.width=width;
  }
  if(planDrag.wall==='south'){
    const depth=Math.round(clamp((p.y-v.top)/scale,1800,8000)/10)*10;
    v.bottom=v.top+depth*scale;
    state.room.depth=depth;
  }
  if(planDrag.wall==='north'){
    const depth=Math.round(clamp((v.bottom-p.y)/scale,1800,8000)/10)*10;
    v.top=v.bottom-depth*scale;
    state.room.depth=depth;
  }

  planView=v;
  syncRoomFields();
  state.items.forEach(item=>clampItemToWall(item));
  buildRoom(); rebuildModules(); updateRoomLabel(); render2DPlan();
}
function onPlanPointerUp(){
  if(planPan){
    planPan=null;
    planStage.classList.remove('panning');
  }
  if(!planDrag)return;
  planDrag=null;
  document.querySelectorAll('.plan-wall,.plan-handle').forEach(el=>el.classList.remove('dragging'));
  saveLocal();
}

/* ================= 3D ================= */
function init3D(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xece8e1);
  const hostRect = viewport.parentElement.getBoundingClientRect();
  const initW = Math.max(480, hostRect.width || viewport.clientWidth || 900);
  const initH = Math.max(420, hostRect.height || viewport.clientHeight || 650);
  camera = new THREE.PerspectiveCamera(44, initW/initH, .05, 50);
  renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
  renderer.setSize(initW, initH);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  viewport.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .07;
  controls.maxPolarAngle = Math.PI/2.02;
  controls.minPolarAngle = .17;
  controls.minDistance = 1.2;
  controls.maxDistance = 12;
  controls.target.set(0, 1.05, 0);

  const hemi = new THREE.HemisphereLight(0xfffcf7, 0xb9b3aa, 0.64);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff5e8, 1.75);
  sun.position.set(4.5, 6.5, 5.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=6;sun.shadow.camera.bottom=-6;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdbe7f2, .28);
  fill.position.set(-4,3,-3);
  scene.add(fill);

  floorTexture = new THREE.TextureLoader().load('./assets/textures/floor-laminate.jpg',()=>{
    if(roomGroup) buildRoom();
  });
  floorTexture.wrapS=floorTexture.wrapT=THREE.RepeatWrapping;
  floorTexture.colorSpace=THREE.SRGBColorSpace;
  floorTexture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);

  roomGroup = new THREE.Group(); scene.add(roomGroup);
  modulesGroup = new THREE.Group(); scene.add(modulesGroup);
  directionArrowsGroup = new THREE.Group(); scene.add(directionArrowsGroup);
  selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xc82026);
  selectionBox.visible = false; scene.add(selectionBox);

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', onResize);
  resetView();
  animate();
}

function resetView(){
  if(!camera)return;
  const W=state.room.width*MM,D=state.room.depth*MM,H=state.room.height*MM;
  const vfov=THREE.MathUtils.degToRad(camera.fov);
  const distForHeight=H/(2*Math.tan(vfov/2));
  const distForWidth=W/(2*Math.tan(vfov/2)*Math.max(camera.aspect,.5));
  const dist=Math.max(distForHeight,distForWidth)+.9;
  const targetY=Math.min(H*.46,1.35);
  camera.position.set(0, Math.min(H*.62,1.95), D/2+dist);
  controls.target.set(0,targetY,0);
  controls.update();
  updateWallVisibility(true);
}

function rebuildAll(){
  buildRoom();
  rebuildModules();
  updateRoomLabel();
}

function buildRoom(){
  if(!roomGroup)return;
  clearGroup(roomGroup);
  walls = [];
  const W=state.room.width*MM, D=state.room.depth*MM, H=state.room.height*MM;

  if(floorTexture){
    floorTexture.repeat.set(Math.max(1,W/1.4),Math.max(1,D/1.7));
    floorTexture.needsUpdate=true;
  }
  const floorMat = new THREE.MeshStandardMaterial({map:floorTexture || null,color:floorTexture?0xffffff:0xd9dde0,roughness:.88,metalness:0});
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W,D), floorMat);
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; floor.userData.kind='floor';
  roomGroup.add(floor);
  roomGroup.add(createExtendedGrid(W,D,1.0,.1));

  const wallMat = () => new THREE.MeshStandardMaterial({color:0xf3efe9,roughness:.93,transparent:true,opacity:.88,side:THREE.DoubleSide});
  const thickness=.035;
  createWall('north', new THREE.BoxGeometry(W,H,thickness), new THREE.Vector3(0,H/2,-D/2), wallMat());
  createWall('south', new THREE.BoxGeometry(W,H,thickness), new THREE.Vector3(0,H/2, D/2), wallMat());
  createWall('west', new THREE.BoxGeometry(thickness,H,D), new THREE.Vector3(-W/2,H/2,0), wallMat());
  createWall('east', new THREE.BoxGeometry(thickness,H,D), new THREE.Vector3( W/2,H/2,0), wallMat());
}

function createExtendedGrid(W,D,margin=1,step=.1){
  const x0=-W/2-margin,x1=W/2+margin,z0=-D/2-margin,z1=D/2+margin;
  const minor=[],major=[];
  const push=(arr,a,b,c,d)=>arr.push(a,.004,b,c,.004,d);
  const startX=Math.floor(x0/step)*step,endX=Math.ceil(x1/step)*step;
  const startZ=Math.floor(z0/step)*step,endZ=Math.ceil(z1/step)*step;
  let i=0;
  for(let x=startX;x<=endX+.0001;x+=step){
    const arr=Math.abs(Math.round(x/step))%5===0?major:minor;push(arr,x,z0,x,z1);i++;
  }
  for(let z=startZ;z<=endZ+.0001;z+=step){
    const arr=Math.abs(Math.round(z/step))%5===0?major:minor;push(arr,x0,z,x1,z);
  }
  const g=new THREE.Group();
  const make=(positions,color,opacity)=>{
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const mat=new THREE.LineBasicMaterial({color,transparent:true,opacity});
    return new THREE.LineSegments(geo,mat);
  };
  g.add(make(minor,0xc7cdd3,.36));
  g.add(make(major,0x9da5ad,.46));
  return g;
}

function createWall(id, geom, pos, mat){
  const mesh=new THREE.Mesh(geom,mat); mesh.position.copy(pos); mesh.receiveShadow=true; mesh.userData.wallId=id;
  roomGroup.add(mesh);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geom),new THREE.LineBasicMaterial({color:0xb9b2aa,transparent:true,opacity:.28}));
  edges.position.copy(pos); roomGroup.add(edges);
  walls.push({id,mesh,edges});
}

/* ================= MODULES ================= */
function addModule(moduleId){
  const m = getModule(moduleId);
  const wallId='north';
  const sameRow=state.items.filter(i=>i.wallId===wallId && getModule(i.moduleId)?.wallMount===m.wallMount);
  const pos = -state.room.width*MM/2 + m.width*MM/2 + sameRow.length*(m.width*MM+.02);
  const inheritedMaterialId = state.items.length
    ? (state.items[state.items.length-1].materialId || state.materialId || FACADE_MATERIALS[0].id)
    : (state.materialId || FACADE_MATERIALS[0].id);
  const item={
    uid:'m'+state.nextId++,moduleId,wallId,coord:pos,
    elevation:m.wallMount==='wall' ? (m.defaultElevation || DEFAULT_UPPER_ELEVATION) : 0,
    materialId: inheritedMaterialId,
    lastValid:null
  };
  clampItemToWall(item);
  state.items.push(item); state.selectedId=item.uid;
  rebuildModules(); saveLocal();
}

function rebuildModules(){
  if(!modulesGroup)return;
  clearGroup(modulesGroup);
  state.items.forEach(item=>{
    const g=buildModule(item);
    modulesGroup.add(g);
  });
  refreshSelectionBox();
  refreshDirectionArrow();
  updateSidebar();
}

function refreshDirectionArrow(){
  if(!directionArrowsGroup) return;
  clearGroup(directionArrowsGroup);
  const item=findItem(state.selectedId);
  if(!item) return;
  const m=getModule(item.moduleId);
  if(!m) return;
  const arrow=buildFrontDirectionArrow(item,m);
  directionArrowsGroup.add(arrow);
}

function buildModule(item){
  const m=getModule(item.moduleId);
  if(m.category==='pantry') return buildPantryModule(item,m);
  if(m.wallMount==='wall') return buildUpperModule(item,m);
  return buildLowerModule(item,m);
}

function commonModuleMaterials(materialId){
  return {
    body:new THREE.MeshStandardMaterial({color:0xe5e1da,roughness:.78}),
    inside:new THREE.MeshStandardMaterial({color:0xf0ede7,roughness:.82}),
    handle:new THREE.MeshStandardMaterial({color:0x343536,roughness:.42,metalness:.42}),
    plinth:new THREE.MeshStandardMaterial({color:0xc7c2bb,roughness:.8}),
    top:createCountertopMaterial(state.countertopMaterialId),
    facade:createFacadeMaterial(materialId)
  };
}

function getLowerWorktopSpan(item,m){
  // Keep the small 9 mm side overhang only on exposed cabinet ends.
  // When another floor module touches this module, both worktops stop exactly
  // at the joint instead of overlapping in the same plane (z-fighting).
  const W=m.width*MM;
  const leftEdge=item.coord-W/2;
  const rightEdge=item.coord+W/2;
  const overhang=.009;
  const tolerance=.012;
  let leftBlocked=false,rightBlocked=false;

  state.items.forEach(other=>{
    if(other.uid===item.uid || other.wallId!==item.wallId) return;
    const om=getModule(other.moduleId);
    if(!om || om.wallMount==='wall') return;
    const oHalf=om.width*MM/2;
    const oLeft=other.coord-oHalf;
    const oRight=other.coord+oHalf;
    if(Math.abs(oRight-leftEdge)<=tolerance) leftBlocked=true;
    if(Math.abs(oLeft-rightEdge)<=tolerance) rightBlocked=true;
  });

  const leftExt=leftBlocked?0:overhang;
  const rightExt=rightBlocked?0:overhang;
  return {
    width:W+leftExt+rightExt,
    offsetX:(rightExt-leftExt)/2
  };
}

function buildLowerModule(item,m){
  const g=new THREE.Group();g.userData.itemId=item.uid;g.userData.moduleId=m.id;
  const W=m.width*MM,D=m.depth*MM,carc=m.carcassHeight*MM,plinth=m.plinthHeight*MM,board=.016;
  const mat=commonModuleMaterials(item.materialId);
  const y0=plinth;
  addBox(g,board,carc,D,-W/2+board/2,y0+carc/2,D/2,mat.body,'carcass');
  addBox(g,board,carc,D, W/2-board/2,y0+carc/2,D/2,mat.body,'carcass');
  addBox(g,W-2*board,board,D,0,y0+board/2,D/2,mat.body,'carcass');
  addBox(g,W-2*board,board,D-.025,0,y0+carc*.52,(D-.025)/2,mat.inside,'shelf');
  addBox(g,W-.03,plinth-.018,.018,0,plinth/2-.006,D-.015,mat.plinth,'plinth');
  const fh=m.facadeHeight*MM;
  const facade=addBox(g,W-.006,fh,.019,0,y0+fh/2-.003,D+.009,mat.facade,'facade');facade.userData.isFacade=true;
  addBox(g,Math.min(.32,W*.48),.018,.024,0,y0+fh-.055,D+.027,mat.handle,'handle');
  const worktopSpan=getLowerWorktopSpan(item,m);
  addBox(g,worktopSpan.width,.038,.60,worktopSpan.offsetX,(m.height*MM)+.019,.30,mat.top,'worktop');
  applyWallTransform(g,item);
  tagModuleMeshes(g,item.uid);
  return g;
}

function buildUpperModule(item,m){
  const g=new THREE.Group();g.userData.itemId=item.uid;g.userData.moduleId=m.id;
  const W=m.width*MM,D=m.depth*MM,H=m.height*MM,board=.016;
  const mat=commonModuleMaterials(item.materialId);
  addBox(g,board,H,D,-W/2+board/2,H/2,D/2,mat.body,'carcass');
  addBox(g,board,H,D, W/2-board/2,H/2,D/2,mat.body,'carcass');
  addBox(g,W-2*board,board,D,0,board/2,D/2,mat.body,'carcass');
  addBox(g,W-2*board,board,D,0,H-board/2,D/2,mat.body,'carcass');
  const shelfCount=Math.max(0,m.shelves||0);
  for(let i=1;i<=shelfCount;i++){
    const sy=H*(i/(shelfCount+1));
    addBox(g,W-2*board,board,D-.025,0,sy,(D-.025)/2,mat.inside,'shelf');
  }
  const fh=H-.008;
  if((m.doors||1)===1){
    const f=addBox(g,W-.008,fh,.019,0,H/2,D+.009,mat.facade,'facade');
    f.userData.isFacade=true;
    addBox(g,Math.min(.24,W*.42),.016,.022,0,.055,D+.027,mat.handle,'handle');
  }else{
    const gap=.004,fw=(W-gap*3)/2;
    const f1=addBox(g,fw,fh,.019,-fw/2-gap/2,H/2,D+.009,mat.facade,'facade');
    const f2=addBox(g,fw,fh,.019, fw/2+gap/2,H/2,D+.009,mat.facade,'facade');
    f1.userData.isFacade=f2.userData.isFacade=true;
    addBox(g,Math.min(.22,fw*.55),.016,.022,-fw/2-gap/2,.055,D+.027,mat.handle,'handle');
    addBox(g,Math.min(.22,fw*.55),.016,.022, fw/2+gap/2,.055,D+.027,mat.handle,'handle');
  }
  applyWallTransform(g,item);
  tagModuleMeshes(g,item.uid);
  return g;
}

function buildPantryModule(item,m){
  const g=new THREE.Group();g.userData.itemId=item.uid;g.userData.moduleId=m.id;
  const W=m.width*MM,D=m.depth*MM,H=m.height*MM,plinth=(m.plinthHeight||100)*MM,board=.016;
  const mat=commonModuleMaterials(item.materialId);
  const bodyH=H-plinth;
  const y0=plinth;
  addBox(g,board,bodyH,D,-W/2+board/2,y0+bodyH/2,D/2,mat.body,'carcass');
  addBox(g,board,bodyH,D, W/2-board/2,y0+bodyH/2,D/2,mat.body,'carcass');
  addBox(g,W-2*board,board,D,0,y0+board/2,D/2,mat.body,'carcass');
  addBox(g,W-2*board,board,D,0,H-board/2,D/2,mat.body,'carcass');
  addBox(g,W-.03,plinth-.018,.018,0,plinth/2-.006,D-.015,mat.plinth,'plinth');

  // Тестовая компоновка пенала ПД_2Д_2158: нижний фасад + ниша под духовку + верхний фасад.
  const ovenH=.595;
  const lowerH=Math.max(.46,Math.min(.62,bodyH*.27));
  const ovenY=y0+lowerH+ovenH/2+.015;
  const upperBottom=y0+lowerH+ovenH+.03;
  const upperH=Math.max(.30,H-upperBottom-.018);

  const lowerFacade=addBox(g,W-.008,lowerH-.012,.019,0,y0+(lowerH-.012)/2,D+.009,mat.facade,'facade');
  lowerFacade.userData.isFacade=true;
  addBox(g,Math.min(.26,W*.42),.018,.022,0,y0+lowerH-.055,D+.027,mat.handle,'handle');

  const ovenBody=new THREE.MeshStandardMaterial({color:0x202224,roughness:.28,metalness:.35});
  const ovenGlass=new THREE.MeshStandardMaterial({color:0x090b0d,roughness:.16,metalness:.12});
  addBox(g,W-.06,ovenH,.50,0,ovenY,.25,ovenBody,'appliance');
  addBox(g,W-.10,ovenH-.10,.018,0,ovenY-.015,D+.011,ovenGlass,'appliance');
  addBox(g,W-.13,.038,.024,0,ovenY+ovenH/2-.055,D+.030,mat.handle,'appliance-handle');

  const upperFacade=addBox(g,W-.008,upperH-.012,.019,0,upperBottom+(upperH-.012)/2,D+.009,mat.facade,'facade');
  upperFacade.userData.isFacade=true;
  addBox(g,Math.min(.26,W*.42),.018,.022,0,upperBottom+.055,D+.027,mat.handle,'handle');

  addBox(g,W-2*board,board,D-.025,0,upperBottom,(D-.025)/2,mat.inside,'shelf');
  applyWallTransform(g,item);
  tagModuleMeshes(g,item.uid);
  return g;
}

function buildFrontDirectionArrow(item,m){
  const g=new THREE.Group();
  g.userData.directionArrowFor=item.uid;

  const depth=m.depth*MM;
  const mat=new THREE.MeshBasicMaterial({
    color:0xffffff,
    transparent:true,
    opacity:.54,
    side:THREE.DoubleSide,
    depthWrite:false,
    depthTest:true
  });

  // Плоская стрелка-направление. Локальное +Z — лицевая сторона модуля.
  // Важно: геометрия стрелки строится около собственного нуля, а затем весь
  // указатель выносится перед фасадом. Так она не может «протянуться» через корпус.
  const halfShaft=.025;
  const halfHead=.065;
  const shaftLength=.070;
  const headLength=.075;
  const shape=new THREE.Shape();
  shape.moveTo(-halfShaft,0);
  shape.lineTo( halfShaft,0);
  shape.lineTo( halfShaft,shaftLength);
  shape.lineTo( halfHead,shaftLength);
  shape.lineTo(0,shaftLength+headLength);
  shape.lineTo(-halfHead,shaftLength);
  shape.lineTo(-halfShaft,shaftLength);
  shape.closePath();

  const arrow=new THREE.Mesh(new THREE.ShapeGeometry(shape),mat);
  // ShapeGeometry лежит в XY; поворачиваем её в XZ, чтобы стрелка указывала
  // от фасада наружу. Для настенных модулей опускаем её на 35 мм ниже нижней
  // кромки — визуально она отделена от корпуса и не сливается с фасадом.
  arrow.rotation.x=Math.PI/2;
  arrow.position.set(0, m.wallMount==='wall' ? -.035 : .012, depth+.13);
  arrow.castShadow=false;
  arrow.receiveShadow=false;
  arrow.renderOrder=20;
  arrow.userData.uiOnly=true;
  g.add(arrow);

  applyWallTransform(g,item);
  return g;
}

function tagModuleMeshes(g,uid){
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.itemId=uid;}});
}
function addBox(group,w,h,d,x,y,z,mat,part){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  mesh.position.set(x,y,z);mesh.userData.part=part;
  // Countertop decor must keep a believable real-world scale.
  // Store the actual worktop footprint so the texture loader can calculate
  // repeat values from the source image aspect ratio instead of squeezing
  // or tiling the image a fixed 2.2 times on every module.
  if(part==='worktop') configureCountertopTextureScale(mat,w,d);
  if(part==='facade') configureFacadeTextureScale(mat,w,h);
  group.add(mesh);return mesh;
}

function createFacadeMaterial(materialId){
  const def=FACADE_MATERIALS.find(m=>m.id===materialId)||FACADE_MATERIALS[0];
  return createDecorMaterial(def,'facade');
}

function createCountertopMaterial(materialId){
  const def=getCountertopMaterial(materialId);
  return createDecorMaterial(def,'countertop');
}

function createDecorMaterial(def,usage){
  const mat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:def.roughness ?? (usage==='countertop'?.5:.68)});
  mat.userData.decorDef=def;
  mat.userData.decorUsage=usage;
  // Always start with a local procedural fallback so the constructor remains usable offline.
  mat.map=getProceduralDecorTexture(def,usage);
  mat.color.set(0xffffff);

  // If the manufacturer exposes a real decor image, try to replace the fallback asynchronously.
  // Cross-origin restrictions are handled gracefully: on error the procedural texture remains.
  if(def?.texture && typeof THREE!=='undefined'){
    try{
      const loader=new THREE.TextureLoader();
      if(loader.setCrossOrigin) loader.setCrossOrigin('anonymous');
      loader.load(def.texture,(tex)=>{
        tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
        applyDecorTextureScale(tex,mat,def,usage);
        if('colorSpace' in tex && THREE.SRGBColorSpace){tex.colorSpace=THREE.SRGBColorSpace;}
        else if(THREE.sRGBEncoding){tex.encoding=THREE.sRGBEncoding;}
        if(renderer?.capabilities?.getMaxAnisotropy) tex.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
        mat.map=tex;
        mat.needsUpdate=true;
      },undefined,()=>{});
    }catch(e){}
  }
  return mat;
}

function configureCountertopTextureScale(mat,w,d){
  if(!mat?.userData) return;
  mat.userData.worktopFootprint={w,d};
  if(mat.map){
    applyDecorTextureScale(mat.map,mat,mat.userData.decorDef||{},'countertop');
    mat.map.needsUpdate=true;
  }
}

function configureFacadeTextureScale(mat,w,h){
  if(!mat?.userData) return;
  // Keep one physical decor scale across all fronts. Previously every door
  // displayed the entire source image, so a 300 mm upper door squeezed the
  // same amount of pattern into half the width of a 600 mm lower front.
  mat.userData.facadeFootprint={w,h};
  if(mat.map){
    applyDecorTextureScale(mat.map,mat,mat.userData.decorDef||{},'facade');
    mat.map.needsUpdate=true;
  }
}

function applyDecorTextureScale(tex,mat,def,usage){
  if(!tex) return;
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  if(usage==='facade'){
    const footprint=mat?.userData?.facadeFootprint;
    // 0.545 m reproduces the already approved look of the ~600 mm lower front
    // (the previous default was repeatX=1.1 there). Narrower doors now show a
    // proportionally smaller crop instead of compressing the whole texture.
    const physicalWidth=def.texturePhysicalWidth||.545;
    const repeatX=footprint?Math.max(.08,footprint.w/physicalWidth):1.1;
    tex.repeat.set(repeatX,1);
    const off=def.facadeTextureOffset||[0,0];
    tex.offset.set(off[0]||0,off[1]||0);
    return;
  }
  if(usage!=='countertop'){
    tex.repeat.set(1.1,1);
    return;
  }

  const footprint=mat?.userData?.worktopFootprint;
  if(!footprint){
    // Temporary value used until the material is attached to a worktop mesh.
    tex.repeat.set(.45,.60);
    return;
  }

  // Treat the source decor as a large physical slab rather than a small tile.
  // One source-image height corresponds to ~1 metre by default; width follows
  // the real image aspect ratio. This preserves proportions and gives large,
  // calm marble veins instead of several repeated mini-patterns per cabinet.
  const image=tex.image;
  const iw=image?.naturalWidth||image?.videoWidth||image?.width||0;
  const ih=image?.naturalHeight||image?.videoHeight||image?.height||0;
  const aspect=(iw>0&&ih>0)?iw/ih:(def.textureAspect||1.45);
  const physicalHeight=def.texturePhysicalHeight||1.0;
  const physicalWidth=physicalHeight*aspect;
  const repeatX=Math.max(.08,footprint.w/physicalWidth);
  const repeatY=Math.max(.08,footprint.d/physicalHeight);
  tex.repeat.set(repeatX,repeatY);

  const off=def.textureOffset||[0,0];
  tex.offset.set(off[0]||0,off[1]||0);
}

function getProceduralDecorTexture(def,usage){
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const x=c.getContext('2d');
  x.fillStyle=def.color||'#aaa';x.fillRect(0,0,256,256);
  const rgb=hexRgb(def.color||'#aaaaaa');
  if(def.type==='wood' || def.category==='wood'){
    for(let i=0;i<38;i++){
      const y=(i*23+13)%256;
      x.strokeStyle=`rgba(${Math.max(0,rgb[0]-35)},${Math.max(0,rgb[1]-30)},${Math.max(0,rgb[2]-25)},${.08+(i%4)*.025})`;
      x.lineWidth=1+(i%3)*.45;x.beginPath();x.moveTo(0,y);
      for(let xx=0;xx<=256;xx+=16)x.lineTo(xx,y+Math.sin((xx+i*11)/28)*5);
      x.stroke();
    }
  }else if(['stone','industrial','dark','fantasy'].includes(def.type)||['stone','industrial','dark','fantasy'].includes(def.category)){
    for(let i=0;i<36;i++){
      x.fillStyle=`rgba(255,255,255,${.018+(i%5)*.008})`;
      x.beginPath();x.arc((i*71)%256,(i*43)%256,3+(i%11),0,Math.PI*2);x.fill();
    }
    for(let i=0;i<12;i++){
      x.strokeStyle=`rgba(40,40,40,${.025+(i%3)*.018})`;x.lineWidth=.8+(i%2);x.beginPath();
      x.moveTo(-20,(i*31)%256);x.bezierCurveTo(70,(i*17)%256,180,(i*53)%256,280,(i*29)%256);x.stroke();
    }
  }
  const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(usage==='countertop'?.6:1.1,usage==='countertop'?.6:1);
  if('colorSpace' in tex && THREE.SRGBColorSpace){tex.colorSpace=THREE.SRGBColorSpace;}else if(THREE.sRGBEncoding){tex.encoding=THREE.sRGBEncoding;}
  return tex;
}

function hexRgb(hex){
  const h=hex.replace('#','');const n=parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);return[(n>>16)&255,(n>>8)&255,n&255];
}

function createWoodTexture(base){
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const ctx=c.getContext('2d');ctx.fillStyle=base;ctx.fillRect(0,0,256,256);
  const grad=ctx.createLinearGradient(0,0,256,0);grad.addColorStop(0,'rgba(255,255,255,.05)');grad.addColorStop(.5,'rgba(0,0,0,.05)');grad.addColorStop(1,'rgba(255,255,255,.04)');ctx.fillStyle=grad;ctx.fillRect(0,0,256,256);
  ctx.lineWidth=1;
  for(let i=0;i<42;i++){
    const y=(i*6+Math.sin(i*1.7)*3)%256;ctx.strokeStyle=`rgba(75,48,25,${.035+(i%5)*.01})`;ctx.beginPath();
    for(let x=0;x<=256;x+=8){const yy=y+Math.sin(x*.055+i)*1.8+Math.sin(x*.013+i*.7)*3;if(x===0)ctx.moveTo(x,yy);else ctx.lineTo(x,yy)}ctx.stroke();
  }
  const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(1.15,1);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);return tex;
}

function applyWallTransform(g,item){
  const W=state.room.width*MM,D=state.room.depth*MM;
  const y=(item.elevation||0)*MM;
  if(item.wallId==='north'){g.position.set(item.coord,y,-D/2);g.rotation.y=0;}
  if(item.wallId==='south'){g.position.set(item.coord,y, D/2);g.rotation.y=Math.PI;}
  if(item.wallId==='west'){g.position.set(-W/2,y,item.coord);g.rotation.y=Math.PI/2;}
  if(item.wallId==='east'){g.position.set( W/2,y,item.coord);g.rotation.y=-Math.PI/2;}
}

/* ================= 3D DRAG ================= */
function onPointerDown(e){
  if(e.button!==0)return;
  setPointer(e);raycaster.setFromCamera(pointer,camera);
  const meshes=[];modulesGroup.traverse(o=>{if(o.isMesh)meshes.push(o)});
  const hit=raycaster.intersectObjects(meshes,false)[0];
  if(!hit){state.selectedId=null;refreshSelectionBox();refreshDirectionArrow();updateSidebar();return;}
  const id=hit.object.userData.itemId,item=findItem(id),m=getModule(item.moduleId);
  state.selectedId=id;refreshSelectionBox();refreshDirectionArrow();updateSidebar();
  drag={
    id,
    start:{wallId:item.wallId,coord:item.coord,elevation:item.elevation||0},
    lastValid:{wallId:item.wallId,coord:item.coord,elevation:item.elevation||0},
    grabYOffset:m.wallMount==='wall' ? hit.point.y-(item.elevation||0)*MM : 0,
    valid:true
  };
  controls.enabled=false;
  renderer.domElement.setPointerCapture(e.pointerId);
  dragStatus.classList.remove('hidden');
}

function onPointerMove(e){
  if(!drag)return;
  setPointer(e);raycaster.setFromCamera(pointer,camera);
  const item=findItem(drag.id),m=getModule(item.moduleId);
  const pFloor=new THREE.Vector3();
  const hasFloor=raycaster.ray.intersectPlane(floorPlane,pFloor);
  let wallId=item.wallId;
  if(hasFloor) wallId=floorWallForPoint(pFloor,item.wallId);
  item.wallId=wallId;

  if(m.wallMount==='wall'){
    const wallTarget=intersectAvailableWallRay(item.wallId);
    if(wallTarget){
      wallId=wallTarget.wallId;
      item.wallId=wallId;
      item.coord=(wallId==='north'||wallId==='south')?wallTarget.point.x:wallTarget.point.z;
      const rawElevation=(wallTarget.point.y-drag.grabYOffset)/MM;
      item.elevation=snapElevation(item,m,rawElevation);
    }
  }else if(hasFloor){
    item.coord=(wallId==='north'||wallId==='south')?pFloor.x:pFloor.z;
  }

  item.coord=snapCoord(item,m);
  clampItemToWall(item);
  const obj=getModuleObject(item.uid);applyWallTransform(obj,item);obj.updateMatrixWorld(true);
  if(directionArrowsGroup && state.selectedId===item.uid && directionArrowsGroup.children[0]){
    applyWallTransform(directionArrowsGroup.children[0],item);
    directionArrowsGroup.children[0].updateMatrixWorld(true);
  }
  const valid=!hasCollision(item.uid);
  drag.valid=valid;
  if(valid)drag.lastValid={wallId:item.wallId,coord:item.coord,elevation:item.elevation||0};
  setInvalidVisual(obj,!valid);
  dragStatus.textContent=valid?'Положение допустимо':'Здесь модуль пересекается с другим';
  dragStatus.classList.toggle('invalid',!valid);
  refreshSelectionBox();updateSidebar();
}

function onPointerUp(){
  if(!drag)return;
  const item=findItem(drag.id);
  if(!drag.valid){
    item.wallId=drag.lastValid.wallId;item.coord=drag.lastValid.coord;item.elevation=drag.lastValid.elevation;
  }
  drag=null;controls.enabled=true;dragStatus.classList.add('hidden');dragStatus.classList.remove('invalid');
  rebuildModules();saveLocal();
}

function intersectWallRay(wallId){
  const W=state.room.width*MM,D=state.room.depth*MM;
  let plane;
  if(wallId==='north') plane=new THREE.Plane(new THREE.Vector3(0,0,1),D/2);
  if(wallId==='south') plane=new THREE.Plane(new THREE.Vector3(0,0,1),-D/2);
  if(wallId==='west') plane=new THREE.Plane(new THREE.Vector3(1,0,0),W/2);
  if(wallId==='east') plane=new THREE.Plane(new THREE.Vector3(1,0,0),-W/2);
  const hit=new THREE.Vector3();return raycaster.ray.intersectPlane(plane,hit)?hit:null;
}
function getHiddenWallIdByCamera(){
  if(!camera) return 'south';
  const x=camera.position.x,z=camera.position.z;
  if(Math.abs(z)>=Math.abs(x)) return z>=0?'south':'north';
  return x>=0?'east':'west';
}
function isPointOnWallArea(wallId,point,tolerance=.02){
  const W=state.room.width*MM,D=state.room.depth*MM,H=state.room.height*MM;
  if(point.y < -tolerance || point.y > H + tolerance) return false;
  if(wallId==='north' || wallId==='south') return point.x >= -W/2-tolerance && point.x <= W/2+tolerance;
  return point.z >= -D/2-tolerance && point.z <= D/2+tolerance;
}
function intersectAvailableWallRay(preferredWallId){
  const hidden=getHiddenWallIdByCamera();
  const candidates=[];
  ['north','south','west','east'].forEach((wallId)=>{
    if(wallId===hidden) return;
    const point=intersectWallRay(wallId);
    if(!point || !isPointOnWallArea(wallId,point,.03)) return;
    const distance=raycaster.ray.origin.distanceTo(point);
    const score=distance + (wallId===preferredWallId ? -0.05 : 0);
    candidates.push({wallId,point:point.clone(),score});
  });
  candidates.sort((a,b)=>a.score-b.score);
  if(candidates[0]) return candidates[0];
  if(preferredWallId){
    const point=intersectWallRay(preferredWallId);
    if(point) return {wallId:preferredWallId,point:point.clone(),score:0};
  }
  return null;
}

function wallDistancesForPoint(p){
  const W=state.room.width*MM,D=state.room.depth*MM;
  return [
    {id:'north',dist:Math.abs(p.z+D/2)}, {id:'south',dist:Math.abs(p.z-D/2)},
    {id:'west',dist:Math.abs(p.x+W/2)}, {id:'east',dist:Math.abs(p.x-W/2)}
  ];
}

function nearestWallForPoint(p){
  const list=wallDistancesForPoint(p);
  list.sort((a,b)=>a.dist-b.dist);return list[0];
}

function floorWallForPoint(p,currentWallId){
  const list=wallDistancesForPoint(p).sort((a,b)=>a.dist-b.dist);
  const nearest=list[0];
  const current=list.find(w=>w.id===currentWallId);
  // At a room corner the two wall distances are often almost identical.
  // Keep the module on its current wall until the pointer is clearly closer
  // to another wall. This prevents accidental wall switching that used to
  // break snapping to a cabinet already standing at the extreme edge.
  const hysteresis=.18;
  if(current && current.dist<=nearest.dist+hysteresis) return current.id;
  return nearest.id;
}

function snapCoord(item,m){
  let c=Math.round(item.coord/.05)*.05;
  const half=m.width*MM/2,threshold=.13;
  state.items.filter(o=>o.uid!==item.uid&&o.wallId===item.wallId).forEach(o=>{
    const om=getModule(o.moduleId),oh=om.width*MM/2;
    [o.coord+oh+half,o.coord-oh-half].forEach(t=>{if(Math.abs(c-t)<threshold)c=t});
  });
  return c;
}
function snapElevation(item,m,rawMm){
  const {min,max}=getElevationBounds(m);
  let e=Math.round(rawMm/10)*10;
  const standard=clamp(m.defaultElevation||DEFAULT_UPPER_ELEVATION,min,max);
  if(Math.abs(e-standard)<70)e=standard;
  state.items.filter(o=>o.uid!==item.uid&&o.wallId===item.wallId&&getModule(o.moduleId)?.wallMount==='wall').forEach(o=>{
    if(Math.abs(e-(o.elevation||0))<55)e=o.elevation||0;
  });
  return clamp(e,min,max);
}

function getElevationBounds(m){
  const ceilingMax=Math.max(0,state.room.height-m.height);
  const preferredMin=m.minElevation ?? 600;
  const min=Math.min(preferredMin,ceilingMax);
  return {min,max:ceilingMax};
}

function clampItemToWall(item){
  const m=getModule(item.moduleId),half=m.width*MM/2;
  const len=(item.wallId==='north'||item.wallId==='south')?state.room.width*MM:state.room.depth*MM;
  item.coord=clamp(item.coord,-len/2+half,len/2-half);
  if(m.wallMount==='wall'){
    const {min,max}=getElevationBounds(m);
    item.elevation=Math.round(clamp(item.elevation ?? m.defaultElevation ?? DEFAULT_UPPER_ELEVATION,min,max));
  }else item.elevation=0;
}

function hasCollision(uid){
  const item=findItem(uid);if(!item)return false;
  const a=logicalCollisionBox(item).expandByScalar(-.003);
  for(const other of state.items){
    if(other.uid===uid)continue;
    const b=logicalCollisionBox(other).expandByScalar(-.003);
    if(a.intersectsBox(b))return true;
  }
  return false;
}
function logicalCollisionBox(item){
  const m=getModule(item.moduleId),W=m.width*MM,D=m.depth*MM,H=m.height*MM;
  const roomW=state.room.width*MM,roomD=state.room.depth*MM,y=(item.elevation||0)*MM;
  let center,size;
  if(item.wallId==='north'){center=new THREE.Vector3(item.coord,y+H/2,-roomD/2+D/2);size=new THREE.Vector3(W,H,D);}
  if(item.wallId==='south'){center=new THREE.Vector3(item.coord,y+H/2, roomD/2-D/2);size=new THREE.Vector3(W,H,D);}
  if(item.wallId==='west'){center=new THREE.Vector3(-roomW/2+D/2,y+H/2,item.coord);size=new THREE.Vector3(D,H,W);}
  if(item.wallId==='east'){center=new THREE.Vector3( roomW/2-D/2,y+H/2,item.coord);size=new THREE.Vector3(D,H,W);}
  return new THREE.Box3().setFromCenterAndSize(center,size);
}
function setInvalidVisual(obj,invalid){
  obj.traverse(o=>{if(o.isMesh){o.material.transparent=invalid;o.material.opacity=invalid?.62:1;}});
}
function setPointer(e){
  const r=renderer.domElement.getBoundingClientRect();
  pointer.x=((e.clientX-r.left)/r.width)*2-1;pointer.y=-((e.clientY-r.top)/r.height)*2+1;
}

/* ================= SIDEBAR ================= */
function refreshSelectionBox(){
  const o=getModuleObject(state.selectedId);
  if(o){selectionBox.setFromObject(o);selectionBox.visible=true;}else selectionBox.visible=false;
}

function updateSidebar(){
  const count=state.items.length,total=state.items.reduce((s,i)=>s+getModule(i.moduleId).price,0);
  syncCountertopUI();
  document.getElementById('module-count').textContent=count;
  document.getElementById('total-price').textContent=fmt.format(total)+' ₽';

  const empty=document.getElementById('selection-empty');
  const sel=document.getElementById('selection');
  const settingsEmpty=document.getElementById('module-settings-empty');
  const settings=document.getElementById('module-settings');
  const heightSetting=document.getElementById('module-height-setting');
  const floorNote=document.getElementById('floor-module-note');
  const elevationRow=document.getElementById('selection-elevation-row');
  const item=findItem(state.selectedId);

  if(item){
    const m=getModule(item.moduleId);

    // Правая панель — только характеристики.
    empty.classList.add('hidden');
    sel.classList.remove('hidden');
    document.getElementById('selection-name').textContent=m.name;
    document.getElementById('selection-meta').textContent=`${m.sku} · арт. ${m.id} · Ш${m.width} × Г${m.depth} × В${m.height} мм · ${fmt.format(m.price)} ₽`;
    document.getElementById('selection-mount').textContent=m.wallMount==='wall'?'Настенный':'Напольный';
    const matDef=getFacadeMaterial(item.materialId);
    document.getElementById('selection-color-name').textContent=matDef.name;
    document.getElementById('selection-color-dot').style.background=matDef.color;
    document.getElementById('selection-wall').textContent=WALL_NAMES[item.wallId];
    document.getElementById('selection-offset').textContent=Math.round((item.coord+wallLength(item.wallId)/2)*1000)+' мм от края';
    if(m.wallMount==='wall'){
      elevationRow.classList.remove('hidden');
      document.getElementById('selection-elevation').textContent=Math.round(item.elevation||0)+' мм';
    }else{
      elevationRow.classList.add('hidden');
    }

    // Левая панель — только изменяемые параметры и действия.
    settingsEmpty.classList.add('hidden');
    settings.classList.remove('hidden');
    document.getElementById('module-settings-name').textContent=`${m.name} · ${m.sku}`;
    syncSelectedMaterialUI();
    if(m.wallMount==='wall'){
      heightSetting.classList.remove('hidden');
      floorNote.classList.add('hidden');
      const input=document.getElementById('selection-height');
      const bounds=getElevationBounds(m);
      input.min=String(bounds.min);
      input.max=String(bounds.max);
      input.value=String(Math.round(item.elevation||0));
      input.title=`Допустимый диапазон: ${bounds.min}–${bounds.max} мм`;
    }else{
      heightSetting.classList.add('hidden');
      floorNote.classList.remove('hidden');
    }
  }else{
    empty.classList.remove('hidden');
    sel.classList.add('hidden');
    settingsEmpty.classList.remove('hidden');
    settings.classList.add('hidden');
    heightSetting.classList.add('hidden');
    floorNote.classList.add('hidden');
    elevationRow.classList.add('hidden');
    syncSelectedMaterialUI();
  }

  const spec=document.getElementById('spec');
  if(!count){spec.innerHTML='<div class="empty-state">Смета пока пуста.</div>';return;}
  const groups=new Map();state.items.forEach(i=>{const m=getModule(i.moduleId);groups.set(m.id,(groups.get(m.id)||0)+1)});
  let html='';groups.forEach((q,id)=>{const m=getModule(id);html+=`<div class="spec-row"><div><b>${m.sku}</b><small>${m.width}×${m.depth}×${m.height} мм · ×${q}</small></div><b>${fmt.format(m.price*q)} ₽</b></div>`});
  html+=`<div class="spec-total"><span>Итого</span><span>${fmt.format(total)} ₽</span></div>`;spec.innerHTML=html;
}

function applySelectedHeightFromField(){
  const item=findItem(state.selectedId);if(!item)return;
  const m=getModule(item.moduleId);if(m.wallMount!=='wall')return;
  const old=item.elevation||m.defaultElevation||DEFAULT_UPPER_ELEVATION;
  const raw=+document.getElementById('selection-height').value;
  const {min,max}=getElevationBounds(m);
  item.elevation=Math.round(clamp(raw,min,max));
  if(hasCollision(item.uid)){
    item.elevation=old;
    showToast('Высота не применена','На этой высоте модуль пересекается с другим элементом.');
  }else if(raw>max){
    showToast('Высота скорректирована',`Модуль ограничен потолком. Максимальный низ: ${max} мм.`);
  }else if(raw<min){
    showToast('Высота скорректирована',`Минимальная высота для этого модуля: ${min} мм.`);
  }else{
    showToast('Высота применена',`Низ модуля: ${item.elevation} мм от пола.`);
  }
  rebuildModules();saveLocal();
}

function deleteSelected(){
  if(!state.selectedId)return;state.items=state.items.filter(i=>i.uid!==state.selectedId);state.selectedId=null;rebuildModules();saveLocal();
}

/* ================= HELPERS / PERSISTENCE ================= */
function updateRoomLabel(){
  document.getElementById('room-label').textContent=`Комната ${state.room.width} × ${state.room.depth} × ${state.room.height} мм`;
  syncRoomFields();
}
function wallLength(id){return (id==='north'||id==='south')?state.room.width*MM:state.room.depth*MM;}
function getModule(id){return CATALOG.find(m=>m.id===id);}
function findItem(uid){return state.items.find(i=>i.uid===uid)||null;}
function getModuleObject(uid){return modulesGroup?.children.find(c=>c.userData.itemId===uid)||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function clearGroup(g){
  while(g.children.length){
    const o=g.children.pop();
    o.traverse?.(x=>{if(x.geometry)x.geometry.dispose?.();});
  }
}


function openMaterialModal(type){
  if(type==='facade' && !findItem(state.selectedId)){
    showToast('Сначала выберите модуль','Нажмите на модуль в 3D, затем выберите фасад.');
    return;
  }
  materialModalType=type;
  materialModalCategory='all';
  materialModalSearch='';
  const search=document.getElementById('material-search'); if(search) search.value='';
  const modal=document.getElementById('material-modal');
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
  document.body.classList.add('material-modal-open');
  renderMaterialModal();
  setTimeout(()=>search?.focus(),50);
}
function closeMaterialModal(){
  const modal=document.getElementById('material-modal');
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true');
  document.body.classList.remove('material-modal-open');
  materialModalType=null;
}
function materialCategoryDefs(type){
  return type==='facade'
    ? [
        ['all','Все'],['wood','Древесные'],['fantasy','Фентезийные'],['solid','Фоновые']
      ]
    : [
        ['all','Все'],['light','Светлые'],['stone','Камень и мрамор'],['wood','Дерево'],['industrial','Бетон и индустриальные'],['dark','Тёмные'],['color','Цветные']
      ];
}
function materialMatchesSearch(m,q){
  if(!q) return true;
  return `${m.code||''} ${m.name||''} ${m.supplier||''}`.toLowerCase().includes(q);
}
function renderMaterialModal(){
  if(!materialModalType) return;
  const isTop=materialModalType==='countertop';
  const title=document.getElementById('material-modal-title');
  const sub=document.getElementById('material-modal-subtitle');
  title.textContent=isTop?'Выберите столешницу':'Выберите фасад';
  sub.textContent=isTop?'СКИФ · декоры, доступные в выбранной толщине':'Томлесдрев · ЛДСП';

  const thicknessWrap=document.getElementById('material-modal-thickness');
  const thicknessChips=document.getElementById('material-thickness-chips');
  thicknessWrap.classList.toggle('hidden',!isTop);
  if(isTop){
    thicknessChips.innerHTML=[6,16,25,38,60].map(t=>`<button type="button" class="material-filter-chip${state.countertopThickness===t?' active':''}" data-thickness="${t}">${t} мм</button>`).join('');
    thicknessChips.querySelectorAll('[data-thickness]').forEach(btn=>{
      btn.onclick=()=>{
        state.countertopThickness=+btn.dataset.thickness;
        document.getElementById('countertop-thickness').value=String(state.countertopThickness);
        const compatible=COUNTERTOP_MATERIALS.filter(m=>(m.thicknesses||[38]).includes(state.countertopThickness));
        if(!compatible.some(m=>m.id===state.countertopMaterialId) && compatible.length){
          state.countertopMaterialId=compatible[0].id;
          document.getElementById('countertop-select').value=state.countertopMaterialId;
          syncCountertopUI(); rebuildModules(); saveLocal();
        }
        renderCountertopOptions(false);
        renderMaterialModal();
      };
    });
  }

  const categories=materialCategoryDefs(materialModalType);
  const catWrap=document.getElementById('material-category-chips');
  catWrap.innerHTML=categories.map(([id,label])=>`<button type="button" class="material-filter-chip${materialModalCategory===id?' active':''}" data-material-category="${id}">${label}</button>`).join('');
  catWrap.querySelectorAll('[data-material-category]').forEach(btn=>{
    btn.onclick=()=>{materialModalCategory=btn.dataset.materialCategory;renderMaterialModal();};
  });

  let list=(isTop?COUNTERTOP_MATERIALS:FACADE_MATERIALS).filter(m=>{
    if(isTop && !(m.thicknesses||[38]).includes(state.countertopThickness)) return false;
    if(materialModalCategory!=='all' && m.category!==materialModalCategory) return false;
    return materialMatchesSearch(m,materialModalSearch);
  });

  const currentId=isTop?state.countertopMaterialId:(findItem(state.selectedId)?.materialId||state.materialId);
  const count=document.getElementById('material-modal-count');
  count.textContent=`Найдено: ${list.length}`;
  const grid=document.getElementById('material-modal-grid');
  if(!list.length){
    grid.innerHTML='<div class="material-modal-empty">В этой категории нет декоров с выбранными параметрами.</div>';
    return;
  }
  grid.innerHTML=list.map(m=>{
    const meta=isTop
      ? `${m.code?'№ '+m.code+' · ':''}${m.supplier}${m.thicknesses?.length?' · '+m.thicknesses.join('/')+' мм':''}`
      : `${m.supplier} · ЛДСП`;
    const details=isTop ? [
      m.collection,
      m.surface,
      m.embossing ? `тиснение: ${m.embossing}` : null,
      m.length ? `${m.length} мм` : null,
      m.widths?.length ? `ширина ${m.widths.join('/')} мм` : null,
      m.specDetails || null
    ].filter(Boolean).join(' · ') : '';
    const badges=[];
    if(m.texture) badges.push('<span>Реальная текстура</span>');
    if(m.isNew) badges.push('<span>Новинка</span>');
    if(m.exclusive) badges.push('<span>Эксклюзив</span>');
    if(m.length4200) badges.push('<span>4,2 м</span>');
    return `<button type="button" class="material-card${m.id===currentId?' active':''}" data-material-id="${m.id}">
      <i class="material-card-preview"></i>
      <span class="material-card-info"><b>${isTop && m.code?'№ '+m.code+' — ':''}${m.name}</b><small>${meta}</small>${details?`<small class="material-card-details">${details}</small>`:''}${badges.length?`<em>${badges.join('')}</em>`:''}</span>
      <span class="material-card-check">✓</span>
    </button>`;
  }).join('');
  grid.querySelectorAll('[data-material-id]').forEach(card=>{
    const materialId=card.dataset.materialId;
    const material=(isTop?COUNTERTOP_MATERIALS:FACADE_MATERIALS).find(m=>m.id===materialId);
    const preview=card.querySelector('.material-card-preview');
    if(preview && material) preview.style.background=previewCss(material);
    card.onclick=()=>selectMaterialFromModal(materialId);
  });
}
function selectMaterialFromModal(id){
  if(materialModalType==='facade'){
    const item=findItem(state.selectedId); if(!item) return;
    item.materialId=id; state.materialId=id;
    document.getElementById('facade-select').value=id;
    syncSelectedMaterialUI(); rebuildModules(); saveLocal();
    closeMaterialModal();
    showToast('Фасад выбран',getFacadeMaterial(id).name);
    return;
  }
  if(materialModalType==='countertop'){
    const def=getCountertopMaterial(id);
    if(!(def.thicknesses||[38]).includes(state.countertopThickness)) return;
    state.countertopMaterialId=id;
    document.getElementById('countertop-select').value=id;
    syncCountertopUI(); rebuildModules(); saveLocal();
    closeMaterialModal();
    showToast('Столешница выбрана',`${def.code?'№ '+def.code+' — ':''}${def.name}, ${state.countertopThickness} мм`);
  }
}

function getFacadeMaterial(materialId){
  return FACADE_MATERIALS.find(m=>m.id===materialId)||FACADE_MATERIALS[0];
}
function getCountertopMaterial(materialId){
  return COUNTERTOP_MATERIALS.find(m=>m.id===materialId)||COUNTERTOP_MATERIALS[0];
}
function previewCss(def){
  const c=def?.color||'#aaa';
  if(def?.texture) return `url("${def.texture}") center / cover no-repeat, ${c}`;
  if(def?.type==='wood'||def?.category==='wood') return `linear-gradient(100deg,rgba(255,255,255,.10),rgba(0,0,0,.06)),repeating-linear-gradient(6deg,${c} 0 8px,rgba(60,35,20,.10) 9px 10px,${c} 12px 21px)`;
  if(['stone','industrial','dark','fantasy'].includes(def?.type)||['stone','industrial','dark','fantasy'].includes(def?.category)) return `radial-gradient(circle at 25% 30%,rgba(255,255,255,.22),transparent 22%),radial-gradient(circle at 70% 60%,rgba(0,0,0,.10),transparent 28%),${c}`;
  return c;
}
function renderFacadeOptions(){
  const sel=document.getElementById('facade-select'); if(!sel)return;
  const cat=document.getElementById('facade-category').value;
  const item=findItem(state.selectedId); const current=item?.materialId || state.materialId;
  const list=FACADE_MATERIALS.filter(m=>cat==='all'||m.category===cat);
  sel.innerHTML=list.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  if(list.some(m=>m.id===current))sel.value=current;
  sel.disabled=!item;
}
function renderCountertopOptions(ensureCompatible=false){
  const sel=document.getElementById('countertop-select'); if(!sel)return;
  const cat=document.getElementById('countertop-category').value;
  const t=+document.getElementById('countertop-thickness').value;
  let list=COUNTERTOP_MATERIALS.filter(m=>(m.thicknesses||[38]).includes(t) && (cat==='all'||m.category===cat));
  if(!list.length){sel.innerHTML='<option value="">Нет подходящих декоров</option>';sel.disabled=true;return;}
  sel.disabled=false;
  if(ensureCompatible && !list.some(m=>m.id===state.countertopMaterialId)) state.countertopMaterialId=list[0].id;
  sel.innerHTML=list.map(m=>`<option value="${m.id}">${m.code?'№ '+m.code+' — ':''}${m.name}</option>`).join('');
  if(list.some(m=>m.id===state.countertopMaterialId))sel.value=state.countertopMaterialId; else sel.value=list[0].id;
  if(!list.some(m=>m.id===state.countertopMaterialId)) state.countertopMaterialId=sel.value;
  syncCountertopUI();
}
function syncSelectedMaterialUI(){
  const item=findItem(state.selectedId);
  const def=item?getFacadeMaterial(item.materialId):getFacadeMaterial(state.materialId);
  const name=document.getElementById('material-name');if(name)name.textContent=item?def.name:'Выберите модуль, чтобы изменить фасад';
  const preview=document.getElementById('facade-preview');if(preview)preview.style.background=previewCss(def);
  const sel=document.getElementById('facade-select');if(sel){sel.disabled=!item;if(item && [...sel.options].some(o=>o.value===item.materialId))sel.value=item.materialId;}
  const all=document.getElementById('apply-facade-all');if(all)all.disabled=!item;
  const open=document.getElementById('facade-open');if(open)open.disabled=!item;
}
function syncCountertopUI(){
  const def=getCountertopMaterial(state.countertopMaterialId);
  const n=document.getElementById('countertop-name');if(n)n.textContent=`${def.code?'№ '+def.code+' ':''}${def.name}`;
  const m=document.getElementById('countertop-meta');if(m)m.textContent=`${def.supplier} · ${state.countertopThickness} мм`;
  const p=document.getElementById('countertop-preview');if(p)p.style.background=previewCss(def);
  const rn=document.getElementById('project-countertop-name');if(rn)rn.textContent=`${def.code?'№ '+def.code+' ':''}${def.name}`;
  const rt=document.getElementById('project-countertop-thickness');if(rt)rt.textContent=`${state.countertopThickness} мм`;
}

function saveLocal(){
  try{localStorage.setItem('slavnaya-kitchen-mvp',JSON.stringify({room:state.room,materialId:state.materialId,countertopMaterialId:state.countertopMaterialId,countertopThickness:state.countertopThickness,items:state.items,nextId:state.nextId,mode:state.mode,moduleTab:state.moduleTab}));}catch(e){}
}
function restoreLocal(){
  try{
    const raw=localStorage.getItem('slavnaya-kitchen-mvp');if(!raw)return;
    const data=JSON.parse(raw);if(data.room)state.room={...state.room,...data.room};
    if(FACADE_MATERIALS.some(m=>m.id===data.materialId))state.materialId=data.materialId;
    if(COUNTERTOP_MATERIALS.some(m=>m.id===data.countertopMaterialId))state.countertopMaterialId=data.countertopMaterialId;
    if([6,16,25,38,60].includes(+data.countertopThickness))state.countertopThickness=+data.countertopThickness;
    if(Array.isArray(data.items)){
      state.items=data.items.filter(i=>getModule(i.moduleId)).map(i=>{
        const m=getModule(i.moduleId);
        const materialId=FACADE_MATERIALS.some(mat=>mat.id===i.materialId) ? i.materialId : (data.materialId || FACADE_MATERIALS[0].id);
        return {...i,materialId,elevation:m.wallMount==='wall'?(i.elevation ?? m.defaultElevation ?? DEFAULT_UPPER_ELEVATION):0};
      });
    }
    state.nextId=data.nextId||1;if(data.mode)state.mode=data.mode;if(data.moduleTab)state.moduleTab=data.moduleTab;
    syncRoomFields();renderModuleTabs();renderCatalog();
    document.getElementById('countertop-thickness').value=String(state.countertopThickness);
    renderFacadeOptions();renderCountertopOptions(true);
    syncSelectedMaterialUI();syncCountertopUI();
  }catch(e){console.warn('Не удалось восстановить локальный проект',e)}
}

function updateWallVisibility(immediate=false){
  if(!walls.length||!camera)return;
  const x=camera.position.x,z=camera.position.z;
  let nearest;
  if(Math.abs(z)>=Math.abs(x)) nearest=z>=0?'south':'north';
  else nearest=x>=0?'east':'west';
  for(const w of walls){
    const hidden=w.id===nearest;
    const target=hidden?.025:.88,edgeTarget=hidden?.01:.25;
    if(immediate){w.mesh.material.opacity=target;w.edges.material.opacity=edgeTarget;}
    else{
      w.mesh.material.opacity+=(target-w.mesh.material.opacity)*.14;
      w.edges.material.opacity+=(edgeTarget-w.edges.material.opacity)*.14;
    }
    w.mesh.material.depthWrite=!hidden;
  }
  const label=document.getElementById('wall-label');
  if(label)label.textContent=`Скрыта ближайшая стена: ${WALL_NAMES[nearest].toLowerCase()}`;
}

function onResize(){
  if(!renderer)return;
  const r=viewport.parentElement.getBoundingClientRect();
  const w=Math.max(1,r.width),h=Math.max(1,r.height);
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
}
function animate(){requestAnimationFrame(animate);controls.update();updateWallVisibility();renderer.render(scene,camera);}

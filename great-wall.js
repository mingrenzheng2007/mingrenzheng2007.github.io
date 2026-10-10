import {SITES} from './great-wall-data.js';
import {API_BASE,IMAGE_MODEL,DESIGN_TYPES,KIND_LABELS,escapeHtml as e,imageUrl,dateKey,formatTime,distanceMeters,formatDistance,mergeRecords,visitStats,creationPrompt,generationSize,request} from './great-wall-core.js';
import {readArchive,saveArchive,removeArchive,imageBlob} from './great-wall-store.js';
import {buildScoredSites} from './great-wall-scores.js';

const $ = id => document.getElementById(id);
const icon = name => '<svg class="gw-icon" aria-hidden="true"><use href="#gwi-' + name + '"/></svg>';
const siteById = id => SITES.find(s=>s.id===id) || SITES[0];
const storageRead = key => {try {return JSON.parse(localStorage.getItem('gw.'+key));} catch {return null;}};
const storageWrite = (key,value) => {try {value == null ? localStorage.removeItem('gw.'+key) : localStorage.setItem('gw.'+key,JSON.stringify(value));} catch(error) {console.warn('Great Wall settings storage failed',error);}};
const state = {
  tab:'map',siteId:SITES[0].id,role:storageRead('role') || 'volunteer',location:null,
  records:[],creations:[],remote:[],gallery:[],galleryLoading:false,galleryError:'',activityError:'',
  journalFilter:'all',galleryFilter:'all',historyFilter:'all',sort:'priority',
  mapPhoto:null,mapNote:'',detailPhoto:null,detailNote:'',photos:[],designType:'明信片',
  pending:storageRead('pending'),generation:null,generationStarted:0,currentCreation:null,
  storageReady:false
};
let map,tileLayer,markers = new Map(),userMarker,confirmResolve,toastTimer;
const objectUrls = new Map();
let tileSuccess = false;

function blobUrl(blob,key) {
  if (!blob) return '';
  if (!objectUrls.has(key)) objectUrls.set(key,URL.createObjectURL(blob));
  return objectUrls.get(key);
}
function releaseUrl(key) {if(objectUrls.has(key)){URL.revokeObjectURL(objectUrls.get(key));objectUrls.delete(key);}}
function photoUrl(item) {return item.blob ? blobUrl(item.blob,item.id) : imageUrl(item.imageUrl || item.photoPath);}
function sitePhoto(site) {return imageUrl(site.imagePath);}
function empty(title,detail,action) {
  return '<div class="gw-empty">'+icon('tower')+'<strong>'+e(title)+'</strong><p>'+e(detail)+'</p>'+(action||'')+'</div>';
}
function toast(message) {
  clearTimeout(toastTimer);$('gw-toast').textContent=message;$('gw-toast').hidden=false;
  toastTimer=setTimeout(()=>$('gw-toast').hidden=true,4200);
}
function showError(target,error) {
  console.error('Great Wall request/action failed',error);
  $(target).textContent=error.message || String(error);$(target).hidden=false;
}
function confirmAction(title,message) {
  $('gw-confirm-title').textContent=title;$('gw-confirm-text').textContent=message;
  $('gw-confirm-dialog').showModal();
  return new Promise(resolve=>{confirmResolve=resolve;});
}
function showImage(url,caption) {
  if(!url)return;
  $('gw-dialog-image').src=url;$('gw-dialog-image').alt=caption||'长城照片';
  $('gw-dialog-caption').textContent=caption||'';$('gw-image-dialog').showModal();
}
function filters(target,items,selected,action) {
  $(target).innerHTML=items.map(([value,label])=>'<button type="button" data-action="'+action+'" data-value="'+value+'" aria-pressed="'+(selected===value)+'">'+label+'</button>').join('');
}
function selectedSite() {return siteById(state.siteId);}
function localStats() {return visitStats(SITES,state.records);}
function metricStats() {return visitStats(SITES,mergeRecords(state.records,state.remote));}

async function hydrate() {
  const archive=await readArchive();
  state.records=archive.filter(x=>x.kind!=='creation');
  state.creations=archive.filter(x=>x.kind==='creation');
  state.storageReady=true;
  if(state.currentCreation)state.currentCreation=state.creations.find(x=>x.id===state.currentCreation.id)||state.currentCreation;
  else state.currentCreation=state.creations[0]||null;
}
function selectSite(id,where) {
  const next=siteById(id);
  if(next.id!==state.siteId) {
    state.mapPhoto=null;state.detailPhoto=null;state.mapNote='';state.detailNote='';
    releaseUrl('map-upload');releaseUrl('detail-upload');
  }
  state.siteId=next.id;
  renderMapCard();renderJournal();renderMapMarkers();
  if(where)navigate(where,next.id);
}
function navigate(tab,siteId) {
  const hash='#'+tab+(siteId?'?site='+encodeURIComponent(siteId):'');
  if(location.hash===hash)showTab(true);
  else location.hash=hash;
}
function showTab(scroll) {
  const hash=location.hash.slice(1);
  const [name,query]=hash.split('?');
  state.tab=['map','journal','workshop','gallery','history','forgotten'].includes(name)?name:'map';
  const id=new URLSearchParams(query||'').get('site');
  if(id && SITES.some(s=>s.id===id))state.siteId=id;
  document.querySelectorAll('.gw-tabs button').forEach(b=>{
    const selected=b.dataset.tab===state.tab;
    b.setAttribute('aria-selected',selected);b.tabIndex=selected?0:-1;
  });
  document.querySelectorAll('[role=tabpanel]').forEach(p=>p.hidden=p.id!=='panel-'+state.tab);
  if(state.tab==='map'){renderMapCard();requestAnimationFrame(()=>{initMap();map?.invalidateSize();renderMapMarkers();});}
  if(state.tab==='journal')renderJournal();
  if(state.tab==='history')renderHistory();
  if(state.tab==='workshop'){$('workshop-site').value=state.siteId;renderWorkshopResult();}
  if(state.tab==='gallery'){renderGallery();if(!state.galleryLoading)refreshGallery();}
  if(state.tab==='forgotten')renderForgotten();
  if(scroll && ['map','journal','workshop','gallery','history','forgotten'].includes(name))$('gw-workspace').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}

function initMap() {
  if(map)return;
  if(!window.L){$('map-warning').textContent='地图组件未加载。请刷新页面，或在墩台志中查看全部点位。';$('map-warning').hidden=false;return;}
  map=L.map('gw-map',{zoomControl:false,scrollWheelZoom:false}).fitBounds(SITES.map(s=>[s.latitude,s.longitude]),{padding:[40,50]});
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  tileLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  }).addTo(map);
  tileLayer.on('tileload',()=>{tileSuccess=true;$('map-warning').hidden=true;});
  tileLayer.on('tileerror',()=>{if(!tileSuccess){$('map-warning').textContent='底图暂时无法加载，点位仍可选择。可稍后刷新页面。';$('map-warning').hidden=false;}});
  SITES.forEach((s,i)=>{
    const marker=L.marker([s.latitude,s.longitude],{title:s.name}).addTo(map);
    marker.bindTooltip(s.shortName,{direction:'top',offset:[0,-22]});
    marker.on('click',()=>selectSite(s.id));
    markers.set(s.id,{marker,index:i});
  });
  renderMapMarkers();
}
function renderMapMarkers() {
  if(!map)return;
  const visited=new Set(state.records.map(x=>x.siteId));
  markers.forEach(({marker,index},id)=>{
    const selected=id===state.siteId;
    marker.setIcon(L.divIcon({
      className:'gw-pin-icon',html:'<div class="gw-pin-circle '+(selected?'selected':visited.has(id)?'visited':'')+'"><span>'+(index+1)+'</span></div>',
      iconSize:selected?[35,35]:[29,29],iconAnchor:selected?[17,35]:[14,29]
    }));
    marker.setZIndexOffset(selected?1000:0);
  });
}
function renderMapCard() {
  const site=selectedSite();
  const distance=distanceMeters(state.location,site);
  const visited=state.records.some(r=>r.siteId===site.id);
  const summary=site.story.slice(0,82)+(site.story.length>82?'…':'');
  $('map-site-card').innerHTML=
    '<img class="gw-cover" src="'+sitePhoto(site)+'" alt="'+e(site.name)+'" data-action="site-photo" data-site="'+site.id+'">'+
    '<div class="gw-selected-body"><h3>'+e(site.name)+'</h3><div class="gw-badges"><span class="gw-badge">'+e(site.typeName)+'</span><span class="gw-badge neutral">'+(visited?'已留记录':'尚未记录')+'</span></div>'+
    '<p class="gw-selected-summary">'+e(summary)+'</p>'+
    '<div class="gw-form-line"><span>当前身份</span><div class="gw-segment"><button data-action="role" data-value="volunteer" aria-pressed="'+(state.role==='volunteer')+'">志愿者</button><button data-action="role" data-value="warden" aria-pressed="'+(state.role==='warden')+'">文保员</button></div></div>'+
    '<div class="gw-form-line"><span>当前位置</span><span class="gw-location-text">'+icon('pin')+' '+(distance==null?'尚未获取位置':'距演示点位 '+e(formatDistance(distance)))+'</span><button class="gw-link" data-action="locate">获取位置</button></div>'+
    '<label class="gw-field-label" for="map-photo">现场照片（可选）</label>'+
    (state.mapPhoto?'<div class="gw-photo-small"><img src="'+blobUrl(state.mapPhoto,'map-upload')+'" alt="待保存的现场照片"><button aria-label="移除照片" data-action="clear-map-photo">×</button></div>':'<label class="gw-upload" for="map-photo">'+icon('camera')+'添加现场照片</label>')+
    '<input id="map-photo" class="gw-file-input" type="file" accept="image/*">'+
    '<label for="map-note" class="gw-field-label">现场观察（可选）</label><textarea id="map-note" rows="2" maxlength="180" placeholder="记录墙体、周围环境或现场变化">'+e(state.mapNote)+'</textarea>'+
    '<div class="gw-action-pair"><button class="gw-button primary" data-action="save-visit">'+(state.role==='warden'?'记录巡检':'记录足迹')+'</button><button class="gw-button secondary" data-action="open-journal" data-site="'+site.id+'">查看墩台志</button></div>'+
    '<p class="gw-input-note">到访记录需获取位置；演示坐标不用于导航。远程观察可在墩台志中记录。</p>'+
    '<div id="map-action-error" class="gw-alert error" role="alert" hidden></div></div>';
  const latest=state.records[0];
  $('map-recent').innerHTML=latest?'<div class="gw-recent-item"><img src="'+(photoUrl(latest)||sitePhoto(siteById(latest.siteId)))+'" alt="'+e(latest.siteName)+'"><div><strong>'+e(latest.siteName)+'</strong><small>'+e(KIND_LABELS[latest.kind])+' · '+formatTime(latest.createdAt)+'</small></div><button class="gw-link" data-action="go-history">查看 →</button></div>':empty('你的第一步，还未写下','选择点位，记录观察。每一条记录都会成为你的长城档案。');
}

async function locate() {
  if(!navigator.geolocation)throw new Error('当前浏览器不支持定位，请使用支持定位的浏览器。');
  toast('正在获取位置，请允许浏览器定位。');
  const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,err=>reject(new Error(err.code===1?'定位未获授权。你仍可在墩台志中保存远程观察。':'位置获取失败，请检查设备定位设置后重试。')),{enableHighAccuracy:true,timeout:15000,maximumAge:30000}));
  state.location={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
  if(map){
    if(userMarker)map.removeLayer(userMarker);
    userMarker=L.circleMarker([state.location.latitude,state.location.longitude],{radius:7,color:'#fff',weight:3,fillColor:'#3b89bf',fillOpacity:1}).addTo(map).bindTooltip('当前位置');
  }
  renderMapCard();toast('已获取位置；距离按演示坐标计算。');
}
async function storeRecord(kind,note,blob,location) {
  if(!state.storageReady)throw new Error('本地档案尚未就绪，请刷新后重试。');
  const site=selectedSite(),distance=distanceMeters(location,site);
  const item={id:crypto.randomUUID(),kind,siteId:site.id,siteName:site.name,note,blob:blob||null,role:state.role,roleText:state.role==='warden'?'文保员':'志愿者',createdAt:Date.now(),date:dateKey(),distanceMeters:distance,inRange:distance!=null&&distance<=site.visitRadius,syncStatus:kind==='story'?'local':'pending',published:false};
  await saveArchive(item);await hydrate();renderAll();
  if(kind!=='story')syncRecord(item).catch(error=>console.warn('Record sync deferred',error));
  return item;
}
async function saveVisit() {
  if(!state.location)throw new Error('请先获取位置。若未到现场，可在墩台志中保存观察。');
  const distance=distanceMeters(state.location,selectedSite());
  if(distance>selectedSite().visitRadius)throw new Error('你距演示点位约 '+formatDistance(distance)+'，暂不记录为现场足迹。可在墩台志中保存远程观察。');
  await storeRecord(state.role==='warden'?'patrol':'checkin',state.mapNote,state.mapPhoto,state.location);
  state.mapPhoto=null;state.mapNote='';releaseUrl('map-upload');renderMapCard();toast('已保存到你的守护记录。');
}
async function saveObservation() {
  if(!state.detailNote.trim() && !state.detailPhoto)throw new Error('请写下观察，或添加一张照片。');
  await storeRecord(state.role==='warden'?'patrol':'story',state.detailNote.trim(),state.detailPhoto,null);
  state.detailPhoto=null;state.detailNote='';releaseUrl('detail-upload');renderJournal();toast('观察已保存到本地档案。');
}
async function syncRecord(item) {
  try {
    await request('/v1/site-activity/report',{body:{clientRecordId:item.id,siteId:item.siteId,siteName:item.siteName,kind:item.kind,role:item.role,date:item.date,createdAt:item.createdAt,distanceMeters:item.distanceMeters||0,inRange:item.inRange,hasPhoto:Boolean(item.blob)}});
    item.syncStatus='synced';item.syncError='';
  } catch(error) {item.syncStatus='failed';item.syncError=error.message;console.warn('Great Wall activity sync failed',error);}
  // A user may delete a record while its request is in flight. Do not restore it.
  if(state.records.some(x=>x.id===item.id)){await saveArchive(item);await hydrate();renderHistory();}
  refreshActivity();
}

function renderJournal() {
  filters('journal-filters',[['all','全部'],['beacon','烽火台'],['fort','营堡'],['viewpoint','观赏点']],state.journalFilter,'journal-filter');
  const list=SITES.filter(s=>state.journalFilter==='all'||s.type===state.journalFilter);
  $('journal-list').innerHTML=list.map(s=>'<button class="gw-site-item '+(s.id===state.siteId?'selected':'')+'" data-action="select-story" data-site="'+s.id+'"><img src="'+sitePhoto(s)+'" alt="'+e(s.name)+'" loading="lazy"><span><h3>'+e(s.name)+'</h3><span class="gw-badge">'+e(s.typeName)+'</span><p>'+e(s.coverText)+'</p></span></button>').join('');
  const site=selectedSite();
  $('journal-detail').innerHTML='<img class="gw-detail-photo" src="'+sitePhoto(site)+'" alt="'+e(site.name)+'" data-action="site-photo" data-site="'+site.id+'"><div class="gw-detail-body"><span class="gw-badge">'+e(site.typeName)+'</span><h3>'+e(site.name)+'</h3>'+
    '<h4>'+icon('book')+'墩台故事</h4><p>'+e(site.story)+'</p><h4>'+icon('leaf')+'守护建议</h4><p>'+e(site.protectionTip)+'</p>'+
    '<div class="gw-action-pair"><button class="gw-button primary" data-action="open-map" data-site="'+site.id+'">'+icon('map')+'到地图查看</button><button class="gw-button secondary" data-action="site-workshop" data-site="'+site.id+'">'+icon('palette')+'以此创作</button></div>'+
    '<details class="gw-observation" id="observation-form"><summary>补充我的观察 · '+(state.role==='warden'?'文保员巡检':'志愿者故事')+'</summary><div><label class="gw-field-label" for="detail-note">现场或远程观察</label><textarea id="detail-note" rows="3" maxlength="180" placeholder="记下你的发现、当地记忆或需要关注的变化">'+e(state.detailNote)+'</textarea>'+
    (state.detailPhoto?'<div class="gw-photo-small"><img src="'+blobUrl(state.detailPhoto,'detail-upload')+'" alt="待保存的观察照片"><button data-action="clear-detail-photo" aria-label="移除照片">×</button></div>':'<label class="gw-upload" for="detail-photo">'+icon('camera')+'添加观察照片（可选）</label>')+
    '<input id="detail-photo" type="file" accept="image/*" class="gw-file-input"><button class="gw-button primary full" data-action="save-observation">保存'+(state.role==='warden'?'巡检记录':'观察故事')+'</button><p class="gw-input-note">未获取现场位置的记录会标为远程观察，不计为现场到访。</p><div id="detail-action-error" class="gw-alert error" hidden role="alert"></div></div></details>'+
    '<p class="gw-source">图片：<a href="'+e(site.imageSourceUrl)+'" target="_blank" rel="noopener">'+e(site.imageSource)+'</a></p><p class="gw-source">'+e(site.sourceNote)+'</p></div>';
}

function renderWorkshopSetup() {
  $('workshop-site').innerHTML=SITES.map(s=>'<option value="'+s.id+'">'+e(s.name)+'</option>').join('');
  $('workshop-site').value=state.siteId;
  const symbols=['tower','book','camera','share','pin'];
  $('design-types').innerHTML=DESIGN_TYPES.map((type,i)=>'<label class="gw-design-type">'+icon(symbols[i])+'<span>'+type+'</span><input type="radio" name="design-type" value="'+type+'" '+(type===state.designType?'checked':'')+'></label>').join('');
  renderPhotoList();renderWorkshopResult();
}
function renderPhotoList() {
  $('workshop-photo-list').innerHTML=state.photos.map((b,i)=>'<div class="gw-photo-small"><img src="'+blobUrl(b,'workshop-upload-'+i)+'" alt="参考照片 '+(i+1)+'"><button type="button" aria-label="移除参考照片 '+(i+1)+'" data-action="remove-reference" data-index="'+i+'">×</button></div>').join('');
}
function renderWorkshopResult() {
  const current=state.currentCreation;
  $('creation-preview').innerHTML=current?
    '<img class="gw-result-image" src="'+photoUrl(current)+'" alt="'+e(current.siteName+' · '+current.designType)+'" data-action="creation-photo" data-id="'+current.id+'"><div class="gw-result-actions"><button class="gw-button primary" data-action="download" data-id="'+current.id+'">'+icon('download')+'下载作品</button><a href="#history" class="gw-button secondary">'+icon('record')+'作品记录</a><button class="gw-button secondary" data-action="share" data-id="'+current.id+'" '+(current.published?'disabled':'')+'>'+icon('share')+(current.published?'已公开':'公开分享')+'</button></div>':
    '<div class="gw-preview-empty">'+icon('tower')+'<h4>黄土之间，留一份记忆。</h4><p>左侧选择点位和文创类型，<br>让你的第一份长城礼物从这里开始。</p></div>';
  $('recent-creations').innerHTML=state.creations.length?state.creations.slice(0,5).map(c=>'<button data-action="select-creation" data-id="'+c.id+'"><img src="'+photoUrl(c)+'" alt="'+e(c.designType)+'" loading="lazy"><span>'+e(c.designType)+'</span></button>').join(''):'<p class="gw-input-note">生成完成后，作品会自动保存在当前浏览器。</p>';
  $('workshop-inputs').disabled=Boolean(state.generation);
  renderGenerationStatus();
}
function renderGenerationStatus(message) {
  const pending=state.pending;
  const active=Boolean(state.generation);
  $('generation-status').hidden=!pending&&!active;
  if(!pending&&!active)return;
  $('generation-status').innerHTML='<strong>'+(active?'<span class="gw-spinner"></span>':'')+e(message||(active?'正在生成你的长城礼物…':'任务已暂停等待'))+'</strong>'+
    '<p>任务提交后由服务器继续处理。切换功能或刷新页面后可以继续查询，作品完成后自动保存。</p>'+
    (active?'<button type="button" class="gw-link" data-action="pause-generation">停止等待</button>':'<button type="button" class="gw-button secondary small" data-action="resume-generation">继续查询此任务</button>')+
    '<p>停止等待不会撤回已提交的服务器任务。</p>';
}
async function uploadReference(blob,signal,index) {
  const form=new FormData();form.append('image',blob,'reference-'+index+'.jpg');form.append('mimeType',blob.type);
  const result=await request('/v1/images/upload-reference',{body:form,signal,timeout:60000});
  if(!result?.uploadId)throw new Error('参考照片未取得上传编号，请重试。');
  return result.uploadId;
}
async function generate() {
  $('workshop-error').hidden=true;
  if(state.generation)return;
  if(state.pending){await resumeGeneration();return;}
  const controller=new AbortController();state.generation=controller;
  state.generationStarted=Date.now();renderWorkshopResult();
  try {
    if(!state.storageReady)throw new Error('本地档案尚未就绪，暂不能保存生成作品。');
    const site=siteById($('workshop-site').value),note=$('workshop-note').value.trim(),type=state.designType;
    const health=await request('/health',{signal:controller.signal});
    if(!health.models?.image?.some(x=>(typeof x==='string'?x:x.name)===IMAGE_MODEL))throw new Error('AI 服务尚未登记本项目的生图模型，请联系维护者。');
    const imageIds=[];
    for(let i=0;i<state.photos.length;i++){
      renderGenerationStatus('正在上传参考照片 '+(i+1)+' / '+state.photos.length);
      imageIds.push(await uploadReference(state.photos[i],controller.signal,i));
    }
    const response=await request('/v1/images/generate',{body:{model:IMAGE_MODEL,prompt:creationPrompt(site,type,note,state.photos.length),size:generationSize(type),quality:'medium',imageIds},signal:controller.signal,timeout:30000});
    if(!response?.jobId)throw new Error('生成任务未返回编号，请稍后再试。');
    state.pending={jobId:response.jobId,siteId:site.id,siteName:site.name,designType:type,note,createdAt:Date.now()};
    storageWrite('pending',state.pending);renderGenerationStatus('已提交，正在排队生成…');
    await pollGeneration(controller.signal);
  } catch(error) {
    if(error.name!=='AbortError')showError('workshop-error',error);
  } finally {
    if(state.generation===controller)state.generation=null;
    renderWorkshopResult();
  }
}
async function resumeGeneration() {
  if(state.generation || !state.pending)return;
  $('workshop-error').hidden=true;
  const controller=new AbortController();state.generation=controller;renderWorkshopResult();
  try {await pollGeneration(controller.signal);}
  catch(error){if(error.name!=='AbortError')showError('workshop-error',error);}
  finally {if(state.generation===controller)state.generation=null;renderWorkshopResult();}
}
async function delay(ms,signal) {
  if(signal.aborted)throw new DOMException('停止等待','AbortError');
  await new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);reject(new DOMException('停止等待','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);
    signal.addEventListener('abort',onAbort,{once:true});
  });
}
async function pollGeneration(signal) {
  const job=state.pending;
  let failures=0;
  for(let attempt=0;attempt<150;attempt++) {
    if(signal.aborted)throw new DOMException('停止等待','AbortError');
    let result;
    try {
      result=await request('/v1/images/generate/status?jobId='+encodeURIComponent(job.jobId),{signal});
      failures=0;
    } catch(error) {
      if(error.name==='AbortError')throw error;
      if(/已过期|不存在/.test(error.message)){state.pending=null;storageWrite('pending',null);throw error;}
      if(++failures>=3)throw error;
      renderGenerationStatus('查询暂时中断，正在重新连接…');await delay(3000,signal);continue;
    }
    if(result.status==='failed'){state.pending=null;storageWrite('pending',null);throw new Error(result.error||'文创生成失败，请稍后再试。');}
    if(result.status==='complete') {
      renderGenerationStatus('作品已生成，正在保存到本地档案…');
      let blob;
      const url=imageUrl(result.data?.imageUrl);
      if(url){
        const response=await fetch(url,{signal});
        if(!response.ok)throw new Error('作品生成成功，但下载失败（HTTP '+response.status+'）。请点击继续查询重试保存。');
        blob=await response.blob();
      } else if(result.data?.imageBase64){
        const bytes=Uint8Array.from(atob(result.data.imageBase64),c=>c.charCodeAt(0));blob=new Blob([bytes],{type:result.data.mimeType||'image/png'});
      } else throw new Error('生成服务未返回可读取的图片。');
      if(!blob.size || !blob.type.startsWith('image/'))throw new Error('服务返回的文件不是图片，请稍后重试。');
      const item={...job,id:'creation-'+job.jobId,kind:'creation',blob,published:false};
      // Save first: a failed write keeps the pending job available for a retry.
      await saveArchive(item);state.pending=null;storageWrite('pending',null);state.currentCreation=item;
      await hydrate();renderAll();toast('文创已生成，并保存到你的守护记录。');return;
    }
    renderGenerationStatus(result.status==='queued'?'排队中，稍后会自动开始…':'正在描绘长城，作品完成后自动保存…');
    await delay(3000,signal);
  }
  throw new Error('等待较久，任务编号已保留。可以稍后点击“继续查询此任务”。');
}

async function refreshGallery() {
  if(state.galleryLoading)return;
  state.galleryLoading=true;state.galleryError='';renderGallery();
  try {
    const rows=await request('/v1/gallery?limit=80');
    const ids=new Set(SITES.map(s=>s.id));
    state.gallery=(rows||[]).filter(x=>ids.has(x.siteId));
  } catch(error){state.galleryError=error.message;console.warn('Great Wall gallery failed',error);}
  finally {state.galleryLoading=false;renderGallery();renderForgotten();}
}
function renderGallery() {
  filters('gallery-filters',[['all','全部'],['footprint','足迹照片'],['creation','AI 文创']],state.galleryFilter,'gallery-filter');
  $('gallery-status').innerHTML=state.galleryError?'<div class="gw-alert error">共享内容暂时无法读取：'+e(state.galleryError)+' <button class="gw-link" data-action="refresh-gallery">重试</button></div>':state.galleryLoading?'<div class="gw-alert info"><span class="gw-spinner"></span>正在读取共享内容…</div>':'';
  const rows=state.gallery.filter(x=>state.galleryFilter==='all'||x.kind===state.galleryFilter);
  $('gallery-grid').innerHTML=rows.length?rows.map(x=>'<article class="gw-card gw-gallery-card"><button data-action="gallery-photo" data-id="'+e(x.id)+'" aria-label="放大 '+e(x.title)+'"><img src="'+e(imageUrl(x.imageUrl))+'" alt="'+e(x.title)+'" loading="lazy"></button><div class="gw-gallery-body"><div class="gw-gallery-meta"><span class="gw-badge">'+(x.kind==='creation'?'AI 文创':'足迹照片')+'</span><span>'+formatTime(x.createdAt)+'</span></div><h3>'+e(x.title)+'</h3><p>'+e(x.note||x.siteName)+'</p><button class="gw-link" data-action="open-journal" data-site="'+e(x.siteId)+'">查看点位 →</button></div></article>').join(''):
    !state.galleryLoading&&!state.galleryError?'<div style="grid-column:1/-1">'+empty('这里等待第一份分享','在守护记录中主动公开一张照片或文创，大家就能看见。','<a href="#history" class="gw-link">从我的记录分享 →</a>')+'</div>':'';
}
async function refreshActivity() {
  try {const data=await request('/v1/site-activity?limit=300');state.remote=data?.records||[];state.activityError='';}
  catch(error){state.activityError=error.message;console.warn('Great Wall statistics failed',error);}
  renderForgotten();
}
function renderHistory() {
  filters('history-filters',[['all','全部'],['checkin','足迹'],['patrol','巡检'],['story','故事']],state.historyFilter,'history-filter');
  const stats=localStats();
  $('history-stats').innerHTML=[
    ['record','今日巡检',stats.patrolCount],['pin','已巡点位',stats.patrolSites+'/'+stats.total],
    ['map','巡检进度',stats.patrolPercent+'%'],['camera','今日打卡',stats.checkinToday]
  ].map(([sym,label,value])=>'<div class="gw-stat">'+icon(sym)+'<div><span>'+label+'</span><b>'+value+'</b></div></div>').join('');
  const rows=state.records.filter(r=>state.historyFilter==='all'||r.kind===state.historyFilter);
  $('history-list').innerHTML=rows.length?rows.map(r=>{
    const pic=photoUrl(r)||sitePhoto(siteById(r.siteId));
    const sync=r.kind==='story'?'':r.syncStatus==='synced'?'<p class="gw-sync-note success">巡检 / 足迹信息已同步（不含照片与观察文字）</p>':
      '<p class="gw-sync-note">'+(r.syncStatus==='pending'?'统计正在同步…':'已保存在本地，统计同步失败。')+(r.syncStatus==='failed'?'<button class="gw-link" data-action="retry-sync" data-id="'+r.id+'">重试同步</button>':'')+'</p>';
    return '<article class="gw-history-item"><div class="gw-history-item-top"><img src="'+pic+'" alt="'+e(r.siteName)+'" data-action="record-photo" data-id="'+r.id+'"><div class="gw-history-item-main"><h3>'+e(r.siteName)+'</h3><span class="gw-badge">'+e(KIND_LABELS[r.kind])+'</span> <small>'+formatTime(r.createdAt)+' · '+e(r.roleText)+'</small><p>'+e(r.note||'留下一条守护记录。')+'</p><small>'+(r.distanceMeters==null?'远程观察':r.inRange?'位置在演示范围内':'位置未确认')+'</small>'+sync+'</div></div><div class="gw-history-actions"><button class="gw-link" data-action="open-journal" data-site="'+r.siteId+'">查看点位</button>'+
      (r.blob?'<button class="gw-link" data-action="download" data-id="'+r.id+'">下载照片</button><button class="gw-link" data-action="share" data-id="'+r.id+'" '+(r.published?'disabled':'')+'>'+ (r.published?'已公开分享':'公开分享')+'</button>':'')+
      '<button class="gw-link gw-delete" data-action="delete-record" data-id="'+r.id+'">删除本地记录</button></div></article>';
  }).join(''):empty('还没有这类守护记录','到地图记录一次足迹，或在墩台志中写下你的观察。','<a href="#journal" class="gw-link">去读懂一座墩台 →</a>');
  $('history-creations').innerHTML=state.creations.length?state.creations.map(c=>'<div class="gw-saved-art"><img src="'+photoUrl(c)+'" alt="'+e(c.designType)+'" data-action="creation-photo" data-id="'+c.id+'"><h4>'+e(c.siteName)+' · '+e(c.designType)+'</h4><div class="gw-result-actions"><button class="gw-button secondary small" data-action="download" data-id="'+c.id+'">下载</button><button class="gw-button secondary small" data-action="share" data-id="'+c.id+'" '+(c.published?'disabled':'')+'>'+(c.published?'已公开':'分享')+'</button><button class="gw-link gw-delete" data-action="delete-record" data-id="'+c.id+'">删除</button></div></div>').join(''):empty('还没有文创作品','让你的第一份长城礼物从 AI 文创开始。','<a href="#workshop" class="gw-link">开始创作 →</a>');
}
function renderForgotten() {
  filters('forgotten-filters',[['priority','综合关注'],['patrol','巡检缺口'],['public','资料缺口'],['risk','参考风险']],state.sort,'sort');
  const rows=buildScoredSites(SITES,mergeRecords(state.records,state.remote),state.gallery);
  const risk=s=>s.protectionScore.metrics.find(m=>m.key==='risk').value;
  rows.sort((a,b)=>state.sort==='patrol'?b.protectionScore.latestPatrolDays-a.protectionScore.latestPatrolDays:state.sort==='public'?a.protectionScore.publicCount-b.protectionScore.publicCount:state.sort==='risk'?risk(b)-risk(a):b.protectionScore.forgottenIndex-a.protectionScore.forgottenIndex);
  $('forgotten-list').innerHTML=rows.map((s,i)=>{
    const score=s.protectionScore;
    const reasons=score.reasons.map(r=>r==='风险较高'?'原项目参考风险较高':r).join(' · ');
    return '<article class="gw-ranking-card"><b class="gw-rank-number">'+(i+1)+'</b><img src="'+sitePhoto(s)+'" alt="'+e(s.name)+'" loading="lazy"><div><h3>'+e(s.name)+'</h3><span class="gw-badge">'+(score.priority==='高'?'优先关注':'建议补充')+'</span><p>'+e(reasons)+'</p><div class="gw-ranking-meter">参考风险 <i><b style="width:'+Math.min(100,risk(s)*20)+'%"></b></i> 共享资料 '+score.publicCount+'</div></div><div class="gw-ranking-actions"><button class="gw-button primary" data-action="open-map" data-site="'+s.id+'">去记录 →</button><button class="gw-button secondary" data-action="open-journal" data-site="'+s.id+'">看详情</button></div></article>';
  }).join('');
  const stats=metricStats();
  $('activity-status').textContent=state.activityError?'共享巡检暂时无法读取，当前按本地记录与已有资料排序。':'已接入共享巡检。今天共有 '+stats.patrolCount+' 次巡检记录，涉及 '+stats.patrolSites+' 个点位。';
}

async function download(item) {
  if(!item?.blob)throw new Error('这条记录没有可下载的图片。');
  const url=URL.createObjectURL(item.blob),a=document.createElement('a');
  const ext=item.blob.type.includes('png')?'png':'jpg';
  a.href=url;a.download=item.siteName+'-'+(item.designType||KIND_LABELS[item.kind])+'.'+ext;
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function share(item) {
  if(!item?.blob)throw new Error('没有可公开分享的图片。');
  if(item.published){toast('这份内容已在共享空间公开。');return;}
  const yes=await confirmAction('公开分享到大家的长城？','将公开这张图片、点位名称和观察文字，所有访客都能看见。本地删除记录不会删除已经公开的内容。');
  if(!yes)return;
  const form=new FormData();
  form.append('image',item.blob,'guardian-photo.'+(item.blob.type.includes('png')?'png':'jpg'));
  const fields={kind:item.kind==='creation'?'creation':'footprint',siteId:item.siteId,siteName:item.siteName,title:item.siteName+' · '+(item.designType||KIND_LABELS[item.kind]),typeText:item.designType||KIND_LABELS[item.kind],note:item.note||'',roleText:item.roleText||'',mimeType:item.blob.type};
  Object.entries(fields).forEach(([k,v])=>form.append(k,v));
  const published=await request('/v1/gallery/publish',{body:form,timeout:60000});
  item.published=true;item.galleryId=published.id;
  await saveArchive(item);await hydrate();renderAll();toast('已公开到共享空间。');refreshGallery();
}
async function deleteItem(item) {
  const yes=await confirmAction('删除这条本地记录？','此操作会删除当前浏览器中的记录和照片。已同步的统计及公开分享的内容会保留。');
  if(!yes)return;
  await removeArchive(item.id);releaseUrl(item.id);
  if(state.currentCreation?.id===item.id)state.currentCreation=null;
  await hydrate();renderAll();toast('已删除本地记录。');
}
function exportRecords() {
  const data={project:'墩台志 · 府谷长城守护者',exportedAt:new Date().toISOString(),note:'照片和文创请使用各记录的下载按钮单独保存。本文件不包含图片。',records:state.records.map(({blob,...x})=>({...x,hasPhoto:Boolean(blob)})),creations:state.creations.map(({blob,...x})=>({...x,hasImage:Boolean(blob)}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='长城守护记录-'+dateKey()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderAll() {renderMapCard();renderMapMarkers();renderJournal();renderHistory();renderWorkshopResult();renderGallery();renderForgotten();}

document.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-tab]');
  if(tab){navigate(tab.dataset.tab);return;}
  const b=event.target.closest('[data-action]');
  if(!b)return;
  const action=b.dataset.action,id=b.dataset.id,site=b.dataset.site;
  const item=state.records.concat(state.creations).find(x=>x.id===id);
  const disabling=['save-visit','save-observation','share','retry-sync','delete-record'].includes(action);
  if(disabling){if(b.disabled)return;b.disabled=true;}
  if(disabling)$('gw-global-error').hidden=true;
  try {
    switch(action) {
      case 'role':state.role=b.dataset.value;storageWrite('role',state.role);renderMapCard();renderJournal();break;
      case 'locate':await locate();break;
      case 'save-visit':await saveVisit();break;
      case 'save-observation':await saveObservation();break;
      case 'fit-map':navigate('map');requestAnimationFrame(()=>map?.fitBounds(SITES.map(s=>[s.latitude,s.longitude]),{padding:[40,50]}));break;
      case 'open-journal':selectSite(site,'journal');break;
      case 'open-map':selectSite(site,'map');break;
      case 'select-story':selectSite(site);break;
      case 'site-workshop':$('workshop-site').value=site;selectSite(site,'workshop');break;
      case 'go-history':navigate('history');break;
      case 'journal-filter':state.journalFilter=b.dataset.value;renderJournal();break;
      case 'gallery-filter':state.galleryFilter=b.dataset.value;renderGallery();break;
      case 'history-filter':state.historyFilter=b.dataset.value;renderHistory();break;
      case 'sort':state.sort=b.dataset.value;renderForgotten();break;
      case 'site-photo':showImage(sitePhoto(siteById(site)),siteById(site).name);break;
      case 'record-photo':showImage(photoUrl(item)||sitePhoto(siteById(item.siteId)),item.siteName);break;
      case 'creation-photo':showImage(photoUrl(item),item.siteName+' · '+item.designType);break;
      case 'gallery-photo':{const x=state.gallery.find(x=>x.id===id);showImage(imageUrl(x?.imageUrl),x?.title);break;}
      case 'close-image':$('gw-image-dialog').close();break;
      case 'confirm-yes':$('gw-confirm-dialog').close();confirmResolve?.(true);confirmResolve=null;break;
      case 'confirm-no':$('gw-confirm-dialog').close();confirmResolve?.(false);confirmResolve=null;break;
      case 'clear-map-photo':state.mapPhoto=null;releaseUrl('map-upload');renderMapCard();break;
      case 'clear-detail-photo':state.detailPhoto=null;releaseUrl('detail-upload');renderJournal();$('observation-form').open=true;break;
      case 'remove-reference':state.photos.splice(Number(b.dataset.index),1);for(let i=0;i<5;i++)releaseUrl('workshop-upload-'+i);renderPhotoList();break;
      case 'select-creation':state.currentCreation=item;renderWorkshopResult();break;
      case 'refresh-gallery':await refreshGallery();break;
      case 'pause-generation':state.generation?.abort();break;
      case 'resume-generation':await resumeGeneration();break;
      case 'retry-sync':await syncRecord(item);break;
      case 'download':await download(item);break;
      case 'share':await share(item);break;
      case 'delete-record':await deleteItem(item);break;
      case 'export-records':exportRecords();break;
    }
  } catch(error) {
    const target=['locate','save-visit'].includes(action)?'map-action-error':action==='save-observation'?'detail-action-error':'gw-global-error';
    showError(target,error);toast(error.message);
  } finally {if(disabling && b.isConnected)b.disabled=false;}
});
document.addEventListener('input',event=>{
  if(event.target.id==='map-note')state.mapNote=event.target.value;
  if(event.target.id==='detail-note')state.detailNote=event.target.value;
});
document.addEventListener('change',async event=>{
  const input=event.target;
  try {
    if(input.name==='design-type')state.designType=input.value;
    if(input.id==='workshop-site')state.siteId=input.value;
    if(input.id==='map-photo'&&input.files[0]){state.mapPhoto=await imageBlob(input.files[0]);releaseUrl('map-upload');renderMapCard();}
    if(input.id==='detail-photo'&&input.files[0]){state.detailPhoto=await imageBlob(input.files[0]);releaseUrl('detail-upload');renderJournal();$('observation-form').open=true;}
    if(input.id==='workshop-photos') {
      const files=Array.from(input.files);
      if(state.photos.length+files.length>4)throw new Error('最多选择 4 张参考照片，请移除一些后再添加。');
      for(const file of files)state.photos.push(await imageBlob(file));
      renderPhotoList();input.value='';
    }
  } catch(error){showError(input.id==='workshop-photos'?'workshop-error':'gw-global-error',error);input.value='';}
});
document.querySelector('.gw-tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const tabs=Array.from(document.querySelectorAll('.gw-tabs button'));
  const index=tabs.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next].focus();navigate(tabs[next].dataset.tab);
});
$('workshop-form').addEventListener('submit',event=>{event.preventDefault();generate();});
$('gw-confirm-dialog').addEventListener('cancel',()=>{confirmResolve?.(false);confirmResolve=null;});
window.addEventListener('hashchange',()=>showTab(true));

async function boot() {
  try {await hydrate();}
  catch(error){showError('gw-global-error',error);}
  renderWorkshopSetup();renderAll();showTab(Boolean(location.hash));
  request('/health').then(health=>{
    const ready=health.models?.image?.some(x=>(typeof x==='string'?x:x.name)===IMAGE_MODEL);
    $('ai-connection').textContent=ready?'AI 服务已连接':'生图模型尚未登记';$('ai-connection').classList.add(ready?'ready':'failed');
  }).catch(error=>{$('ai-connection').textContent='AI 暂未连接 · 可稍后重试';$('ai-connection').classList.add('failed');console.warn('AI health failed',error);});
  refreshGallery();refreshActivity();
  if(state.pending){toast('发现上次生成任务，可以在 AI 文创中继续查询。');renderGenerationStatus();}
}
boot();
